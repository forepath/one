import { createHmac, timingSafeEqual } from 'crypto';

import { AGENT_CONTEXT_TOKEN_SECRET_ENV } from '../constants/agent-context.constants';

const TOKEN_DOMAIN = 'agenstra-context:v1';

/** Secret used to derive per-agent context tokens; `null` disables the context MCP. */
export function resolveAgentContextTokenSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const dedicated = env[AGENT_CONTEXT_TOKEN_SECRET_ENV]?.trim();

  if (dedicated) {
    return dedicated;
  }

  const encryptionKey = env['ENCRYPTION_KEY']?.trim();

  return encryptionKey ? encryptionKey : null;
}

/**
 * Deterministic per-agent token (survives manager restarts without persistence).
 * Bound to the agent's credential hash so a credential rotation also rotates the token.
 */
export function deriveAgentContextToken(secret: string, agentId: string, credentialHash: string): string {
  return createHmac('sha256', secret).update(`${TOKEN_DOMAIN}:${agentId}:${credentialHash}`).digest('base64url');
}

/** Constant-time token comparison. */
export function agentContextTokensEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}
