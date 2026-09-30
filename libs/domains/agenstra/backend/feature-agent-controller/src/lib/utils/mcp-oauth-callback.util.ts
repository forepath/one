import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_SECONDS = 10 * 60;

export interface McpOAuthCallbackClaims {
  clientId: string;
  agentId: string;
  name: string;
  exp: number;
}

/**
 * HMAC-SHA256 signed query params for the public MCP OAuth callback.
 * Payload: `${exp}.${clientId}.${agentId}.${name}` — timing-safe verify + expiry.
 */
export function signMcpOAuthCallback(
  claims: Omit<McpOAuthCallbackClaims, 'exp'> & { exp?: number },
  secret: string,
): {
  exp: number;
  sig: string;
} {
  const exp = claims.exp ?? Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS;
  const payload = `${exp}.${claims.clientId}.${claims.agentId}.${claims.name}`;
  const sig = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  return { exp, sig };
}

export function verifyMcpOAuthCallback(
  claims: McpOAuthCallbackClaims,
  sig: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!sig || !secret) {
    return false;
  }

  if (!Number.isFinite(claims.exp) || claims.exp < nowSeconds) {
    return false;
  }

  const payload = `${claims.exp}.${claims.clientId}.${claims.agentId}.${claims.name}`;
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  try {
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(sig, 'utf8');

    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function readMcpOAuthCallbackSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.MCP_OAUTH_CALLBACK_SECRET?.trim();

  if (!secret) {
    throw new Error('MCP_OAUTH_CALLBACK_SECRET is not configured');
  }

  return secret;
}

/**
 * Public base URL for MCP OAuth redirects (no trailing slash).
 * Must use a non-privileged port so OpenCode can bind it inside the agent container.
 */
export function resolveMcpOAuthPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  requestHost?: { protocol?: string; host?: string },
): string {
  const configured = env.MCP_OAUTH_PUBLIC_BASE_URL?.trim();
  const raw = configured || (requestHost?.host ? `${requestHost.protocol || 'http'}://${requestHost.host}` : '');

  if (!raw) {
    throw new Error('MCP_OAUTH_PUBLIC_BASE_URL is not configured and request host could not be resolved');
  }

  const url = new URL(raw.replace(/\/$/, ''));
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

  if (port < 1024) {
    throw new Error(
      `MCP OAuth public base URL must use a non-privileged port (got ${port}). ` +
        `OpenCode binds this port inside the agent container during auth.start. ` +
        `Example: http://localhost:3100`,
    );
  }

  return url.origin;
}

export function buildMcpOAuthCallbackPath(clientId: string, agentId: string, name: string): string {
  return `/clients/${encodeURIComponent(clientId)}/agents/${encodeURIComponent(agentId)}/opencode/mcp/${encodeURIComponent(name)}/oauth/callback`;
}

export function buildMcpOAuthCallbackUrl(input: {
  publicBaseUrl: string;
  clientId: string;
  agentId: string;
  name: string;
  secret: string;
  exp?: number;
}): string {
  const { exp, sig } = signMcpOAuthCallback(
    { clientId: input.clientId, agentId: input.agentId, name: input.name, exp: input.exp },
    input.secret,
  );
  const path = buildMcpOAuthCallbackPath(input.clientId, input.agentId, input.name);
  const url = new URL(`${input.publicBaseUrl.replace(/\/$/, '')}${path}`);

  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);

  return url.toString();
}
