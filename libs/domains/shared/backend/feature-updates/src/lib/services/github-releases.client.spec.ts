import { GitHubReleasesClient } from './github-releases.client';

describe('GitHubReleasesClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fetchLatestRelease returns normalized release data', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v2.22.0',
        name: '2.22.0',
        body: '* decabill instant cancellations',
        html_url: 'https://github.com/forepath/one/releases/tag/v2.22.0',
        published_at: '2026-07-31T12:00:00.000Z',
      }),
    }) as typeof fetch;

    const client = new GitHubReleasesClient({
      applicationId: 'decabill',
      productScope: 'decabill',
      serviceName: 'billing-manager',
      controllerPath: 'admin/updates',
      queueName: 'billing',
      resolveScopeKey: () => 'tenant-a',
      assertAdmin: () => undefined,
      github: { owner: 'forepath', repo: 'one' },
    });

    await expect(client.fetchLatestRelease()).resolves.toEqual({
      tagName: 'v2.22.0',
      name: '2.22.0',
      body: '* decabill instant cancellations',
      htmlUrl: 'https://github.com/forepath/one/releases/tag/v2.22.0',
      publishedAt: '2026-07-31T12:00:00.000Z',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/forepath/one/releases/latest',
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });

  it('fetchLatestRelease attaches bearer token without logging it', async () => {
    process.env.UPDATE_CHECK_GITHUB_TOKEN = 'secret-token';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v1.0.0' }),
    }) as typeof fetch;

    const client = new GitHubReleasesClient({
      applicationId: 'agenstra',
      productScope: 'agenstra',
      serviceName: 'agent-manager',
      controllerPath: 'admin/updates',
      queueName: 'agent',
      resolveScopeKey: () => 'instance',
      assertAdmin: () => undefined,
      github: { owner: 'forepath', repo: 'one', tokenEnv: 'UPDATE_CHECK_GITHUB_TOKEN' },
    });

    await client.fetchLatestRelease();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      }),
    );

    delete process.env.UPDATE_CHECK_GITHUB_TOKEN;
  });

  it('fetchLatestRelease defaults owner/repo to forepath/one', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v2.22.0' }),
    }) as typeof fetch;

    const client = new GitHubReleasesClient({
      applicationId: 'decabill',
      productScope: 'decabill',
      serviceName: 'billing-manager',
      controllerPath: 'admin/updates',
      queueName: 'billing',
      resolveScopeKey: () => 'tenant-a',
      assertAdmin: () => undefined,
    });

    await expect(client.fetchLatestRelease()).resolves.toEqual(expect.objectContaining({ tagName: 'v2.22.0' }));
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/forepath/one/releases/latest',
      expect.any(Object),
    );
  });

  it('fetchReleasesNewerThan returns releases strictly newer than installed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          tag_name: 'v2.22.0',
          name: '2.22.0',
          body: '* feat(decabill): newest',
          html_url: 'https://github.com/forepath/one/releases/tag/v2.22.0',
          published_at: '2026-07-31T12:00:00.000Z',
          draft: false,
          prerelease: false,
        },
        {
          tag_name: 'v2.21.0',
          name: '2.21.0',
          body: '* feat(decabill): middle',
          html_url: 'https://github.com/forepath/one/releases/tag/v2.21.0',
          published_at: '2026-07-01T12:00:00.000Z',
          draft: false,
          prerelease: false,
        },
        {
          tag_name: 'v2.20.0',
          name: '2.20.0',
          body: '* feat(decabill): installed',
          html_url: 'https://github.com/forepath/one/releases/tag/v2.20.0',
          published_at: '2026-06-01T12:00:00.000Z',
          draft: false,
          prerelease: false,
        },
      ],
    }) as typeof fetch;

    const client = new GitHubReleasesClient({
      applicationId: 'decabill',
      productScope: 'decabill',
      serviceName: 'billing-manager',
      controllerPath: 'admin/updates',
      queueName: 'billing',
      resolveScopeKey: () => 'tenant-a',
      assertAdmin: () => undefined,
      github: { owner: 'forepath', repo: 'one' },
    });

    await expect(client.fetchReleasesNewerThan('2.20.0')).resolves.toEqual([
      expect.objectContaining({ tagName: 'v2.22.0', body: '* feat(decabill): newest' }),
      expect.objectContaining({ tagName: 'v2.21.0', body: '* feat(decabill): middle' }),
    ]);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/forepath/one/releases?per_page=100&page=1',
      expect.any(Object),
    );
  });

  it('fetchReleasesNewerThan skips drafts and prereleases', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          tag_name: 'v2.23.0-rc.1',
          body: '* prerelease',
          draft: false,
          prerelease: true,
        },
        {
          tag_name: 'v2.22.0',
          body: '* stable',
          draft: false,
          prerelease: false,
        },
        {
          tag_name: 'v2.21.0',
          body: '* older',
          draft: false,
          prerelease: false,
        },
      ],
    }) as typeof fetch;

    const client = new GitHubReleasesClient({
      applicationId: 'decabill',
      productScope: 'decabill',
      serviceName: 'billing-manager',
      controllerPath: 'admin/updates',
      queueName: 'billing',
      resolveScopeKey: () => 'tenant-a',
      assertAdmin: () => undefined,
    });

    await expect(client.fetchReleasesNewerThan('2.21.0')).resolves.toEqual([
      expect.objectContaining({ tagName: 'v2.22.0' }),
    ]);
  });

  it('beta channel: newest release or prerelease by version, prereleases included in the changelog range', async () => {
    const list = [
      { tag_name: 'v3.6.0-beta.2', body: '* feat(loadweaver): beta 2', draft: false, prerelease: true },
      { tag_name: 'v3.6.0-beta.10', body: '* feat(loadweaver): beta 10', draft: false, prerelease: true },
      { tag_name: 'v3.7.0-beta.1', body: '* draft', draft: true, prerelease: true },
      { tag_name: 'v3.5.1', body: '* fix(loadweaver): patch', draft: false, prerelease: false },
    ];

    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => list }) as typeof fetch;

    const client = new GitHubReleasesClient({
      applicationId: 'loadweaver',
      productScope: 'loadweaver',
      serviceName: 'control-plane',
      controllerPath: 'updates/announcements',
      queueName: 'loadweaver',
      resolveScopeKey: () => 'instance',
      assertAdmin: () => undefined,
    });

    await expect(client.fetchLatestRelease({ includePrereleases: true })).resolves.toEqual(
      expect.objectContaining({ tagName: 'v3.6.0-beta.10', prerelease: true }),
    );
    await expect(client.fetchReleasesNewerThan('3.5.1', { includePrereleases: true })).resolves.toEqual([
      expect.objectContaining({ tagName: 'v3.6.0-beta.2' }),
      expect.objectContaining({ tagName: 'v3.6.0-beta.10' }),
    ]);
    await expect(client.fetchReleasesNewerThan('3.5.1')).resolves.toEqual([]);
  });
});
