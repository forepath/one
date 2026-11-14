import { AtlassianAuthError, AtlassianAuthService, sanitizeAtlassianTestMessage } from './atlassian-auth.service';
import { atlassianFetchJson } from './atlassian-rest.util';

jest.mock('./atlassian-rest.util', () => ({
  ...jest.requireActual('./atlassian-rest.util'),
  atlassianFetchJson: jest.fn(),
}));

const fetchMock = atlassianFetchJson as jest.Mock;

describe('AtlassianAuthService', () => {
  const repo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const updatedAt = new Date('2026-01-01T00:00:00Z');
  let service: AtlassianAuthService;
  const appConnection = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'conn-1',
      authType: 'app',
      baseUrl: 'https://example.atlassian.net/wiki/spaces/X',
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      cloudId: null,
      updatedAt,
      ...overrides,
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    service = new AtlassianAuthService(repo as never);
  });

  it('resolves token connections to the site with Basic auth', async () => {
    const ctx = await service.resolve({
      id: 'conn-1',
      authType: 'token',
      baseUrl: 'https://example.atlassian.net/',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
      updatedAt,
    } as never);

    expect(ctx).toEqual({
      authType: 'token',
      jiraApiBase: 'https://example.atlassian.net',
      confluenceApiBase: 'https://example.atlassian.net/wiki',
      confluenceOriginBase: 'https://example.atlassian.net',
      authorizationHeader: `Basic ${Buffer.from('a@b.com:tok').toString('base64')}`,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats legacy rows without authType as token connections', async () => {
    const ctx = await service.resolve({
      id: 'conn-1',
      baseUrl: 'https://confluence.corp.example/ctx',
      accountEmail: 'a@b.com',
      apiToken: 'tok',
    } as never);

    expect(ctx.authType).toBe('token');
    expect(ctx.confluenceApiBase).toBe('https://confluence.corp.example/ctx');
  });

  it('rejects token connections without credentials', async () => {
    await expect(
      service.resolve({
        id: 'c',
        authType: 'token',
        baseUrl: 'https://x.atlassian.net',
        accountEmail: 'a@b.com',
      } as never),
    ).rejects.toBeInstanceOf(AtlassianAuthError);
  });

  it('resolves app connections via tenant_info + client credentials and persists the cloud id', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: { cloudId: 'cloud-1' }, text: '' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: { access_token: 'at-1', expires_in: 3600 }, text: '' });

    const ctx = await service.resolve(appConnection());

    expect(fetchMock.mock.calls[0][0]).toBe('https://example.atlassian.net/_edge/tenant_info');
    expect(fetchMock.mock.calls[1][0]).toBe('https://auth.atlassian.com/oauth/token');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
    expect(ctx).toEqual({
      authType: 'app',
      jiraApiBase: 'https://api.atlassian.com/ex/jira/cloud-1',
      confluenceApiBase: 'https://api.atlassian.com/ex/confluence/cloud-1/wiki',
      confluenceOriginBase: 'https://api.atlassian.com/ex/confluence/cloud-1',
      authorizationHeader: 'Bearer at-1',
    });
    expect(repo.update).toHaveBeenCalledWith({ id: 'conn-1' }, { cloudId: 'cloud-1', updatedAt });
  });

  it('caches access tokens until shortly before expiry, keyed by connection id + updatedAt', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: { access_token: 'at-1', expires_in: 3600 }, text: '' });

    await service.resolve(appConnection({ cloudId: 'cloud-1' }));
    await service.resolve(appConnection({ cloudId: 'cloud-1' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await service.resolve(appConnection({ cloudId: 'cloud-1', updatedAt: new Date('2026-02-01T00:00:00Z') }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes tokens that expire within a minute', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: { access_token: 'short', expires_in: 30 }, text: '' });

    await service.resolve(appConnection({ cloudId: 'cloud-1' }));
    await service.resolve(appConnection({ cloudId: 'cloud-1' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops cached tokens of a connection', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: { access_token: 'at', expires_in: 3600 }, text: '' });

    await service.resolve(appConnection({ cloudId: 'cloud-1' }));
    service.invalidate('conn-1');
    await service.resolve(appConnection({ cloudId: 'cloud-1' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports token failures with status and OAuth error code only', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: { error: 'invalid_client', error_description: 'client-secret is wrong' },
      text: 'client-secret',
    });

    const err = await service.resolve(appConnection({ cloudId: 'cloud-1' })).catch((e: Error) => e);

    expect(err).toBeInstanceOf(AtlassianAuthError);
    expect((err as Error).message).toBe('Atlassian OAuth token request failed (HTTP 401, invalid_client)');
  });

  it('maps token request timeouts to a generic message', async () => {
    const abort = new Error('aborted');

    abort.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abort);

    await expect(service.resolve(appConnection({ cloudId: 'cloud-1' }))).rejects.toThrow(
      'Atlassian OAuth token request failed (timeout)',
    );
  });

  it('fails when the site has no cloud id', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: null, text: '' });

    await expect(service.resolve(appConnection())).rejects.toThrow('Could not resolve Atlassian cloud id (HTTP 404)');
  });

  it('rejects app connections without OAuth credentials', async () => {
    await expect(service.resolve(appConnection({ oauthClientSecret: null }))).rejects.toThrow(/client secret/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sanitizeAtlassianTestMessage', () => {
  it('flattens and bounds messages', () => {
    expect(sanitizeAtlassianTestMessage('a\nb')).toBe('a b');
    expect(sanitizeAtlassianTestMessage('x'.repeat(600))?.length).toBe(512);
    expect(sanitizeAtlassianTestMessage(undefined)).toBeNull();
  });
});
