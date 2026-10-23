import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { Resource } from '@forepath/loadweaver/shared/util-model';

/** One HTTP exchange; injectable so tests run against a mocked control plane. */
export interface HttpExchange {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type HttpTransport = (exchange: HttpExchange) => Promise<{ status: number; body: string }>;

export class LoadweaverApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}: ${apiErrorMessage(body)}`);
  }
}

/** The human part of a Nest error body (`message` may be a string, a list or an object with `message`). */
export function apiErrorMessage(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;

    if (typeof message === 'string') return message;

    if (Array.isArray(message)) return message.map(String).join('; ');

    return JSON.stringify(message);
  }

  return typeof body === 'string' ? body : JSON.stringify(body);
}

/** Plan statuses of the control plane (OpenAPI `PlanResponseDto.status`). */
export type PlanStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'discarded'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed';

export const FINAL_PLAN_STATUSES: ReadonlySet<PlanStatus> = new Set([
  'applied',
  'failed',
  'discarded',
  'rolled-back',
  'rollback-failed',
]);

export interface PlanChange {
  action: 'create' | 'update' | 'delete' | 'unchanged';
  kind: string;
  name: string;
  project?: string | null;
}

/** The parts of `PlanResponseDto` the provider reads. */
export interface PlanView {
  id: string;
  status: PlanStatus;
  changes: PlanChange[];
  networkChanges?: { layer: string; action: string; node?: string; summary?: string }[];
  workloadChanges?: {
    action: string;
    replica?: string;
    volume?: string;
    from?: string;
    to?: string;
    methodLabel?: string;
  }[];
  diagnostics?: Record<string, unknown>[];
  warnings?: Record<string, unknown>[];
  risk?: Record<string, string[]>;
  approvals?: { project: string; userId: string }[];
  error?: string | null;
}

export interface ResourceRefInput {
  kind: string;
  name: string;
  project?: string;
}

export interface DeploymentStatusView {
  project: string;
  deployment: string;
  replicas: { id: string; service: string; node: string; addresses?: string[]; state: string }[];
  services: { name: string; addressV4: string | null; addressV6: string | null }[];
}

/** Default cap for one control-plane response body (32 MiB); larger responses are aborted. */
export const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * Node's http(s) client; `caCertificate` replaces the system CAs (control planes behind a private CA). Response bodies
 * beyond `maxResponseBytes` (default {@link DEFAULT_MAX_RESPONSE_BYTES}) abort the request.
 */
export function nodeHttpTransport(
  options: { caCertificate?: string; timeoutMs?: number; maxResponseBytes?: number } = {},
): HttpTransport {
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  return (exchange) =>
    new Promise((resolve, reject) => {
      const url = new URL(exchange.url);
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const tooLarge = () =>
        new Error(
          `response from ${url.origin} exceeds the provider's limit of ${maxBytes} bytes; aborted (is the endpoint a Loadweaver control plane?)`,
        );
      const req = send(
        url,
        {
          method: exchange.method,
          headers: {
            ...exchange.headers,
            ...(exchange.body !== undefined ? { 'content-length': String(Buffer.byteLength(exchange.body)) } : {}),
          },
          timeout: options.timeoutMs ?? 60_000,
          signal: exchange.signal,
          ...(url.protocol === 'https:' && options.caCertificate ? { ca: options.caCertificate } : {}),
        },
        (res) => {
          const abort = () => {
            reject(tooLarge());
            res.destroy();
            req.destroy();
          };

          res.on('error', reject);

          const declared = Number(res.headers['content-length']);

          if (Number.isFinite(declared) && declared > maxBytes) {
            abort();

            return;
          }

          const chunks: Buffer[] = [];
          let received = 0;
          let aborted = false;

          res.on('data', (chunk: Buffer) => {
            if (aborted) return;

            received += chunk.length;

            if (received > maxBytes) {
              aborted = true;
              chunks.length = 0;
              abort();

              return;
            }

            chunks.push(chunk);
          });
          res.on('end', () => {
            if (!aborted) resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );

      req.on('timeout', () => req.destroy(new Error(`request to ${url.origin} timed out`)));
      req.on('error', reject);
      req.end(exchange.body);
    });
}

/**
 * A thin client of the control-plane API (the same endpoints as the CLI and the console): plans, apply, discard and
 * desired-state reads. Authenticates with a personal access token.
 */
export class LoadweaverClient {
  readonly base: string;

  constructor(
    endpoint: string,
    private readonly token: string,
    private readonly transport: HttpTransport,
    private readonly userAgent: string,
  ) {
    this.base = endpoint.replace(/\/+$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.transport({
      method,
      url: `${this.base}/api${path}`,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.token}`,
        'user-agent': this.userAgent,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    let parsed: unknown = null;

    if (response.body) {
      try {
        parsed = JSON.parse(response.body);
      } catch {
        parsed = response.body;
      }
    }

    if (response.status < 200 || response.status >= 300) throw new LoadweaverApiError(response.status, parsed);

    return parsed as T;
  }

  createPlan(input: { documents?: string; delete?: ResourceRefInput[] }, signal?: AbortSignal): Promise<PlanView> {
    return this.request('POST', '/plans', input, signal);
  }

  getPlan(id: string, signal?: AbortSignal): Promise<PlanView> {
    return this.request('GET', `/plans/${encodeURIComponent(id)}`, undefined, signal);
  }

  applyPlan(id: string, confirm: boolean, signal?: AbortSignal): Promise<PlanView> {
    return this.request('POST', `/plans/${encodeURIComponent(id)}/apply`, confirm ? { confirm: true } : {}, signal);
  }

  discardPlan(id: string): Promise<PlanView> {
    return this.request('POST', `/plans/${encodeURIComponent(id)}/discard`, {});
  }

  /** The stored resource, or `null` if it doesn't exist (or isn't visible to the token). */
  async getResource(ref: ResourceRefInput, signal?: AbortSignal): Promise<Resource | null> {
    const query = ref.project ? `?project=${encodeURIComponent(ref.project)}` : '';

    try {
      return await this.request<Resource>(
        'GET',
        `/resources/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.name)}${query}`,
        undefined,
        signal,
      );
    } catch (error) {
      if (error instanceof LoadweaverApiError && error.status === 404) return null;

      throw error;
    }
  }

  deploymentStatus(project: string, deployment: string, signal?: AbortSignal): Promise<DeploymentStatusView> {
    return this.request(
      'GET',
      `/projects/${encodeURIComponent(project)}/deployments/${encodeURIComponent(deployment)}/status`,
      undefined,
      signal,
    );
  }
}
