function parseUrl(value: string): URL | null {
  try {
    const base = globalThis.location?.origin ?? 'http://localhost';

    return new URL(value, base);
  } catch {
    return null;
  }
}

/**
 * Whether `requestUrl` targets the API rooted at `apiBaseUrl`: same origin (scheme, host, port) and the path is the
 * base path or below it at a segment boundary. A plain `startsWith` would also match look-alike hosts such as
 * `https://api.example.com.evil.tld` and hand them the bearer token.
 */
export function isUrlWithinApiBase(requestUrl: string, apiBaseUrl: string | undefined | null): boolean {
  if (!apiBaseUrl) {
    return false;
  }

  const request = parseUrl(requestUrl);
  const base = parseUrl(apiBaseUrl);

  if (!request || !base || request.origin !== base.origin) {
    return false;
  }

  const basePath = base.pathname.replace(/\/+$/, '');

  return basePath === '' || request.pathname === basePath || request.pathname.startsWith(`${basePath}/`);
}
