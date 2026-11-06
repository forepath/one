/**
 * Returns `value` when it is a same-origin, app-relative path (`/clients/1?x=y`), otherwise `fallback`.
 * Rejects protocol-relative (`//evil`), backslash tricks (`/\\evil`), absolute URLs and control characters,
 * so redirect targets from query strings / IdP round trips cannot become open redirects.
 */
export function sanitizeAppRedirectPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return fallback;
  }

  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    return fallback;
  }

  return value;
}
