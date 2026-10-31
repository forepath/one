/**
 * Outbound HTTP for posture integrations (3.31): HTTPS only, only to the hosts the integration's configuration
 * allows, no redirects, per-request timeouts, bounded response sizes and a request budget per run, retries with
 * backoff on 429 / 5xx (honouring `Retry-After`). Error messages never contain request headers or bodies, so
 * credentials can't leak into logs or the API.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface PostureHttpOptions {
  allowedHosts: readonly string[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Upper bound of requests in one run (pagination loops can't run away). */
  maxRequests?: number;
  maxResponseBytes?: number;
  /** Sleep function (tests replace it). */
  sleep?: (ms: number) => Promise<void>;
}

export interface PostureHttpRequest {
  method?: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** `application/x-www-form-urlencoded` body (OAuth token requests). */
  form?: Record<string, string>;
  json?: unknown;
}

export class PostureHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PostureHttpError';
  }
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 60_000;

/** `Retry-After` in seconds or as an HTTP date, capped at a minute. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;

  const seconds = Number(header);

  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);

  const date = Date.parse(header);

  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - now), MAX_RETRY_AFTER_MS);
}

/** Validates a configured base URL: HTTPS, a host name, no credentials, query or fragment. Returns the origin. */
export function httpsOrigin(value: string | undefined, field: string): URL {
  let url: URL;

  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new Error(`${field} must be an https:// URL`);
  }

  if (url.protocol !== 'https:') throw new Error(`${field} must use https`);

  if (url.username || url.password || url.search || url.hash)
    throw new Error(`${field} must not contain credentials, a query or a fragment`);

  // A DNS name whose last label isn't numeric (no IPv4 / IPv6 literals).
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]([a-z0-9-]*[a-z0-9])?$/.test(url.hostname)
  )
    throw new Error(`${field} must name a host (no IP address)`);

  return url;
}

export class PostureHttp {
  private readonly allowed: Set<string>;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private requests = 0;

  constructor(private readonly options: PostureHttpOptions) {
    this.allowed = new Set(options.allowedHosts.map((h) => h.toLowerCase()));
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get requestCount(): number {
    return this.requests;
  }

  private target(raw: string): URL {
    let url: URL;

    try {
      url = new URL(raw);
    } catch {
      throw new PostureHttpError('invalid request URL');
    }

    if (url.protocol !== 'https:') throw new PostureHttpError('posture integrations only call https URLs');

    if (url.username || url.password) throw new PostureHttpError('URLs with credentials are not allowed');

    if (!this.allowed.has(url.hostname.toLowerCase()))
      throw new PostureHttpError(`host ${url.hostname} is not allowed for this integration`);

    return url;
  }

  /** Sends a request and parses the JSON answer; non-2xx answers reject with the status and the path. */
  async json<T>(request: PostureHttpRequest): Promise<T> {
    const url = this.target(request.url);
    const maxAttempts = this.options.maxAttempts ?? 4;
    const headers: Record<string, string> = { accept: 'application/json', ...(request.headers ?? {}) };
    let body: string | undefined;

    if (request.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(request.form).toString();
    } else if (request.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.json);
    }

    for (let attempt = 1; ; attempt++) {
      if (++this.requests > (this.options.maxRequests ?? 2_000))
        throw new PostureHttpError('request budget of this run exhausted');

      let response: Response;

      try {
        response = await this.fetchImpl(url.toString(), {
          method: request.method ?? 'GET',
          headers,
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await this.sleep(1000 * 2 ** (attempt - 1));
          continue;
        }

        const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'connection failed';

        throw new PostureHttpError(`${request.method ?? 'GET'} ${url.hostname}${url.pathname}: ${reason}`);
      }

      if (RETRY_STATUSES.has(response.status) && attempt < maxAttempts) {
        await response.body?.cancel().catch(() => undefined);
        await this.sleep(retryAfterMs(response.headers.get('retry-after')) ?? 1000 * 2 ** (attempt - 1));
        continue;
      }

      const text = await this.readLimited(response);

      if (!response.ok)
        throw new PostureHttpError(
          `${request.method ?? 'GET'} ${url.hostname}${url.pathname} answered ${response.status}`,
          response.status,
        );

      try {
        return (text ? JSON.parse(text) : {}) as T;
      } catch {
        throw new PostureHttpError(`${url.hostname}${url.pathname} returned no JSON`);
      }
    }
  }

  private async readLimited(response: Response): Promise<string> {
    const limit = this.options.maxResponseBytes ?? 25_000_000;
    const reader = response.body?.getReader();

    if (!reader) return '';

    const chunks: Uint8Array[] = [];
    let size = 0;

    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new PostureHttpError('response too large');
      }

      chunks.push(value);
    }

    return Buffer.concat(chunks).toString('utf8');
  }
}

/** OAuth 2.0 client credentials (RFC 6749 4.4) with the secret in the form body; the token lives for one run. */
export async function clientCredentialsToken(
  http: PostureHttp,
  tokenUrl: string,
  params: Record<string, string>,
): Promise<string> {
  const answer = await http.json<{ access_token?: string; token_type?: string }>({
    method: 'POST',
    url: tokenUrl,
    form: { grant_type: 'client_credentials', ...params },
  });

  if (!answer.access_token) throw new PostureHttpError('the token endpoint returned no access token');

  return answer.access_token;
}

/** Message of an error that is safe to store and show (no request data, bounded length). */
export function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof PostureHttpError || (error instanceof Error && !(error instanceof TypeError))
      ? error.message
      : 'posture integration failed';

  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
}
