import { Agent, fetch as undiciFetch } from 'undici';

/** Fetch as the control plane uses it (a seam for tests). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let insecureAgent: Agent | null = null;

/**
 * Fetch without certificate verification, for the one case that allows it (a trusted fleet's catalog with
 * `LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED=false`, labs): undici's own fetch with a dedicated agent, so
 * the global fetch keeps verifying everything else.
 */
export const insecureTlsFetch: FetchLike = (url, init) => {
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });

  return undiciFetch(url, { ...(init as object), dispatcher: insecureAgent } as never) as unknown as Promise<Response>;
};

export interface CatalogHttpOptions {
  headers?: Record<string, string>;
  /** Largest body accepted (bytes). */
  maxBytes: number;
  /**
   * Internal endpoints only (the built-in registry / its mirrors over the overlay, a registered trusted fleet): skip
   * the public-address check, and allow plain http for the overlay.
   */
  internal?: boolean;
  /** Statuses returned instead of thrown (e.g. 401 for the registry token dance, 404 for "not signed"). */
  accept?: readonly number[];
  /**
   * Skip certificate verification (a trusted fleet's catalog with a self-signed certificate, labs): only for hops on
   * the starting origin — a redirect elsewhere is verified again.
   */
  insecureTls?: boolean;
}

export interface CatalogHttpResponse {
  status: number;
  headers: Headers;
  body: Buffer;
  /** The URL that answered (after redirects). */
  url: string;
}

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * GET for catalog sources (P1): https only (plain http only for internal endpoints), the SSRF check on every hop
 * (public addresses only unless `internal`), at most 3 redirects, credentials (`authorization`) never forwarded to
 * another origin, a timeout and a size cap.
 */
export class CatalogHttp {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly validateUrl: (url: string) => Promise<unknown>,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
    private readonly insecureFetch: FetchLike = insecureTlsFetch,
  ) {}

  async get(start: string, options: CatalogHttpOptions): Promise<CatalogHttpResponse> {
    let url = start;
    let headers = { ...(options.headers ?? {}) };
    const origin = new URL(start).origin;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(url);

      if (parsed.protocol !== 'https:' && !(options.internal && parsed.protocol === 'http:'))
        throw new Error(`${parsed.host}: catalog sources must use https`);

      if (parsed.username || parsed.password) throw new Error(`${parsed.host}: credentials in URLs are not sent`);

      if (!options.internal) await this.validateUrl(url);

      const fetchImpl = options.insecureTls && parsed.origin === origin ? this.insecureFetch : this.fetchImpl;
      const response = await fetchImpl(url, {
        redirect: 'manual',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        await response.body?.cancel().catch(() => undefined);

        if (!location) throw new Error(`${parsed.host}: redirect without a location (${response.status})`);

        url = new URL(location, url).toString();

        // Blob downloads redirect to storage hosts: the registry's credentials stay with the registry.
        if (new URL(url).origin !== origin) {
          headers = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'authorization'));
        }

        continue;
      }

      if (response.ok === false && !options.accept?.includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`${parsed.host}: HTTP ${response.status}`);
      }

      return {
        status: response.status,
        headers: response.headers,
        body: await readCapped(response, options.maxBytes),
        url,
      };
    }

    throw new Error('too many redirects');
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`response larger than ${maxBytes} bytes`);
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    bytes += value.length;

    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`response larger than ${maxBytes} bytes`);
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks);
}
