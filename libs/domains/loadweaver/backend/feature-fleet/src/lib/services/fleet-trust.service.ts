import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { fleetAutoTrustEnabled } from '../constants/fleet.constants';
import {
  FleetClusterEntity,
  type FleetClusterHealth,
  type FleetTrustAttempt,
  type FleetTrustOutcome,
} from '../entities/fleet-cluster.entity';
import type { FleetCaller } from '../utils/fleet-access.utils';
import { fleetClaimUrl } from '../utils/fleet-identity-claims';
import { FleetAuditService } from './fleet-audit.service';
import { FleetClusterClient, FleetClusterError, type ClusterConnection } from './fleet-cluster-client.service';
import { FleetIdentityService, type FleetRegistration } from './fleet-identity.service';

/** A failed automatic attempt (unreachable, unexpected answer) is retried after this long. */
const RETRY_FAILED_MS = 15 * 60_000;

/** What `GET /api/fleet-identity` answers (the parts used here). */
interface IdentityStatusLike {
  clusterId?: string;
  verified?: boolean;
  reason?: string | null;
  trustedKeys?: string[] | null;
  trustedSince?: string | null;
}

/** A trusted fleet as `GET /api/trusted-fleets` lists it (the one-time token path). */
interface TrustedFleetLike {
  issuer?: string;
  name?: string;
  keys?: { kid?: string; publicKey?: string; addedAt?: string }[];
}

/**
 * Whether the poll should try to establish trust now: automatic trust on, a working connection that answered with
 * its cluster id, the cluster supports claims and doesn't hold every key of this fleet yet. Once per credential and
 * key set: a refusal stays until the credential or the keys change or a fleet admin acts; a failure is retried after
 * {@link RETRY_FAILED_MS}. A revoked trust (a cluster admin removed the fleet) is never re-registered automatically.
 */
export function shouldAttemptTrust(
  cluster: Pick<FleetClusterEntity, 'state' | 'credentialHint'>,
  health: FleetClusterHealth,
  keyIds: readonly string[],
  now = new Date(),
): boolean {
  if (!fleetAutoTrustEnabled() || cluster.state === 'retired' || !health.clusterId) return false;

  if (health.state !== 'healthy' && health.state !== 'degraded') return false;

  const missing =
    health.identity === 'untrusted' ||
    (health.identity === 'verified' &&
      !!health.identityKeys &&
      keyIds.some((kid) => !(health.identityKeys ?? []).includes(kid)));

  if (!missing) return false;

  const last = health.trust;

  if (last?.state === 'revoked') return false;

  const sameKeys =
    !!last?.keyIds && last.keyIds.length === keyIds.length && keyIds.every((kid) => last.keyIds?.includes(kid));

  if (!last || last.credentialHint !== cluster.credentialHint || !sameKeys) return true;

  if (last.state === 'failed') return now.getTime() - new Date(last.at).getTime() >= RETRY_FAILED_MS;

  return false;
}

/**
 * The poll's view of a revocation: the cluster verified this fleet before and doesn't now (its issuer is unknown
 * there) — a cluster admin removed it under Trusted fleets.
 */
export function trustRevoked(previous: FleetClusterHealth | undefined, next: FleetClusterHealth): boolean {
  // Only an unknown issuer: an unregistered key (e.g. activated too early) is a rotation problem, not a revocation.
  return (
    previous?.identity === 'verified' &&
    next.identity === 'untrusted' &&
    /is not trusted by this cluster/i.test(next.identityReason ?? '')
  );
}

/** The keys to send with a one-time admin token: the fleet's first, then the cluster's others (newest first), ≤ 3. */
export function mergeRegistrationKeys(
  registration: FleetRegistration,
  existing: TrustedFleetLike | undefined,
  max = 3,
): { kid: string; publicKey: string }[] {
  const ours = registration.keys.map((k) => ({ kid: k.kid, publicKey: k.publicKey }));
  const ids = new Set(ours.map((k) => k.kid));
  const others = (existing?.keys ?? [])
    .filter((k): k is { kid: string; publicKey: string; addedAt?: string } => !!k.kid && !!k.publicKey)
    .filter((k) => !ids.has(k.kid))
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    .map((k) => ({ kid: k.kid, publicKey: k.publicKey }));

  return [...ours, ...others].slice(0, max);
}

function holdsAll(existing: TrustedFleetLike | undefined, registration: FleetRegistration): boolean {
  return registration.keys.every((k) =>
    (existing?.keys ?? []).some((e) => e.kid === k.kid && (e.publicKey ?? '').trim() === k.publicKey.trim()),
  );
}

function short(message: string): string {
  return message.slice(0, 300);
}

/**
 * Trust between this fleet and its clusters (2026-10-29): registers the fleet's own signing keys in a cluster's
 * "trusted fleets" through the cluster's authenticated API — with the connection's service credential when the
 * cluster lets that credential manage trusted fleets (its cluster-admin checks decide), or with a cluster admin's
 * one-time token (used for this one call, never stored or logged). Before registering, the cluster must answer over
 * the connection's verified TLS with the pinned cluster id. Idempotent; audited here and in the cluster.
 */
@Injectable()
export class FleetTrustService {
  private readonly logger = new Logger(FleetTrustService.name);

  constructor(
    @InjectRepository(FleetClusterEntity) private readonly clusters: Repository<FleetClusterEntity>,
    private readonly client: FleetClusterClient,
    private readonly identity: FleetIdentityService,
    private readonly audit: FleetAuditService,
  ) {}

  /** The key ids this fleet wants every cluster to hold (active + next). */
  async keyIds(): Promise<string[]> {
    return (await this.identity.registration()).keys.map((k) => k.kid);
  }

  /**
   * Establishes trust with one cluster. `caller` = the fleet admin who asked (null: automatic). With `adminToken`
   * the registration uses that token instead of the stored credential (the token is not kept anywhere).
   */
  async establish(
    cluster: FleetClusterEntity,
    caller: FleetCaller | null,
    options: { adminToken?: string } = {},
  ): Promise<{ attempt: FleetTrustAttempt; health: FleetClusterHealth }> {
    if (cluster.state === 'retired') throw new BadRequestException('the cluster is retired');

    const adminToken = options.adminToken?.trim() || undefined;
    const via: FleetTrustAttempt['via'] = adminToken ? 'one-time-token' : 'service-credential';
    const registration = await this.identity.registration();
    const outcome = await this.register(cluster, caller, registration, adminToken);
    const attempt: FleetTrustAttempt = {
      state: outcome.state,
      at: new Date().toISOString(),
      via,
      by: caller && !caller.isApiKey ? caller.userId : null,
      reason: outcome.reason,
      credentialHint: cluster.credentialHint,
      keyIds: registration.keys.map((k) => k.kid),
    };

    // The cluster's answer after a change (trusted since, key ids) from the fleet's regular probe.
    const identity =
      outcome.state === 'established' || outcome.state === 'already-trusted'
        ? await this.probeIdentity(cluster, outcome.clusterId ?? cluster.health?.clusterId ?? null)
        : {};
    const health: FleetClusterHealth = {
      ...cluster.health,
      ...identity,
      pinnedClusterId: cluster.health?.pinnedClusterId ?? outcome.clusterId ?? cluster.health?.clusterId ?? null,
      trust: attempt,
    };

    await this.clusters.update({ id: cluster.id }, { health });
    cluster.health = health;

    if (outcome.state !== 'already-trusted' && (outcome.state === 'established' || caller))
      await this.audit.recordQuietly(
        caller,
        outcome.state === 'established' ? 'identity.trust-established' : 'identity.trust-refused',
        `cluster/${cluster.id}/trust`,
        {
          cluster: cluster.name,
          issuer: registration.issuer,
          keys: registration.keys.map((k) => ({ kid: k.kid, fingerprint: k.fingerprint })),
          via,
          outcome: outcome.state,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        },
        cluster.id,
      );

    return { attempt, health };
  }

  /** After a key rotation step: registers the fleet's keys in every cluster that doesn't hold them yet. */
  async syncAll(caller: FleetCaller | null): Promise<void> {
    // Part of automatic trust: with it off, fleet admins use "Establish trust" per cluster.
    if (!fleetAutoTrustEnabled()) return;

    const ids = await this.keyIds();
    const clusters = await this.clusters.find({ where: { state: Not('retired') } });

    for (const cluster of clusters) {
      const health = cluster.health ?? ({ state: 'unknown' } as FleetClusterHealth);

      if (!health.clusterId || health.identity === 'unsupported') continue;

      if (health.identity === 'verified' && health.identityKeys && ids.every((k) => health.identityKeys?.includes(k)))
        continue;

      try {
        await this.establish(cluster, caller);
      } catch (error) {
        this.logger.warn(`Trust with ${cluster.name}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  private async probeIdentity(
    cluster: ClusterConnection,
    clusterId: string | null,
  ): Promise<
    Pick<FleetClusterHealth, 'identity' | 'identityReason' | 'identitySince' | 'identityKeys' | 'identityCheckedAt'>
  > {
    if (!clusterId) return {};

    try {
      const identityCheckedAt = new Date().toISOString();
      const { data } = await this.client.json<IdentityStatusLike>(cluster, {
        method: 'GET',
        path: 'fleet-identity',
        identity: await this.identity.probeClaim(clusterId),
      });

      return data?.verified === true
        ? {
            identity: 'verified',
            identityReason: null,
            identitySince: data.trustedSince ?? null,
            identityKeys: data.trustedKeys ?? null,
            identityCheckedAt,
          }
        : {
            identity: 'untrusted',
            identityReason: short(data?.reason ?? 'not trusted'),
            identitySince: null,
            identityKeys: null,
            identityCheckedAt,
          };
    } catch {
      // Unanswered: the health keeps its older identity (and `identityCheckedAt`), so the attempt shows as pending.
      return {};
    }
  }

  private async register(
    cluster: FleetClusterEntity,
    caller: FleetCaller | null,
    registration: FleetRegistration,
    adminToken: string | undefined,
  ): Promise<{ state: FleetTrustOutcome; reason: string | null; clusterId?: string }> {
    // The connection used for the registration: the stored service credential, or the one-time token (same
    // endpoint, same CA / TLS verification, same SSRF guard — only the bearer differs).
    const connection: ClusterConnection = adminToken ? { ...cluster, credential: adminToken } : cluster;
    const label = caller?.label ?? 'fleet:system';

    // 1. Cluster identity: the cluster id over this connection must be the pinned one (else: a different cluster
    //    answers at this endpoint, or the cluster was rebuilt; a fleet admin re-verifies the connection first).
    let clusterId: string;

    try {
      const { data } = await this.client.json<{ clusterId?: unknown }>(connection, { method: 'GET', path: 'cluster' });

      if (typeof data?.clusterId !== 'string' || !data.clusterId)
        return { state: 'failed', reason: 'the cluster did not report its id' };

      clusterId = data.clusterId;
    } catch (error) {
      return this.failure(error, adminToken ? 'the one-time token was rejected by the cluster' : null);
    }

    const pinned = cluster.health?.pinnedClusterId ?? cluster.health?.clusterId ?? null;

    if (pinned && pinned !== clusterId)
      return {
        state: 'identity-mismatch',
        reason: `the cluster answered as ${clusterId}, but this connection belongs to ${pinned}`,
        clusterId,
      };

    // 2. Already trusted? (the fleet's probe through its own credential: verified and every key held)
    const status: IdentityStatusLike | 'unsupported' | null = await this.client
      .json<IdentityStatusLike>(cluster, {
        method: 'GET',
        path: 'fleet-identity',
        identity: await this.identity.probeClaim(clusterId),
      })
      .then((r) => r.data)
      .catch((error: unknown) =>
        error instanceof FleetClusterError && error.status === 404 ? ('unsupported' as const) : null,
      );

    if (status === 'unsupported')
      return {
        state: 'unsupported',
        reason: 'the cluster does not verify fleet identities (older version)',
        clusterId,
      };

    const trustedKeys = status?.trustedKeys;

    if (status?.verified === true && (!trustedKeys || registration.keys.every((k) => trustedKeys.includes(k.kid))))
      return { state: 'already-trusted', reason: null, clusterId };

    // 3. The registration: exactly this fleet's issuer and keys (never a browser's input), with a claim signed by the
    //    active key over this request (the cluster checks the proof, its admin role and scopes).
    let body: { name: string; keys: { kid: string; publicKey: string }[] } = {
      name: registration.name,
      keys: registration.keys.map((k) => ({ kid: k.kid, publicKey: k.publicKey })),
    };

    if (adminToken) {
      // A cluster admin's token replaces the keys natively: keep the cluster's other keys (rotation grace).
      try {
        const { data } = await this.client.json<TrustedFleetLike[]>(connection, {
          method: 'GET',
          path: 'trusted-fleets',
          onBehalfOf: label,
        });
        const existing = Array.isArray(data) ? data.find((f) => f.issuer === registration.issuer) : undefined;

        if (holdsAll(existing, registration)) return { state: 'already-trusted', reason: null, clusterId };

        body = { name: existing?.name || registration.name, keys: mergeRegistrationKeys(registration, existing) };
      } catch (error) {
        return this.failure(error, 'the one-time token may not manage trusted fleets', clusterId);
      }
    }

    const path = `trusted-fleets/${encodeURIComponent(registration.issuer)}`;
    const bytes = Buffer.from(JSON.stringify(body));

    try {
      await this.client.json(connection, {
        method: 'PUT',
        path,
        headers: { 'content-type': 'application/json' },
        body: bytes,
        onBehalfOf: label,
        identity: await this.identity.registrationClaim(caller, clusterId, fleetClaimUrl(path, ''), bytes),
      });

      return { state: 'established', reason: null, clusterId };
    } catch (error) {
      return this.failure(
        error,
        adminToken
          ? 'the one-time token may not manage trusted fleets'
          : 'the fleet’s credential for this cluster may not manage trusted fleets',
        clusterId,
      );
    }
  }

  private failure(
    error: unknown,
    refused: string | null,
    clusterId?: string,
  ): { state: FleetTrustOutcome; reason: string | null; clusterId?: string } {
    const status = error instanceof FleetClusterError ? error.status : null;
    const message = error instanceof Error ? error.message : String(error);

    if (status === 401 || status === 403)
      return { state: 'forbidden', reason: short(refused ? `${refused}: ${message}` : message), clusterId };

    if (status === 404)
      return {
        state: 'unsupported',
        reason: 'the cluster does not verify fleet identities (older version)',
        clusterId,
      };

    return { state: 'failed', reason: short(message), clusterId };
  }
}
