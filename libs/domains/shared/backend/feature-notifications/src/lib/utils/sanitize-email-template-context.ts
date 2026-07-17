/**
 * Strip sensitive fields (OTP/reset codes) before persisting email delivery context.
 */
const SENSITIVE_CONTEXT_KEYS = new Set(['code', 'confirmationCode', 'passwordResetCode', 'resetCode', 'otp', 'token']);

export function sanitizeEmailTemplateContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_CONTEXT_KEYS.has(key)) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
