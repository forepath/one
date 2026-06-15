import { redactSecretsInString } from './sanitize-request-log';

const SENSITIVE_KEY_PATTERN =
  /(authorization|token|secret|password|passwd|api[_-]?key|apikey|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|credential|credentials|bearer|cookie|set-cookie|ssh|b64)/i;

function looksLikeJwt(value: string): boolean {
  const t = value.trim();

  if (!t || t.length < 20) {
    return false;
  }

  const parts = t.split('.');

  if (parts.length !== 3) {
    return false;
  }

  return parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}

function sanitizeString(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith('Bearer ') && trimmed.length > 12) {
    return 'Bearer [REDACTED]';
  }

  if (trimmed.startsWith('Basic ') && trimmed.length > 8) {
    return 'Basic [REDACTED]';
  }

  if (trimmed.startsWith('ApiKey ') && trimmed.length > 8) {
    return 'ApiKey [REDACTED]';
  }

  if (looksLikeJwt(trimmed)) {
    return '[REDACTED]';
  }

  return redactSecretsInString(value);
}

export function sanitizeLogPayload(input: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[REDACTED]';
  }

  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return sanitizeString(input);
  }

  if (input instanceof Error) {
    return {
      name: input.name,
      message: typeof input.message === 'string' ? sanitizeString(input.message) : String(input.message),
      stack: typeof input.stack === 'string' ? sanitizeString(input.stack) : undefined,
    };
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((entry) => sanitizeLogPayload(entry, depth + 1));
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
        continue;
      }

      out[key] = sanitizeLogPayload(value, depth + 1);
    }

    return out;
  }

  return input;
}
