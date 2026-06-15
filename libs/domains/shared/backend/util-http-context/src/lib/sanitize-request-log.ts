/**
 * Returns path (and optional prefix before `?`) only so query tokens are not logged.
 * Caps length to limit log volume.
 */
export function sanitizeRequestUrlForLog(url: string | undefined): string {
  if (!url) {
    return '';
  }

  const pathOnly = url.split('?')[0] ?? '';
  let decoded = pathOnly;

  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    decoded = pathOnly;
  }

  const max = 256;

  return decoded.length > max ? `${decoded.slice(0, max)}…` : decoded;
}

/**
 * Best-effort redaction of common secret and PII patterns in log lines.
 * Prefer structured logging with explicit fields; use this for free-form strings.
 */
export function redactSecretsInString(message: string): string {
  let out = message;

  out = out.replace(/\bBearer\s+[\w\-._~+/]+=*\b/gi, 'Bearer [REDACTED]');
  out = out.replace(/\bApiKey\s+[\w\-._~+/]+\b/gi, 'ApiKey [REDACTED]');
  out = out.replace(/\bBasic\s+[A-Za-z0-9+/=]+\b/g, 'Basic [REDACTED]');
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '[EMAIL_REDACTED]');

  return out;
}
