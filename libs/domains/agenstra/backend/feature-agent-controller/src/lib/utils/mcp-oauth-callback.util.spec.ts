import {
  buildMcpOAuthCallbackUrl,
  readMcpOAuthCallbackSecret,
  resolveMcpOAuthPublicBaseUrl,
  signMcpOAuthCallback,
  verifyMcpOAuthCallback,
} from './mcp-oauth-callback.util';

describe('mcp-oauth-callback.util', () => {
  const secret = 'test-callback-secret';

  it('signs and verifies a callback token', () => {
    const { exp, sig } = signMcpOAuthCallback(
      {
        clientId: '11111111-1111-4111-8111-111111111111',
        agentId: '22222222-2222-4222-8222-222222222222',
        name: 'linear',
      },
      secret,
    );

    expect(
      verifyMcpOAuthCallback(
        {
          clientId: '11111111-1111-4111-8111-111111111111',
          agentId: '22222222-2222-4222-8222-222222222222',
          name: 'linear',
          exp,
        },
        sig,
        secret,
      ),
    ).toBe(true);
  });

  it('rejects tampered signatures and expired tokens', () => {
    const { exp, sig } = signMcpOAuthCallback(
      {
        clientId: '11111111-1111-4111-8111-111111111111',
        agentId: '22222222-2222-4222-8222-222222222222',
        name: 'linear',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      secret,
    );

    expect(
      verifyMcpOAuthCallback(
        {
          clientId: '11111111-1111-4111-8111-111111111111',
          agentId: '22222222-2222-4222-8222-222222222222',
          name: 'linear',
          exp,
        },
        `${sig}ff`,
        secret,
      ),
    ).toBe(false);

    expect(
      verifyMcpOAuthCallback(
        {
          clientId: '11111111-1111-4111-8111-111111111111',
          agentId: '22222222-2222-4222-8222-222222222222',
          name: 'linear',
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        sig,
        secret,
      ),
    ).toBe(false);
  });

  it('builds a callback URL with exp and sig query params', () => {
    const url = buildMcpOAuthCallbackUrl({
      publicBaseUrl: 'http://localhost:3100',
      clientId: '11111111-1111-4111-8111-111111111111',
      agentId: '22222222-2222-4222-8222-222222222222',
      name: 'linear',
      secret,
    });

    expect(url).toContain(
      '/clients/11111111-1111-4111-8111-111111111111/agents/22222222-2222-4222-8222-222222222222/opencode/mcp/linear/oauth/callback',
    );
    expect(url).toContain('exp=');
    expect(url).toContain('sig=');
  });

  it('reads MCP_OAUTH_CALLBACK_SECRET and MCP_OAUTH_PUBLIC_BASE_URL', () => {
    expect(
      readMcpOAuthCallbackSecret({
        MCP_OAUTH_CALLBACK_SECRET: 'short-secret',
      }),
    ).toBe('short-secret');

    expect(
      resolveMcpOAuthPublicBaseUrl({
        MCP_OAUTH_PUBLIC_BASE_URL: 'http://controller.example:3100',
      }),
    ).toBe('http://controller.example:3100');
  });
});
