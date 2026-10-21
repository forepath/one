import { UnauthorizedException } from '@nestjs/common';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authenticate a call of the worker `agenstra` MCP server: `x-agenstra-agent-id` plus the per-agent
 * context token as `Authorization: Bearer`. Returns the authenticated agent id.
 */
export async function authenticateAgentContextCall(
  verifier: { verifyAgentToken(agentId: string, token: string): Promise<boolean> },
  agentId: string | undefined,
  authorization: string | undefined,
): Promise<string> {
  const id = agentId?.trim() ?? '';
  const [scheme, token] = (authorization ?? '').trim().split(/\s+/, 2);

  if (!UUID_V4.test(id) || scheme !== 'Bearer' || !token || !(await verifier.verifyAgentToken(id, token))) {
    throw new UnauthorizedException('Invalid agent context credentials');
  }

  return id;
}
