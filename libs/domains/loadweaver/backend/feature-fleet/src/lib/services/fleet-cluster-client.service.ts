import * as http from 'node:http';
import * as https from 'node:https';
import type { Readable } from 'node:stream';

import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosResponse, type Method } from 'axios';

import { fleetClusterRequestTimeoutMs } from '../constants/fleet.constants';
import type { FleetClusterEntity } from '../entities/fleet-cluster.entity';
import { FLEET_IDENTITY_HEADER } from '../utils/fleet-identity-claims';
import { buildRelayRequestHeaders } from '../utils/relay-headers';
import { serializeRelayQuery } from '../utils/relay-query';
import {
  clusterTlsRejectUnauthorized,
  createGuardedLookup,
  normalizeClusterEndpoint,
} from '../utils/fleet-endpoint-security';

/**
 * Why a cluster couldn't be reached (3.43 live test: a relay during the cluster's restart answered 500 "socket hang
 * up"). `refused` / `reset` / `hang-up` / `timeout`: the API is restarting or overloaded (temporary, 503); `network`:
 * no route / name; `tls`: certificate or handshake; `aborted`: the fleet cancelled it; `other`: anything else.
 */
export type ClusterConnectionFailure =
  | 'refused'
  | 'reset'
  | 'hang-up'
  | 'timeout'
  | 'network'
  | 'tls'
  | 'aborted'
  | 'other';

const FAILURE_BY_CODE: Record<string, ClusterConnectionFailure> = {
  ECONNREFUSED: 'refused',
  ECONNRESET: 'reset',
  EPIPE: 'reset',
  ECONNABORTED: 'timeout',
  ETIMEDOUT: 'timeout',
  ESOCKETTIMEDOUT: 'timeout',
  EHOSTUNREACH: 'network',
  ENETUNREACH: 'network',
  EHOSTDOWN: 'network',
  ENOTFOUND: 'network',
  EAI_AGAIN: 'network',
  ERR_CANCELED: 'aborted',
};

/** Classifies a failed request to a cluster (an axios / Node error without an HTTP response). */
export function clusterConnectionFailure(error: unknown): ClusterConnectionFailure {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';

  // Node reports a peer that closed before answering as ECONNRESET "socket hang up".
  if (/socket hang up/i.test(text)) return 'hang-up';

  if (typeof code === 'string') {
    if (FAILURE_BY_CODE[code]) return FAILURE_BY_CODE[code];

    if (/^(ERR_TLS|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code)) return 'tls';
  }

  if (/timeout/i.test(text)) return 'timeout';

  return 'other';
}

/** Connection failures that mean "the cluster's API is restarting / busy": 503 with Retry-After. */
export function isTemporaryClusterFailure(failure: ClusterConnectionFailure | null | undefined): boolean {
  return failure === 'refused' || failure === 'reset' || failure === 'hang-up' || failure === 'timeout';
}

const FAILURE_TEXT: Record<ClusterConnectionFailure, string> = {
  refused: 'the connection was refused',
  reset: 'the connection was reset',
  'hang-up': 'the cluster closed the connection before answering',
  timeout: 'the cluster did not answer in time',
  network: 'no network route to the cluster',
  tls: 'the TLS connection to the cluster failed',
  aborted: 'the request was cancelled',
  other: 'the request failed',
};

export function clusterFailureText(failure: ClusterConnectionFailure): string {
  return FAILURE_TEXT[failure];
}

/** A request to a cluster failed: unreachable (no HTTP status) or answered with an error status. */
export class FleetClusterError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body?: unknown,
    /** Set when the cluster couldn't be reached (`status` null). */
    readonly failure: ClusterConnectionFailure | null = null,
  ) {
    super(message);
    this.name = 'FleetClusterError';
  }
}

export type ClusterConnection = Pick<
  FleetClusterEntity,
  'id' | 'endpoint' | 'caCertificate' | 'credential' | 'updatedAt'
>;

export interface ClusterRequest {
  method: string;
  /** Path after `/api/` (already authorised / normalised). */
  path: string;
  query?: Record<string, unknown>;
  /** Caller headers (filtered by the allow-list) for relayed requests. */
  headers?: Record<string, unknown>;
  body?: unknown;
  onBehalfOf?: string;
  /** Signed identity claim of the acting user (3.24), `X-Loadweaver-Fleet-Identity`. */
  identity?: string | null;
  timeoutMs?: number;
  /** Aborts the request (streamed uploads: caller disconnect, overall timeout). */
  signal?: AbortSignal;
}

/**
 * Agent towards a cluster: keep-alive, TLS verified (optionally against the cluster's own CA) and the SSRF-guarded
 * `lookup`, so every connection (HTTP relay, JSON calls, socket relay) validates the addresses it actually uses.
 */
export function createClusterAgent(cluster: Pick<ClusterConnection, 'caCertificate'>, secure: boolean): http.Agent {
  const lookup = createGuardedLookup();

  return secure
    ? new https.Agent({
        keepAlive: true,
        maxSockets: 32,
        rejectUnauthorized: clusterTlsRejectUnauthorized(),
        lookup,
        ...(cluster.caCertificate ? { ca: cluster.caCertificate } : {}),
      })
    : new http.Agent({ keepAlive: true, maxSockets: 32, lookup });
}

/**
 * HTTP client of the fleet towards clusters (3.24): every request goes to `<endpoint>/api/<path>` with the
 * cluster's service credential, TLS verified (optionally against the cluster's own CA), the endpoint re-checked
 * against the SSRF rules, the resolved addresses checked inside the agent's `lookup` (DNS rebinding) and a timeout.
 */
@Injectable()
export class FleetClusterClient {
  private readonly logger = new Logger(FleetClusterClient.name);
  private readonly agents = new Map<string, { key: string; agent: http.Agent }>();

  private agentFor(cluster: ClusterConnection, secure: boolean): http.Agent {
    const key = `${cluster.endpoint}|${cluster.caCertificate ?? ''}|${cluster.updatedAt?.getTime?.() ?? 0}`;
    const cached = this.agents.get(cluster.id);

    if (cached?.key === key) return cached.agent;

    cached?.agent.destroy();

    const agent = createClusterAgent(cluster, secure);

    this.agents.set(cluster.id, { key, agent });

    return agent;
  }

  /**
   * Re-validates the stored endpoint (rules may have changed since registration); DNS answers are validated by
   * the agent's `lookup` on every connection (no separate pre-check that a rebinding answer could race).
   */
  async target(cluster: ClusterConnection): Promise<{ base: string; agent: http.Agent }> {
    const { endpoint } = normalizeClusterEndpoint(cluster.endpoint);

    return { base: `${endpoint}/api`, agent: this.agentFor(cluster, endpoint.startsWith('https:')) };
  }

  url(base: string, path: string, query?: Record<string, unknown>): string {
    const params = serializeRelayQuery(query);

    return `${base}/${path.replace(/^\/+/, '')}${params ? `?${params}` : ''}`;
  }

  private async send<T>(
    cluster: ClusterConnection,
    request: ClusterRequest,
    responseType: 'json' | 'stream',
  ): Promise<AxiosResponse<T>> {
    const { base, agent } = await this.target(cluster);
    const headers = buildRelayRequestHeaders(request.headers ?? {}, cluster.credential, request.onBehalfOf ?? '');

    if (request.identity) headers[FLEET_IDENTITY_HEADER] = request.identity;

    if (responseType === 'json' && request.body !== undefined && !headers['content-type'])
      headers['content-type'] = 'application/json';

    try {
      return await axios.request<T>({
        method: request.method as Method,
        url: this.url(base, request.path, request.query),
        headers,
        data: request.body,
        responseType,
        timeout: request.timeoutMs ?? fleetClusterRequestTimeoutMs(),
        ...(request.signal ? { signal: request.signal } : {}),
        httpAgent: agent,
        httpsAgent: agent,
        maxRedirects: 0,
        // Bodies are streamed / bounded by the callers; axios' own limits would buffer.
        maxBodyLength: Infinity,
        maxContentLength: responseType === 'json' ? 32 * 1024 * 1024 : Infinity,
        validateStatus: () => true,
        decompress: responseType === 'json',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.debug(`Cluster ${cluster.id}: ${message}`);
      throw new FleetClusterError(`cluster unreachable: ${message}`, null, undefined, clusterConnectionFailure(error));
    }
  }

  /** JSON request; error statuses throw {@link FleetClusterError} with the cluster's message. */
  async json<T>(
    cluster: ClusterConnection,
    request: ClusterRequest,
  ): Promise<{ data: T; headers: Record<string, unknown> }> {
    const response = await this.send<T>(cluster, request, 'json');

    if (response.status >= 400) {
      const body = response.data as { message?: unknown } | undefined;
      const message = typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`;

      throw new FleetClusterError(message, response.status, response.data);
    }

    return { data: response.data, headers: response.headers as Record<string, unknown> };
  }

  /** Streaming request (relay, archives): the caller handles status, headers and the body stream. */
  async stream(cluster: ClusterConnection, request: ClusterRequest): Promise<AxiosResponse<Readable>> {
    return await this.send<Readable>(cluster, request, 'stream');
  }
}
