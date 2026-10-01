import { RequestMethod } from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';

/**
 * Public MCP OAuth callback stays outside Nest's `/api` global prefix so IdPs can redirect to
 * `/clients/.../opencode/mcp/.../oauth/callback`.
 */
export function getMcpOAuthCallbackGlobalPrefixExcludes(): RouteInfo[] {
  return [
    {
      path: 'clients/:clientId/agents/:agentId/opencode/mcp/:name/oauth/callback',
      method: RequestMethod.GET,
    },
  ];
}
