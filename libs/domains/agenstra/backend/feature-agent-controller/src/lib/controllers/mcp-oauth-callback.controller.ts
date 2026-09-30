import { Public } from '@forepath/identity/backend';
import { Controller, Get, Logger, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ClientAgentOpencodeConfigProxyService } from '../services/client-agent-opencode-config-proxy.service';
import { readMcpOAuthCallbackSecret, verifyMcpOAuthCallback } from '../utils/mcp-oauth-callback.util';

/**
 * Public (no /api prefix) MCP OAuth redirect target for Environment interactive auth.
 * IdP redirects here with ?code=&state=; we verify HMAC then proxy code to OpenCode.
 */
@Controller('clients/:clientId/agents/:agentId/opencode/mcp/:name/oauth')
export class McpOAuthCallbackController {
  private readonly logger = new Logger(McpOAuthCallbackController.name);

  constructor(private readonly agentProxy: ClientAgentOpencodeConfigProxyService) {}

  @Public()
  @Get('callback')
  async callback(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('name') name: string,
    @Query('code') code: string | undefined,
    @Query('state') _state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Query('exp') expRaw: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const decodedName = decodeURIComponent(name);

    if (oauthError) {
      const message = errorDescription || oauthError;

      this.logger.warn(`MCP OAuth error for agent ${agentId}/${decodedName}: ${message}`);
      this.sendHtml(res, 400, false, message);

      return;
    }

    if (!code?.trim() || !sig?.trim() || !expRaw?.trim()) {
      this.sendHtml(res, 400, false, 'Missing authorization code or callback signature');

      return;
    }

    const exp = Number.parseInt(expRaw, 10);

    if (!Number.isFinite(exp)) {
      this.sendHtml(res, 400, false, 'Invalid callback expiry');

      return;
    }

    let secret: string;

    try {
      secret = readMcpOAuthCallbackSecret();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Callback secret not configured';

      this.logger.error(message);
      this.sendHtml(res, 500, false, 'MCP OAuth callback is not configured');

      return;
    }

    const valid = verifyMcpOAuthCallback({ clientId, agentId, name: decodedName, exp }, sig, secret);

    if (!valid) {
      this.sendHtml(res, 403, false, 'Invalid or expired callback signature');

      return;
    }

    try {
      await this.agentProxy.completeMcpAuth(clientId, agentId, decodedName, code.trim());
      this.sendHtml(res, 200, true, 'MCP authentication completed. You can close this window.');
    } catch (error) {
      const message = (error as { message?: string }).message ?? 'Failed to complete MCP authentication';

      this.logger.warn(`MCP OAuth callback proxy failed for ${agentId}/${decodedName}: ${message}`);
      this.sendHtml(res, 400, false, message);
    }
  }

  private sendHtml(res: Response, status: number, success: boolean, message: string): void {
    const title = success ? 'MCP authentication successful' : 'MCP authentication failed';
    const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    res.status(status).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    .ok { color: #0f5132; }
    .err { color: #842029; }
  </style>
</head>
<body>
  <h1 class="${success ? 'ok' : 'err'}">${title}</h1>
  <p>${safeMessage}</p>
</body>
</html>`);
  }
}
