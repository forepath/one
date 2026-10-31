import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

import { assertPatScopes, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { HttpException, Injectable, Logger, Optional, PayloadTooLargeException } from '@nestjs/common';

import { fleetConsoleOrigins, fleetRelayLimits, fleetRelayStreamTimeoutMs } from '../constants/fleet.constants';
import type { FleetIdentityState } from '../entities/fleet-cluster.entity';
import {
  declaredStreamBody,
  FLEET_CLAIM_MAX_BODY_BYTES,
  fleetClaimUrl,
  fleetStreamBinding,
  isClaimableContentType,
  fleetClaimsIgnored,
} from '../utils/fleet-identity-claims';
import { relayWriteBlock } from '../utils/cluster-availability';
import { authorizeRelay, type RelayDecision } from '../utils/relay-rules';
import { filterRelayResponseHeaders } from '../utils/relay-headers';
import { parseRelayQuery, serializeRelayQuery, type RelayQuery } from '../utils/relay-query';
import { byteLimit } from '../utils/stream-limits';
import { FleetAccessService } from './fleet-access.service';
import { FleetAuditService } from './fleet-audit.service';
import {
  clusterFailureText,
  FleetClusterClient,
  FleetClusterError,
  isTemporaryClusterFailure,
} from './fleet-cluster-client.service';
import { FleetIdentityService } from './fleet-identity.service';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Path and raw query of `/…/clusters/<id>/api/<path>?<query>` (the raw URL: the path is authorised as the cluster
 * routes it, the query is parsed with the cluster's own parser by {@link parseRelayQuery}).
 */
export function splitRelayUrl(originalUrl: string, clusterId: string): { path: string; rawQuery: string } | null {
  const marker = `/clusters/${clusterId}/api/`;
  const at = originalUrl.indexOf(marker);

  if (at < 0) return null;

  const rest = originalUrl.slice(at + marker.length);
  const q = rest.indexOf('?');

  return { path: q < 0 ? rest : rest.slice(0, q), rawQuery: q < 0 ? '' : rest.slice(q + 1) };
}

/**
 * Approvals through the fleet (3.24) need a cluster that verifies this fleet's identity claims: older clusters keep
 * them native (404, like any route the fleet doesn't relay), clusters that don't trust the key yet answer 403.
 */
/** What a request needs the signed person for, as the relay's refusals name it. */
export type FleetIdentityPurpose = 'approvals' | 'secrets' | 'requests on your behalf';

/**
 * Requests that need the signed person (approvals, secrets, person-scoped and personal routes) go only to clusters
 * that verify this fleet's claims on this connection. The refusal names the cause the cluster page shows: no trust
 * yet, trust in place but the connection's credential can't carry identities ("Not in effect"), or an older cluster.
 */
export function assertIdentityRelayable(
  health: { identity?: FleetIdentityState; identityReason?: string | null } | null | undefined,
  purpose: FleetIdentityPurpose = 'approvals',
): void {
  const identity = health?.identity;

  if (identity === 'verified') return;

  if (fleetClaimsIgnored(health))
    throw new HttpException(
      `${purpose} through the fleet need your signed identity, but the cluster ignores it on this connection: ${health?.identityReason}`,
      403,
    );

  if (identity === 'untrusted')
    throw new HttpException(
      `${purpose} need the cluster to trust this fleet: a fleet admin establishes trust on the fleet’s cluster page`,
      403,
    );

  throw new HttpException(`${purpose} are not relayed to this cluster: it does not verify fleet identities`, 404);
}

/** The console page a Git account link returns to (3.41): fixed path below one of the fleet's console origins. */
const CONSOLE_RETURN_PATH = /^(?:\/[A-Za-z0-9._~-]+)*\/account\/git-accounts$/;

/**
 * Git account linking through the fleet (3.41): the JSON body may only carry `returnUrl`, and only a page of this
 * fleet's own console (`FLEET_CONSOLE_URL` / `CORS_ORIGIN`). The fleet signs the body into the claim, so the cluster
 * accepts the return URL on the fleet's word — and the confirmation nonce never leaves for a foreign site.
 */
export function assertConsoleReturn(body: Buffer | null, origins: readonly string[]): void {
  if (!body || body.length === 0) return;

  let parsed: unknown;

  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpException('invalid JSON body', 400);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new HttpException('the body must be a JSON object', 400);

  const { returnUrl, ...rest } = parsed as Record<string, unknown>;

  if (Object.keys(rest).length > 0) throw new HttpException(`${Object.keys(rest)[0]} is not relayed`, 400);

  if (returnUrl === undefined) return;

  let url: URL | null = null;

  try {
    url = typeof returnUrl === 'string' && returnUrl.length <= 512 ? new URL(returnUrl) : null;
  } catch {
    url = null;
  }

  if (
    !url ||
    !origins.includes(url.origin) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !CONSOLE_RETURN_PATH.test(url.pathname)
  )
    throw new HttpException(
      'returnUrl must be this fleet console’s Git accounts page (FLEET_CONSOLE_URL / CORS_ORIGIN)',
      400,
    );
}

/** Reads a request body up to `limit` bytes (413 beyond). */
export async function readBounded(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

    size += buffer.length;

    if (size > limit) throw new PayloadTooLargeException(`request larger than ${limit} bytes`);

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

/** Status the fleet answers with when the cluster refuses the fleet's own service credential. */
export const CLUSTER_CREDENTIAL_REJECTED_STATUS = 502;
const ERROR_BODY_MAX_BYTES = 64 * 1024;

async function readErrorMessage(stream: Readable): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

      size += buffer.length;

      if (size > ERROR_BODY_MAX_BYTES) break;

      chunks.push(buffer);
    }
  } catch {
    return null;
  } finally {
    stream.destroy();
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { message?: unknown };
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;

    return typeof message === 'string' ? message.slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** Retry hint of a 503 for a cluster that is restarting / busy (seconds). */
export const CLUSTER_UNREACHABLE_RETRY_AFTER_SECONDS = 10;

/**
 * The fleet's answer when the cluster couldn't be reached at all (3.43 live test: a read during the cluster's takeover
 * restart answered 500 "socket hang up"): 503 + Retry-After for a refused / reset / hung-up / timed-out connection (the
 * API is restarting or busy), 502 for anything else (no route, TLS). Errors with an HTTP status pass through.
 */
export function relayUpstreamException(error: unknown, clusterName: string): HttpException | null {
  if (!(error instanceof FleetClusterError) || error.status !== null) return null;

  const failure = error.failure ?? 'other';
  const temporary = isTemporaryClusterFailure(failure);
  const status = temporary ? 503 : 502;

  return new HttpException(
    {
      statusCode: status,
      error: temporary ? 'Service Unavailable' : 'Bad Gateway',
      code: 'cluster-unreachable',
      reason: failure,
      message: `cluster ${clusterName} is not reachable: ${clusterFailureText(failure)}${
        temporary ? ' (it may be restarting); retry in a moment' : ''
      }`,
    },
    status,
  );
}

type RelayRequest = RequestWithUser & IncomingMessage & { originalUrl?: string; url?: string };

/**
 * REST relay (3.24): `/clusters/:id/api/*` → the cluster's REST API. The caller's grant is checked against the
 * method / path allow-list first; then the request is forwarded with the cluster's service credential and the
 * caller as on-behalf-of, the response streamed back (bounded in size and time). Changes are audited at the fleet.
 */
@Injectable()
export class FleetRelayService {
  private readonly logger = new Logger(FleetRelayService.name);

  constructor(
    private readonly access: FleetAccessService,
    private readonly client: FleetClusterClient,
    private readonly audit: FleetAuditService,
    @Optional() private readonly identity?: FleetIdentityService,
  ) {}

  async relay(req: RelayRequest, res: ServerResponse, clusterId: string): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();

    assertPatScopes(getUserFromRequest(req), READ_METHODS.has(method) ? 'fleet:read' : 'fleet:relay');

    const caller = this.access.caller(req);
    const { cluster, access } = await this.access.visibleCluster(caller, clusterId);
    const split = splitRelayUrl(req.originalUrl ?? req.url ?? '', clusterId);

    if (!split) throw new HttpException('invalid relay path', 400);

    // Parsed exactly like the cluster parses it (limits, repeated `project` refused); the forwarded query is
    // re-serialised from these parameters, so the cluster reads what was authorised and nothing else.
    const parsedQuery = parseRelayQuery(split.rawQuery);

    if (parsedQuery.ok !== true)
      throw new HttpException((parsedQuery as Extract<typeof parsedQuery, { ok: false }>).reason, 400);

    const query: RelayQuery = parsedQuery.query;
    const decision = authorizeRelay(method, split.path, query, access);

    if (decision.allowed !== true) {
      const denied = decision as Extract<RelayDecision, { allowed: false }>;

      throw new HttpException(denied.reason, denied.status);
    }

    // 3.43 (2026-10-31): no changes to a cluster the fleet's last poll found unreachable or read-only (a recent poll
    // only, so a cluster that came back isn't refused for long); reads go through.
    const paused = relayWriteBlock(method, split.path, cluster.health, cluster.name);

    if (paused) throw new HttpException(paused, 503);

    // Approvals (3.24) only to clusters that verify this fleet's identity claims (older ones keep them native).
    if (decision.rule.approval || decision.needsClaim)
      assertIdentityRelayable(
        cluster.health,
        decision.rule.approval ? 'approvals' : decision.rule.secret ? 'secrets' : 'requests on your behalf',
      );

    const limits = fleetRelayLimits();
    const path = split.path.replace(/^\/+|\/+$/g, '');
    let body: Readable | Buffer | undefined;
    let bodyBytes: Buffer | null = null;
    let claimable = true;
    let bodyBinding: string | undefined;
    let upload: AbortController | null = null;

    if (BODY_METHODS.has(method) && decision.rule.stream) {
      // Streamed upload (release bundles, 2026-10-27): no size limit here (the cluster enforces its own), the
      // request is piped as is (backpressure through the socket), bound into the claim by its declared length +
      // SHA-256 when the caller sent them (else no claim, like any unbound body).
      const declared = declaredStreamBody(req.headers as Record<string, unknown>);

      body = req;
      upload = new AbortController();

      if (declared) bodyBinding = fleetStreamBinding(declared.length, declared.sha256);
      else claimable = false;
    } else if (BODY_METHODS.has(method)) {
      const declared = Number(req.headers['content-length'] ?? '0');

      if (Number.isFinite(declared) && declared > limits.maxRequestBytes)
        throw new PayloadTooLargeException(`request larger than ${limits.maxRequestBytes} bytes`);

      if (declared > 0 || req.headers['transfer-encoding']) {
        // JSON bodies are bound into the identity claim (hashed), so they are read first (≤ 3 MiB, the cluster's
        // JSON limit); other bodies (file uploads) are streamed without a claim.
        if (this.identity && isClaimableContentType(req.headers['content-type'])) {
          bodyBytes = await readBounded(req, Math.min(limits.maxRequestBytes, FLEET_CLAIM_MAX_BODY_BYTES));
          body = bodyBytes;
        } else {
          body = req.pipe(byteLimit(limits.maxRequestBytes));
          claimable = false;
        }
      }
    }

    // Git account linking (3.41): the callback's return page must be this fleet's own console.
    if (decision.rule.consoleReturn) assertConsoleReturn(bodyBytes, fleetConsoleOrigins());

    const audience = cluster.health?.clusterId;
    const identity =
      claimable && audience && this.identity
        ? await this.identity.claimFor(caller, access, {
            audience,
            method,
            url: fleetClaimUrl(path, serializeRelayQuery(query)),
            body: bodyBytes,
            ...(bodyBinding ? { bodyBinding } : {}),
          })
        : null;

    if (decision.rule.approval && !identity)
      throw new HttpException('approvals through the fleet need a signed-in user (no API key)', 403);

    // Secrets / the recovery kit always, project grants on person-scoped routes: the cluster must act as the person.
    if (decision.needsClaim && !identity)
      throw new HttpException(
        decision.rule.secret
          ? 'secrets and the recovery kit through the fleet need a signed-in user (no API key without delegation)'
          : 'project grants through the fleet need a signed-in user (no API key)',
        403,
      );

    const stopUpload = upload ? this.guardUpload(req, upload, `${cluster.name} ${method} ${split.path}`) : null;

    res.on('close', () => stopUpload?.());

    const upstream = await this.client
      .stream(cluster, {
        method,
        path,
        query,
        headers: req.headers as Record<string, unknown>,
        body,
        onBehalfOf: caller.label,
        identity,
        timeoutMs: limits.timeoutMs,
        ...(upload ? { signal: upload.signal } : {}),
      })
      .catch((error: unknown) => {
        const mapped = relayUpstreamException(error, cluster.name);

        if (!mapped) throw error;

        this.logger.warn(`Relay ${cluster.name} ${method} ${split.path}: ${(error as Error).message}`);

        if (mapped.getStatus() === 503) res.setHeader('Retry-After', String(CLUSTER_UNREACHABLE_RETRY_AFTER_SECONDS));

        throw mapped;
      });

    // The caller's own credential never reaches the cluster: a 401 / 403 there is about the fleet's service
    // credential (revoked, expired, missing scope / role) — a gateway problem, not the caller's authentication.
    // Approvals, secrets and requests that needed the verified person are the exception: their 403 is the cluster's
    // decision about that person.
    // Person-scoped / personal routes relayed as the signed person (project grants, linked Git accounts, 3.41) too.
    const personDecides = (decision.rule.approval || decision.rule.secret || decision.needsClaim) && identity;

    if (upstream.status === 401 || (upstream.status === 403 && !personDecides)) {
      const detail = await readErrorMessage(upstream.data);
      const message =
        upstream.status === 401
          ? 'cluster rejected the fleet credential'
          : `cluster refused the fleet credential${detail ? `: ${detail}` : ''}`;

      this.logger.warn(`Relay ${cluster.name} ${method} ${split.path}: HTTP ${upstream.status} (${message})`);
      await this.auditChange(caller, cluster.id, method, split.path, upstream.status, decision);
      throw new HttpException(
        { statusCode: CLUSTER_CREDENTIAL_REJECTED_STATUS, message, clusterStatus: upstream.status },
        CLUSTER_CREDENTIAL_REJECTED_STATUS,
      );
    }

    res.statusCode = upstream.status;

    for (const [name, value] of Object.entries(filterRelayResponseHeaders(upstream.headers as Record<string, unknown>)))
      res.setHeader(name, value);

    // Secret metadata and recovery-kit shares never land in a cache between the console and the fleet.
    if (decision.rule.secret) res.setHeader('cache-control', 'no-store');

    const limit = byteLimit(limits.maxResponseBytes);

    res.on('close', () => {
      if (!res.writableFinished) upstream.data.destroy();
    });
    limit.on('error', (error) => {
      this.logger.warn(`Relay ${cluster.name} ${method} ${split.path}: ${error.message}`);
      upstream.data.destroy();
      res.destroy(error);
    });
    upstream.data.on('error', (error) => res.destroy(error));
    upstream.data.pipe(limit).pipe(res);

    await this.auditChange(caller, cluster.id, method, split.path, upstream.status, decision);
  }

  /**
   * A streamed upload is aborted towards the cluster when the caller disconnects before sending everything or when
   * it exceeds `FLEET_RELAY_STREAM_TIMEOUT_MS` overall; returns the cleanup.
   */
  private guardUpload(req: RelayRequest, upload: AbortController, label: string): () => void {
    const timer = setTimeout(() => {
      this.logger.warn(`Relay ${label}: upload exceeded ${fleetRelayStreamTimeoutMs()} ms, aborted`);
      upload.abort(new Error('upload took too long'));
    }, fleetRelayStreamTimeoutMs());
    const disconnected = () => {
      if (!(req as IncomingMessage).complete) upload.abort(new Error('caller disconnected'));
    };

    timer.unref?.();
    req.on('aborted', disconnected);
    req.on('close', disconnected);

    return () => {
      clearTimeout(timer);
      req.off('aborted', disconnected);
      req.off('close', disconnected);
    };
  }

  private async auditChange(
    caller: ReturnType<FleetAccessService['caller']>,
    clusterId: string,
    method: string,
    path: string,
    status: number,
    decision: Extract<RelayDecision, { allowed: true }>,
  ): Promise<void> {
    if (READ_METHODS.has(method)) return;

    await this.audit.recordQuietly(
      caller,
      'relay.request',
      `cluster/${clusterId}/api/${path}`.slice(0, 512),
      { method, status, role: decision.role, project: decision.project },
      clusterId,
    );
  }
}
