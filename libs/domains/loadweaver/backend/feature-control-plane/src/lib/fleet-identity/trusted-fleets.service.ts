import { createHash } from 'node:crypto';

import type { RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuditLogService, actorFromRequest, ON_BEHALF_OF_SCOPE } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { ClusterIdentityService } from '../services/cluster-identity.service';

import { FleetPersonEntity, TrustedFleetEntity, type TrustedFleetKey } from './fleet-identity.entities';
import {
  checkFleetClaim,
  decodeFleetClaim,
  ed25519PublicKey,
  expectedBodyBinding,
  FLEET_IDENTITY_VERSION,
  FLEET_ISSUER_PATTERN,
  FLEET_KID_PATTERN,
  fleetBodyHash,
  fleetIdentityHeader,
  fleetIdentityIgnoredReason,
  fleetIdentityOf,
  isFleetRelayCaller,
  mayCarryFleetIdentity,
  MAX_TRUSTED_FLEET_KEYS,
  type FleetIdentityRequest,
  type VerifiedFleetIdentity,
} from './fleet-identity.utils';

const CACHE_MS = 15_000;
const NONCE_CLEANUP_MS = 60_000;

export interface TrustedFleetKeyDto extends TrustedFleetKey {
  /** `SHA256:<base64url>` of the key (SPKI DER), to compare with what the fleet shows. */
  fingerprint: string;
}

export interface TrustedFleetDto {
  issuer: string;
  name: string;
  keys: TrustedFleetKeyDto[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrustedFleetInput {
  name: string;
  keys: { kid: string; publicKey: string }[];
}

/** `GET /fleet-identity`: feature detection and the result of this request's claim (for the fleet's probe). */
export interface FleetIdentityStatusDto {
  version: number;
  clusterId: string;
  verified: boolean;
  issuer: string | null;
  person: string | null;
  reason: string | null;
  /** Verified probes only (2026-10-29): the key ids this cluster trusts for the fleet, so it can see a pending key. */
  trustedKeys: string[] | null;
  /** Verified probes only: when the fleet was registered here. */
  trustedSince: string | null;
}

export type FleetClaimEvaluation =
  | { result: 'none' }
  | { result: 'ignored'; reason: string }
  | { result: 'refused'; reason: string }
  | { result: 'verified'; identity: VerifiedFleetIdentity };

/** `SHA256:<base64url>` of an Ed25519 public key (SPKI DER). */
export function keyFingerprint(publicKey: string): string {
  const key = ed25519PublicKey(publicKey);

  if (!key) return '';

  return `SHA256:${createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('base64url')}`;
}

function toDto(row: TrustedFleetEntity): TrustedFleetDto {
  return {
    issuer: row.issuer,
    name: row.name,
    keys: (row.keys ?? []).map((k) => ({ ...k, fingerprint: keyFingerprint(k.publicKey) })),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Validates the keys of a trusted fleet: 1–3 unique `kid`s, each an Ed25519 public key (PEM). */
export function normalizeTrustedFleetKeys(
  keys: readonly { kid: string; publicKey: string }[],
  previous: readonly TrustedFleetKey[] = [],
  now = new Date(),
): TrustedFleetKey[] {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_TRUSTED_FLEET_KEYS)
    throw new BadRequestException(`between 1 and ${MAX_TRUSTED_FLEET_KEYS} keys`);

  const seen = new Set<string>();

  return keys.map(({ kid, publicKey }) => {
    if (typeof kid !== 'string' || !FLEET_KID_PATTERN.test(kid)) throw new BadRequestException(`invalid key id ${kid}`);

    if (seen.has(kid)) throw new BadRequestException(`key id ${kid} given twice`);

    seen.add(kid);

    const pem = typeof publicKey === 'string' ? publicKey.trim() : '';

    if (!ed25519PublicKey(pem)) throw new BadRequestException(`key ${kid} is not an Ed25519 public key (PEM)`);

    const kept = previous.find((p) => p.kid === kid && p.publicKey.trim() === pem);

    return { kid, publicKey: pem, addedAt: kept?.addedAt ?? now.toISOString() };
  });
}

/**
 * The keys after a fleet registered its own (2026-10-29): the fleet's keys first, then the ones the cluster already
 * holds for it (newest first: e.g. a retired key whose rotation an admin hasn't cleaned up), up to the maximum. A
 * key id the fleet sends replaces the stored one.
 */
export function mergeTrustedFleetKeys(
  existing: readonly TrustedFleetKey[],
  incoming: readonly { kid: string; publicKey: string }[],
  max = MAX_TRUSTED_FLEET_KEYS,
): { kid: string; publicKey: string }[] {
  const ids = new Set(incoming.map((k) => k.kid));
  const kept = [...existing]
    .filter((k) => !ids.has(k.kid))
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    .map((k) => ({ kid: k.kid, publicKey: k.publicKey }));

  return [...incoming.map((k) => ({ kid: k.kid, publicKey: k.publicKey })), ...kept].slice(0, max);
}

/** Same name and the same keys (by id and PEM, in any order): nothing to write. */
function sameTrust(row: TrustedFleetEntity, name: string, keys: readonly TrustedFleetKey[]): boolean {
  const stored = row.keys ?? [];

  return (
    row.name === name &&
    stored.length === keys.length &&
    keys.every((k) => stored.some((s) => s.kid === k.kid && s.publicKey.trim() === k.publicKey.trim()))
  );
}

function firstRow<T>(result: unknown): T | undefined {
  // TypeORM's Postgres driver answers INSERT … RETURNING with rows, UPDATE / DELETE … RETURNING with [rows, count].
  if (!Array.isArray(result)) return undefined;

  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') return (result[0] as T[])[0];

  return result[0] as T | undefined;
}

/**
 * Trusted fleets and the verification of their identity claims (3.24). Cluster admins manage the keys natively; a
 * fleet whose credential is a cluster admin's registers its own keys (2026-10-29, proof of possession, never another
 * fleet's); verified claims make the request's acting person `fleet:<iss>:<sub>`.
 * Nonces live in Postgres (`lw_fleet_claim_nonces`), so every control-plane replica sees a replay.
 */
@Injectable()
export class TrustedFleetsService {
  private readonly logger = new Logger(TrustedFleetsService.name);
  private cache: { at: number; fleets: Map<string, TrustedFleetEntity> } | null = null;
  private clusterId: string | null = null;
  private lastCleanup = 0;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClusterAccessService,
    private readonly audit: AuditLogService,
    private readonly identity: ClusterIdentityService,
  ) {}

  // -------------------------------------------------------------------------------------------- management

  /** Listing and removing: cluster admins, and never through a fleet (revoking trust is the cluster's decision). */
  private async assertNativeAdmin(req: RequestWithUser | undefined): Promise<void> {
    // Also the API key acting for a verified fleet person (2026-10-29): that request comes through a fleet.
    if (isFleetRelayCaller(req, ON_BEHALF_OF_SCOPE) || fleetIdentityOf(req))
      throw new ForbiddenException(
        'trusted fleets are listed and removed by the cluster’s own admins, not through a fleet',
      );

    await this.access.assert(req, 'admin');
  }

  async list(req: RequestWithUser | undefined): Promise<TrustedFleetDto[]> {
    await this.assertNativeAdmin(req);

    const rows = await this.dataSource.getRepository(TrustedFleetEntity).find({ order: { issuer: 'ASC' } });

    return rows.map(toDto);
  }

  /**
   * A fleet registering itself (2026-10-29, automatic trust): only with a credential the cluster already authorises
   * to manage trusted fleets — the route's `cluster:admin` scope and the service user's cluster-admin role (checked
   * by the caller before) — and only for its own issuer, proven by a claim signed with one of the keys it registers
   * (bound to this cluster, the request and its body; nonce used once). An existing entry changes only when that key
   * is already trusted there or the entry was registered by this same service user (rotation / recovery); a fleet
   * can't take over another fleet's or an admin's entry. Returns the verified identity (the audit's acting person).
   */
  private async verifySelfRegistration(
    req: RequestWithUser | undefined,
    issuer: string,
    keys: readonly TrustedFleetKey[],
    existing: TrustedFleetEntity | null,
    now: Date,
  ): Promise<VerifiedFleetIdentity> {
    const freq = (req ?? {}) as FleetIdentityRequest;
    const token = fleetIdentityHeader(freq);
    const decoded = token ? decodeFleetClaim(token) : null;

    if (!decoded)
      throw new ForbiddenException('a fleet registers itself only with a claim signed by the key it registers');

    if (decoded.claims.iss !== issuer) throw new ForbiddenException('the claim is for another fleet');

    if (decoded.claims.role !== 'admin') throw new ForbiddenException('only the fleet’s admins register it');

    const signing = keys.find((k) => k.kid === decoded.kid);
    const key = signing ? ed25519PublicKey(signing.publicKey) : null;

    if (!signing || !key) throw new ForbiddenException('the claim must be signed with one of the keys it registers');

    const check = checkFleetClaim(decoded, {
      key,
      audience: await this.ownClusterId(),
      method: freq.method ?? '',
      url: freq.originalUrl ?? freq.url ?? '',
      bodyHash: expectedBodyBinding(freq),
      now,
    });

    if (check.ok !== true)
      throw new ForbiddenException(`fleet identity claim refused: ${(check as { reason: string }).reason}`);

    if (existing) {
      const trustedKey = (existing.keys ?? []).some(
        (k) => k.kid === signing.kid && k.publicKey.trim() === signing.publicKey.trim(),
      );
      const ownEntry = !!existing.createdBy && existing.createdBy === actorFromRequest(req).id;

      if (!trustedKey && !ownEntry)
        throw new ForbiddenException(
          'this fleet is registered here with other keys: a cluster admin updates it (Trusted fleets)',
        );
    }

    if (!(await this.consumeNonce(check.identity, now)))
      throw new ForbiddenException('fleet identity claim refused: claim replayed');

    return check.identity;
  }

  /**
   * Creates or replaces a trusted fleet. Natively (cluster admins): the given keys replace the stored ones. Through a
   * fleet (its own registration, see {@link verifySelfRegistration}): the fleet's keys are added to the stored ones
   * (the old key stays until an admin removes it) and the name of an existing entry is kept. Idempotent: nothing
   * changes, nothing is written or audited.
   */
  async put(
    req: RequestWithUser | undefined,
    issuer: string,
    input: TrustedFleetInput,
    now = new Date(),
  ): Promise<TrustedFleetDto> {
    const viaFleet = isFleetRelayCaller(req, ON_BEHALF_OF_SCOPE);

    // The cluster's own authorisation decides in both cases: cluster admins only (the route needs `cluster:admin`).
    await this.access.assert(req, 'admin');

    if (!FLEET_ISSUER_PATTERN.test(issuer)) throw new BadRequestException('invalid issuer');

    const requestedName = (input.name ?? '').trim();

    if (!requestedName || requestedName.length > 255) throw new BadRequestException('a name of 1–255 characters');

    const row = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TrustedFleetEntity);
      const existing = await repo.findOne({ where: { issuer }, lock: { mode: 'pessimistic_write' } });
      const incoming = normalizeTrustedFleetKeys(input.keys, existing?.keys ?? [], now);

      if (viaFleet) {
        const identity = await this.verifySelfRegistration(req, issuer, incoming, existing, now);

        // The audit's acting person: the fleet admin who triggered it (or the fleet itself, `fleet:<iss>:system`).
        (req as FleetIdentityRequest).fleetIdentity = identity;
      }

      const name = viaFleet && existing ? existing.name : requestedName;
      const keys = viaFleet
        ? normalizeTrustedFleetKeys(mergeTrustedFleetKeys(existing?.keys ?? [], incoming), existing?.keys ?? [], now)
        : incoming;

      if (existing && sameTrust(existing, name, keys)) return existing;

      const saved = await repo.save(
        existing
          ? Object.assign(existing, { name, keys })
          : repo.create({ issuer, name, keys, createdBy: actorFromRequest(req).id ?? null }),
      );

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: existing ? 'fleet.trust.update' : 'fleet.trust.create',
        target: `trusted-fleet/${issuer}`,
        details: {
          name,
          keys: keys.map((k) => ({ kid: k.kid, fingerprint: keyFingerprint(k.publicKey) })),
          ...(viaFleet ? { registeredBy: 'fleet' } : {}),
        },
      });

      return saved;
    });

    this.cache = null;

    return toDto(row);
  }

  async remove(req: RequestWithUser | undefined, issuer: string): Promise<void> {
    await this.assertNativeAdmin(req);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TrustedFleetEntity);
      const existing = await repo.findOne({ where: { issuer } });

      if (!existing) throw new NotFoundException('trusted fleet not found');

      await repo.delete({ issuer });
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'fleet.trust.delete',
        target: `trusted-fleet/${issuer}`,
        details: { name: existing.name },
      });
    });

    this.cache = null;
  }

  // ------------------------------------------------------------------------------------------ verification

  private async trusted(issuer: string): Promise<TrustedFleetEntity | undefined> {
    const now = Date.now();

    if (!this.cache || now - this.cache.at > CACHE_MS) {
      const rows = await this.dataSource.getRepository(TrustedFleetEntity).find();

      this.cache = { at: now, fleets: new Map(rows.map((r) => [r.issuer, r])) };
    }

    return this.cache.fleets.get(issuer);
  }

  private async ownClusterId(): Promise<string> {
    if (!this.clusterId) this.clusterId = (await this.identity.cluster()).clusterId;

    return this.clusterId;
  }

  /**
   * The claim of a request: none / ignored (no fleet service user, malformed, unknown issuer — behaves as before) /
   * refused (a trusted fleet's claim that fails a check: tampering or a broken fleet) / verified. With
   * `consumeNonce` (state-changing requests) the nonce is used up and the person recorded.
   */
  async evaluate(req: FleetIdentityRequest, consumeNonce: boolean, now = new Date()): Promise<FleetClaimEvaluation> {
    const token = fleetIdentityHeader(req);

    if (!token) return { result: 'none' };

    // A PAT with `fleet:on-behalf-of`, or the cluster's API key while LOADWEAVER_API_KEY_FLEET_DELEGATION is on
    // (2026-10-29): verified identically; the access services cap the person's roles by the credential's own.
    if (!mayCarryFleetIdentity(req, ON_BEHALF_OF_SCOPE))
      return { result: 'ignored', reason: fleetIdentityIgnoredReason(req, ON_BEHALF_OF_SCOPE) };

    return await this.verifyToken(
      token,
      { method: req.method ?? '', url: req.originalUrl ?? req.url ?? '', bodyHash: expectedBodyBinding(req) },
      consumeNonce,
      now,
    );
  }

  /**
   * A socket subscription's claim (2026-10-27): the fleet sends it in the handshake (`auth.fleetIdentity`), bound to
   * this cluster, `SOCKET` and `/socket/<namespace>`, minted anew for every connect; the nonce is consumed. The socket
   * then acts as the person with the claim's grants capped by the connecting user's own roles (never more).
   */
  async evaluateSocket(token: unknown, namespace: string, now = new Date()): Promise<FleetClaimEvaluation> {
    if (typeof token !== 'string' || !token) return { result: 'none' };

    return await this.verifyToken(
      token,
      { method: 'SOCKET', url: `/socket/${namespace}`, bodyHash: fleetBodyHash(null) },
      true,
      now,
    );
  }

  private async verifyToken(
    token: string,
    request: { method: string; url: string; bodyHash: string },
    consumeNonce: boolean,
    now: Date,
  ): Promise<FleetClaimEvaluation> {
    const decoded = decodeFleetClaim(token);

    if (!decoded) return { result: 'ignored', reason: 'malformed fleet identity claim' };

    const fleet = await this.trusted(decoded.claims.iss);

    if (!fleet) return { result: 'ignored', reason: `fleet ${decoded.claims.iss} is not trusted by this cluster` };

    const stored = (fleet.keys ?? []).find((k) => k.kid === decoded.kid);
    const key = stored ? ed25519PublicKey(stored.publicKey) : null;

    if (!key) return { result: 'refused', reason: `key ${decoded.kid} of fleet ${fleet.issuer} is not registered` };

    const check = checkFleetClaim(decoded, { key, audience: await this.ownClusterId(), ...request, now });

    if (check.ok !== true) return { result: 'refused', reason: (check as { reason: string }).reason };

    if (consumeNonce) {
      if (!(await this.consumeNonce(check.identity, now))) return { result: 'refused', reason: 'claim replayed' };

      await this.recordPerson(check.identity, now);
    }

    return { result: 'verified', identity: check.identity };
  }

  /** Inserts the nonce; false when it was seen before (a replay). */
  private async consumeNonce(identity: VerifiedFleetIdentity, now: Date): Promise<boolean> {
    if (now.getTime() - this.lastCleanup > NONCE_CLEANUP_MS) {
      this.lastCleanup = now.getTime();
      await this.dataSource
        .query(`DELETE FROM "lw_fleet_claim_nonces" WHERE "expires_at" < $1`, [now])
        .catch((error: Error) => this.logger.warn(`Fleet claim nonce cleanup failed: ${error.message}`));
    }

    const inserted = await this.dataSource.query(
      `INSERT INTO "lw_fleet_claim_nonces" ("issuer", "jti", "expires_at") VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING "jti"`,
      [identity.issuer, identity.jti, identity.expiresAt],
    );

    return !!firstRow<{ jti: string }>(inserted);
  }

  private async recordPerson(identity: VerifiedFleetIdentity, now: Date): Promise<void> {
    await this.dataSource.getRepository(FleetPersonEntity).upsert(
      {
        personId: identity.person,
        issuer: identity.issuer,
        subject: identity.subject,
        email: identity.email,
        emailVerified: identity.emailVerified,
        lastSeenAt: now,
      },
      ['personId'],
    );
  }

  /** Feature detection + the probe's result (`GET /fleet-identity`). */
  async status(req: FleetIdentityRequest): Promise<FleetIdentityStatusDto> {
    const evaluation = await this.evaluate(req, false);
    const fleet = evaluation.result === 'verified' ? await this.trusted(evaluation.identity.issuer) : undefined;

    return {
      version: FLEET_IDENTITY_VERSION,
      clusterId: await this.ownClusterId(),
      verified: evaluation.result === 'verified',
      issuer: evaluation.result === 'verified' ? evaluation.identity.issuer : null,
      person: evaluation.result === 'verified' ? evaluation.identity.person : null,
      reason:
        evaluation.result === 'verified'
          ? null
          : evaluation.result === 'none'
            ? 'no fleet identity claim'
            : evaluation.reason,
      trustedKeys: fleet ? (fleet.keys ?? []).map((k) => k.kid) : null,
      trustedSince: fleet ? new Date(fleet.createdAt).toISOString() : null,
    };
  }
}
