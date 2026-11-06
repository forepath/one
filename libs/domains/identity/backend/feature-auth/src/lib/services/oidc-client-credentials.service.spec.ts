import { OidcClientCredentialsService } from './oidc-client-credentials.service';

const ISSUER = 'https://idp.example.com/realms/test';
const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('OidcClientCredentialsService', () => {
  let fetchMock: jest.Mock;
  let service: OidcClientCredentialsService;
  let issued: number;
  let authMethods: string[] | undefined;

  beforeEach(() => {
    issued = 0;
    authMethods = undefined;
    fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return json({
          issuer: ISSUER,
          jwks_uri: `${ISSUER}/certs`,
          token_endpoint: TOKEN_ENDPOINT,
          ...(authMethods ? { token_endpoint_auth_methods_supported: authMethods } : {}),
        });
      }

      if (url === TOKEN_ENDPOINT && init?.method === 'POST') {
        issued += 1;

        return json({ access_token: `token-${issued}`, expires_in: 300, token_type: 'Bearer' });
      }

      return json({ error: 'not_found' }, 404);
    });
    service = new OidcClientCredentialsService(fetchMock as never);
  });

  const request = { issuer: ISSUER, clientId: 'controller', clientSecret: 's3cret' };

  it('discovers the token endpoint and uses client_secret_basic by default', async () => {
    await expect(service.getAccessToken(request)).resolves.toBe('token-1');

    const [, init] = fetchMock.mock.calls.find(([url]) => url === TOKEN_ENDPOINT)!;

    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('controller:s3cret').toString('base64')}`,
    });
    expect(String((init as RequestInit).body)).toBe('grant_type=client_credentials');
  });

  it('falls back to client_secret_post when the provider only supports it and forwards scope', async () => {
    authMethods = ['client_secret_post'];

    await service.getAccessToken({ ...request, scope: 'api://x/.default' });

    const [, init] = fetchMock.mock.calls.find(([url]) => url === TOKEN_ENDPOINT)!;
    const body = new URLSearchParams(String((init as RequestInit).body));

    expect(body.get('client_id')).toBe('controller');
    expect(body.get('client_secret')).toBe('s3cret');
    expect(body.get('scope')).toBe('api://x/.default');
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('caches tokens and never reuses a token minted with another secret', async () => {
    await service.getAccessToken(request);
    await expect(service.getAccessToken(request)).resolves.toBe('token-1');
    await expect(service.getAccessToken({ ...request, clientSecret: 'rotated' })).resolves.toBe('token-2');
  });

  it('clears cached tokens of a client', async () => {
    await service.getAccessToken(request);
    service.clearCache(ISSUER, 'controller');
    await expect(service.getAccessToken(request)).resolves.toBe('token-2');
  });

  it('applies the SSRF policy to discovery and token endpoints', async () => {
    const assertUrlAllowed = jest.fn(async (url: string) => {
      if (url === TOKEN_ENDPOINT) {
        throw new Error('host not in allowlist');
      }
    });

    await expect(service.getAccessToken({ ...request, assertUrlAllowed })).rejects.toThrow('host not in allowlist');
    expect(assertUrlAllowed).toHaveBeenCalledWith(`${ISSUER}/.well-known/openid-configuration`);
    expect(fetchMock.mock.calls.some(([url]) => url === TOKEN_ENDPOINT)).toBe(false);
  });

  it('rejects non-http issuers and provider errors', async () => {
    await expect(service.getAccessToken({ ...request, issuer: 'file:///etc/passwd' })).rejects.toThrow();

    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('openid-configuration')
        ? json({ issuer: ISSUER, jwks_uri: `${ISSUER}/certs`, token_endpoint: TOKEN_ENDPOINT })
        : json({ error: 'invalid_client' }, 401),
    );
    await expect(service.getAccessToken({ ...request, clientId: 'other' })).rejects.toThrow(
      /Failed to authenticate with the OpenID provider/,
    );
  });
});
