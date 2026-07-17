import { SENSITIVE_EMAIL_CONTEXT_KEY_SET } from '../constants/sensitive-email-context-keys';

/**
 * Strip sensitive fields (OTP/reset codes) before persisting email delivery context.
 */
export function sanitizeEmailTemplateContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_EMAIL_CONTEXT_KEY_SET.has(key)) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
