/**
 * Keys that must never appear in plaintext Redis job payloads or persisted delivery logs.
 */
export const SENSITIVE_EMAIL_CONTEXT_KEYS = [
  'code',
  'confirmationCode',
  'passwordResetCode',
  'resetCode',
  'otp',
  'token',
] as const;

export type SensitiveEmailContextKey = (typeof SENSITIVE_EMAIL_CONTEXT_KEYS)[number];

export const SENSITIVE_EMAIL_CONTEXT_KEY_SET = new Set<string>(SENSITIVE_EMAIL_CONTEXT_KEYS);
