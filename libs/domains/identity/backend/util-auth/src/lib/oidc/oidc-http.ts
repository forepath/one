/** Default timeout for calls to the OpenID provider. */
export const OIDC_HTTP_TIMEOUT_MS = 5_000;

/** Upper bound for provider responses (discovery, JWKS, introspection, token). */
export const OIDC_HTTP_MAX_BYTES = 512 * 1024;

/** Minimal fetch signature (global `fetch`), injectable for tests. */
export type OidcFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class OidcHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'OidcHttpError';
  }
}

/** Reads the body while enforcing {@link OIDC_HTTP_MAX_BYTES} (stops reading instead of buffering everything). */
async function readBoundedText(response: Response, url: string): Promise<string> {
  const tooLarge = () =>
    new OidcHttpError(`Response from ${new URL(url).origin} exceeds ${OIDC_HTTP_MAX_BYTES} bytes`, response.status);
  const declared = Number(response.headers.get('content-length'));

  if (Number.isFinite(declared) && declared > OIDC_HTTP_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > OIDC_HTTP_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Performs a request against the OpenID provider and parses a bounded JSON body.
 * Redirects are not followed (a provider endpoint must answer directly).
 */
export async function oidcFetchJson<T>(
  fetchImpl: OidcFetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = OIDC_HTTP_TIMEOUT_MS,
): Promise<T> {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch (error) {
    throw new OidcHttpError(`Request to ${new URL(url).origin} failed: ${(error as Error).message}`);
  }

  const text = await readBoundedText(response, url);
  let body: unknown;

  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    throw new OidcHttpError(`Response from ${new URL(url).origin} is not JSON`, response.status);
  }

  if (!response.ok) {
    throw new OidcHttpError(
      `Request to ${new URL(url).origin} failed with status ${response.status}`,
      response.status,
      body,
    );
  }

  return body as T;
}
