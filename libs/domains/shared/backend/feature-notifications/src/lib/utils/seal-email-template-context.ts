import { createJsonAes256GcmTransformer } from '@shared/backend/util-crypto';

import { SENSITIVE_EMAIL_CONTEXT_KEY_SET } from '../constants/sensitive-email-context-keys';

const secretsTransformer = createJsonAes256GcmTransformer();

export interface SealedEmailTemplateContext {
  /** Non-sensitive context safe for Redis/Bull Board. */
  templateContext: Record<string, unknown>;
  /** AES-256-GCM sealed sensitive subset (OTP/reset codes). */
  encryptedTemplateSecrets?: string;
}

/**
 * Splits template context so secrets never sit in plaintext queue payloads.
 */
export function sealEmailTemplateContext(context: Record<string, unknown>): SealedEmailTemplateContext {
  const templateContext: Record<string, unknown> = {};
  const secrets: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_EMAIL_CONTEXT_KEY_SET.has(key)) {
      secrets[key] = value;
    } else {
      templateContext[key] = value;
    }
  }

  if (Object.keys(secrets).length === 0) {
    return { templateContext };
  }

  const encryptedTemplateSecrets = secretsTransformer.to(secrets);

  if (!encryptedTemplateSecrets) {
    throw new Error('Failed to encrypt email template secrets');
  }

  return { templateContext, encryptedTemplateSecrets };
}

/**
 * Rehydrates full template context for rendering (decrypts sealed secrets).
 */
export function unsealEmailTemplateContext(
  templateContext: Record<string, unknown>,
  encryptedTemplateSecrets?: string,
): Record<string, unknown> {
  if (!encryptedTemplateSecrets) {
    return { ...templateContext };
  }

  const secrets = secretsTransformer.from(encryptedTemplateSecrets);

  return { ...templateContext, ...secrets };
}
