import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

import { assertPatScopes, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { HttpException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';

import { fleetRelayLimits } from '../constants/fleet.constants';
import { authorizeRelay, type RelayDecision } from '../utils/relay-rules';
import { filterRelayResponseHeaders } from '../utils/relay-headers';
import { parseRelayQuery, type RelayQuery } from '../utils/relay-query';
import { byteLimit } from '../utils/stream-limits';
import { FleetAccessService } from './fleet-access.service';
import { FleetAuditService } from './fleet-audit.service';
import { FleetClusterClient } from './fleet-cluster-client.service';

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

    const limits = fleetRelayLimits();
    let body: Readable | undefined;

    if (BODY_METHODS.has(method)) {
      const declared = Number(req.headers['content-length'] ?? '0');

      if (Number.isFinite(declared) && declared > limits.maxRequestBytes)
        throw new PayloadTooLargeException(`request larger than ${limits.maxRequestBytes} bytes`);

      if (declared > 0 || req.headers['transfer-encoding']) body = req.pipe(byteLimit(limits.maxRequestBytes));
    }

    const upstream = await this.client.stream(cluster, {
      method,
      path: split.path.replace(/^\/+|\/+$/g, ''),
      query,
      headers: req.headers as Record<string, unknown>,
      body,
      onBehalfOf: caller.label,
      timeoutMs: limits.timeoutMs,
    });

    // The caller's own credential never reaches the cluster: a 401 / 403 there is about the fleet's service
    // credential (revoked, expired, missing scope / role) — a gateway problem, not the caller's authentication.
    if (upstream.status === 401 || upstream.status === 403) {
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
