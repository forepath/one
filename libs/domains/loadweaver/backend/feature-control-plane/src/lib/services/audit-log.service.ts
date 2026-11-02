import { createHash } from 'node:crypto';

import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { ADVISORY_LOCK_AUDIT_CHAIN } from '../constants/control-plane.constants';
import { AuditEventEntity } from '../entities/audit-event.entity';
import { fleetIdentityOf } from '../fleet-identity/fleet-identity.utils';
import { canonicalJson } from '../utils/canonical-json.utils';

export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export interface AuditActor {
  type: AuditEventEntity['actorType'];
  id?: string | null;
  /**
   * The person a trusted relay acted for (fleet service, 3.24): recorded as `details.onBehalfOf`. Only set by
   * {@link actorFromRequest} for PATs carrying {@link ON_BEHALF_OF_SCOPE} and for the API key with a verified fleet
   * claim (2026-10-29); the actor stays the service user / the API key.
   */
  onBehalfOf?: string;
  /**
   * The verified acting person behind a fleet's service user (`fleet:<iss>:<sub>`, 3.24): what creators / requesters /
   * approvers are stored as; also recorded as `details.onBehalfOf`.
   */
  person?: string;
  /** The verified person's email (`details.onBehalfOfEmail`). */
  onBehalfOfEmail?: string;
}

/** Header a fleet service sends with the acting fleet user (3.24). */
export const ON_BEHALF_OF_HEADER = 'x-loadweaver-on-behalf-of';

/**
 * PAT scope that opts a service user's token in to the on-behalf-of header (3.24). Interactive sessions, the static
 * API key and tokens without the scope are ignored, so nobody can annotate the audit log by just sending the header.
 */
export const ON_BEHALF_OF_SCOPE = 'fleet:on-behalf-of';

const ON_BEHALF_OF_MAX = 255;

/**
 * The on-behalf-of value of a request, or undefined: only for PAT callers whose token carries the opt-in scope;
 * control characters are dropped and the value is capped (it is a label, never used for access decisions).
 */
export function onBehalfOfFromRequest(req?: RequestWithUser): string | undefined {
  const user = req?.user;

  if (!req || req.apiKeyAuthenticated || !user?.id) return undefined;

  if (!(user.amr ?? []).includes('pat') || !(user.scopes ?? []).includes(ON_BEHALF_OF_SCOPE)) return undefined;

  const raw = (req.headers as Record<string, string | string[] | undefined> | undefined)?.[ON_BEHALF_OF_HEADER];
  const value = [...((Array.isArray(raw) ? raw[0] : raw) ?? '')]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .trim()
    .slice(0, ON_BEHALF_OF_MAX);

  return value ? value : undefined;
}

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  target: string;
  project?: string | null;
  details?: Record<string, unknown>;
}

export interface AuditVerification {
  ok: boolean;
  checked: number;
  /** First sequence number whose hash does not match. */
  brokenAt?: string;
  head?: string;
}

export function actorFromRequest(req?: RequestWithUser): AuditActor {
  const info = getUserFromRequest(req || ({} as RequestWithUser));

  const identity = fleetIdentityOf(req);

  // The API key acting for a verified fleet person (2026-10-29): the actor stays the API key, the person is recorded.
  if (info.isApiKeyAuth)
    return identity
      ? {
          type: 'api-key',
          id: null,
          onBehalfOf: identity.person,
          person: identity.person,
          ...(identity.email ? { onBehalfOfEmail: identity.email } : {}),
        }
      : { type: 'api-key', id: null };

  if (identity)
    return {
      type: 'user',
      id: info.userId ?? null,
      onBehalfOf: identity.person,
      person: identity.person,
      ...(identity.email ? { onBehalfOfEmail: identity.email } : {}),
    };

  const onBehalfOf = onBehalfOfFromRequest(req);

  return { type: 'user', id: info.userId ?? null, ...(onBehalfOf ? { onBehalfOf } : {}) };
}

export function computeAuditHash(prevHash: string, event: Omit<AuditEventEntity, 'hash' | 'prevHash'>): string {
  return createHash('sha256')
    .update(prevHash)
    .update(
      canonicalJson({
        seq: event.seq,
        at: event.at.toISOString(),
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        target: event.target,
        project: event.project,
        details: event.details,
      }),
    )
    .digest('hex');
}

/**
 * Append-only, hash-chained audit log (3.18). `record` must be called inside the transaction of the change,
 * so no change can be committed without its entry; the advisory lock serialises the chain.
 */
@Injectable()
export class AuditLogService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async record(manager: EntityManager, entry: AuditEntry): Promise<AuditEventEntity> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('audit events must be recorded inside the transaction of the change');
    }

    await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_AUDIT_CHAIN]);

    const repo = manager.getRepository(AuditEventEntity);
    const last = await repo.createQueryBuilder('a').orderBy('a.seq', 'DESC').limit(1).getOne();
    const seq = (BigInt(last?.seq ?? '0') + BigInt(1)).toString();
    const event = {
      seq,
      at: new Date(),
      actorType: entry.actor.type,
      actorId: entry.actor.id ?? null,
      action: entry.action,
      target: entry.target,
      project: entry.project ?? null,
      details: entry.actor.onBehalfOf
        ? {
            ...(entry.details ?? {}),
            onBehalfOf: entry.actor.onBehalfOf,
            ...(entry.actor.onBehalfOfEmail ? { onBehalfOfEmail: entry.actor.onBehalfOfEmail } : {}),
          }
        : (entry.details ?? {}),
    };
    const prevHash = last?.hash ?? AUDIT_GENESIS_HASH;

    return await repo.save(repo.create({ ...event, prevHash, hash: computeAuditHash(prevHash, event) }));
  }

  /** Records an event in its own transaction (for events without a surrounding change, e.g. logins). */
  async recordStandalone(entry: AuditEntry): Promise<AuditEventEntity> {
    return await this.dataSource.transaction(async (manager) => await this.record(manager, entry));
  }

  /** Recomputes the chain (the "verify" action, 3.18). */
  async verify(batchSize = 1000): Promise<AuditVerification> {
    const repo = this.dataSource.getRepository(AuditEventEntity);
    let prevHash = AUDIT_GENESIS_HASH;
    let expectedSeq = BigInt(1);
    let checked = 0;

    for (;;) {
      const batch = await repo
        .createQueryBuilder('a')
        .where('a.seq >= :from', { from: expectedSeq.toString() })
        .orderBy('a.seq', 'ASC')
        .limit(batchSize)
        .getMany();

      if (batch.length === 0) break;

      for (const event of batch) {
        const { hash, prevHash: storedPrev, ...rest } = event;

        if (BigInt(event.seq) !== expectedSeq || storedPrev !== prevHash || computeAuditHash(prevHash, rest) !== hash) {
          return { ok: false, checked, brokenAt: event.seq };
        }

        prevHash = hash;
        expectedSeq++;
        checked++;
      }
    }

    return { ok: true, checked, head: checked > 0 ? prevHash : undefined };
  }
}
