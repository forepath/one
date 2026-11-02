import type { Queue } from 'bullmq';

import { UpdateCheckService } from './update-check.service';
import type { UpdatesModuleOptions } from '../interfaces/updates-module.options';
import type { ReleaseSnapshot, ServiceInstanceRecord } from '../interfaces/updates.interfaces';
import { GitHubReleasesClient } from './github-releases.client';
import { UpdatesRedisStore } from './updates-redis.store';

describe('UpdateCheckService', () => {
  const options: UpdatesModuleOptions = {
    applicationId: 'decabill',
    productScope: 'decabill',
    serviceName: 'billing-manager',
    controllerPath: 'admin/updates',
    queueName: 'billing',
    resolveScopeKey: () => 'tenant-a',
    assertAdmin: () => undefined,
    publishNotification: jest.fn(),
    github: { owner: 'forepath', repo: 'one' },
  };

  const store = {
    getCheckJobMeta: jest.fn(),
    setCheckJobMeta: jest.fn(),
    getRelease: jest.fn(),
    setRelease: jest.fn(),
    listInstances: jest.fn(),
    upsertInstance: jest.fn(),
  };

  const githubReleasesClient = {
    fetchLatestRelease: jest.fn(),
    fetchReleasesNewerThan: jest.fn(),
  };

  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
  } as unknown as Queue;

  let service: UpdateCheckService;

  beforeEach(() => {
    jest.clearAllMocks();
    store.getCheckJobMeta.mockResolvedValue(null);
    store.getRelease.mockResolvedValue(null);
    store.listInstances.mockResolvedValue([]);
    githubReleasesClient.fetchReleasesNewerThan.mockResolvedValue([]);
    service = new UpdateCheckService(
      store as unknown as UpdatesRedisStore,
      githubReleasesClient as unknown as GitHubReleasesClient,
      options,
      queue,
    );
  });

  it('runCheck persists release data and emits update_available', async () => {
    githubReleasesClient.fetchLatestRelease.mockResolvedValue({
      tagName: 'v2.22.0',
      name: '2.22.0',
      body: '* decabill instant cancellations',
      htmlUrl: 'https://example.com/release',
      publishedAt: '2026-07-31T12:00:00.000Z',
    });
    githubReleasesClient.fetchReleasesNewerThan.mockResolvedValue([
      {
        tagName: 'v2.22.0',
        name: '2.22.0',
        body: '* decabill instant cancellations',
        htmlUrl: 'https://example.com/release',
        publishedAt: '2026-07-31T12:00:00.000Z',
      },
    ]);

    const previousVersion = process.env.VERSION;
    process.env.VERSION = '2.21.0';

    await service.runCheck();

    expect(store.setRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tagName: 'v2.22.0',
        scopedChangelog: expect.objectContaining({
          product: expect.arrayContaining([expect.objectContaining({ product: 'decabill' })]),
        }),
      } satisfies Partial<ReleaseSnapshot>),
    );
    expect(options.publishNotification).toHaveBeenCalledWith(
      'application.update_available',
      expect.objectContaining({
        scopeKey: 'tenant-a',
        installedVersion: '2.21.0',
      }),
    );
    expect(store.setCheckJobMeta).toHaveBeenLastCalledWith(expect.objectContaining({ lastStatus: 'success' }));

    if (previousVersion === undefined) {
      delete process.env.VERSION;
    } else {
      process.env.VERSION = previousVersion;
    }
  });

  it('runCheck aggregates changelog entries across releases newer than installed', async () => {
    githubReleasesClient.fetchLatestRelease.mockResolvedValue({
      tagName: 'v2.22.0',
      name: '2.22.0',
      body: '* feat(decabill): newest',
      htmlUrl: 'https://example.com/release',
      publishedAt: '2026-07-31T12:00:00.000Z',
    });
    githubReleasesClient.fetchReleasesNewerThan.mockResolvedValue([
      {
        tagName: 'v2.22.0',
        name: '2.22.0',
        body: '* feat(decabill): newest',
        htmlUrl: 'https://example.com/v2.22.0',
        publishedAt: '2026-07-31T12:00:00.000Z',
      },
      {
        tagName: 'v2.21.0',
        name: '2.21.0',
        body: '* feat(decabill): middle\n* shared infra tweak',
        htmlUrl: 'https://example.com/v2.21.0',
        publishedAt: '2026-07-01T12:00:00.000Z',
      },
    ]);

    const previousVersion = process.env.VERSION;
    process.env.VERSION = '2.20.0';

    await service.runCheck();

    expect(store.setRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tagName: 'v2.22.0',
        changelog: expect.arrayContaining([
          expect.objectContaining({ text: 'feat(decabill): newest' }),
          expect.objectContaining({ text: 'feat(decabill): middle' }),
          expect.objectContaining({ text: 'shared infra tweak' }),
        ]),
      }),
    );

    if (previousVersion === undefined) {
      delete process.env.VERSION;
    } else {
      process.env.VERSION = previousVersion;
    }
  });

  it('runCheck emits update_check_failed when GitHub release is unavailable', async () => {
    githubReleasesClient.fetchLatestRelease.mockResolvedValue(null);

    await service.runCheck();

    expect(options.publishNotification).toHaveBeenCalledWith(
      'application.update_check_failed',
      expect.objectContaining({ scopeKey: 'tenant-a' }),
    );
    expect(store.setCheckJobMeta).toHaveBeenLastCalledWith(expect.objectContaining({ lastStatus: 'failed' }));
  });

  it('runCheck emits instance_outdated for outdated instances', async () => {
    githubReleasesClient.fetchLatestRelease.mockResolvedValue({
      tagName: 'v2.22.0',
      name: '2.22.0',
      body: '* shared fix',
      htmlUrl: 'https://example.com/release',
      publishedAt: '2026-07-31T12:00:00.000Z',
    });
    githubReleasesClient.fetchReleasesNewerThan.mockResolvedValue([
      {
        tagName: 'v2.22.0',
        name: '2.22.0',
        body: '* shared fix',
        htmlUrl: 'https://example.com/release',
        publishedAt: '2026-07-31T12:00:00.000Z',
      },
    ]);

    const instance: ServiceInstanceRecord = {
      instanceId: 'billing-manager:api:host-a',
      serviceName: 'billing-manager',
      role: 'api',
      hostname: 'host-a',
      installedVersion: '2.20.0',
      updateState: 'unknown',
      lastHeartbeatAt: '2026-07-31T11:00:00.000Z',
      dependencies: {
        redis: 'healthy',
        queue: 'not_applicable',
        database: 'healthy',
        opensearch: 'not_applicable',
      },
    };

    store.listInstances.mockResolvedValue([instance]);

    const previousVersion = process.env.VERSION;
    process.env.VERSION = '2.22.0';

    await service.runCheck();

    expect(store.upsertInstance).toHaveBeenCalledWith(expect.objectContaining({ updateState: 'update_available' }));
    expect(options.publishNotification).toHaveBeenCalledWith(
      'application.instance_outdated',
      expect.objectContaining({ instanceId: instance.instanceId }),
    );

    if (previousVersion === undefined) {
      delete process.env.VERSION;
    } else {
      process.env.VERSION = previousVersion;
    }
  });

  it('triggerCheck enqueues update-check job and stores pending metadata', async () => {
    const result = await service.triggerCheck();

    expect(queue.add).toHaveBeenCalledWith(
      'update-check',
      expect.objectContaining({ scopeKey: 'tenant-a' }),
      expect.any(Object),
    );
    expect(result.enqueuedAt).toEqual(expect.any(String));
    expect(store.setCheckJobMeta).toHaveBeenCalledWith(expect.objectContaining({ lastStatus: 'pending' }));
  });

  it('follows the beta channel when the product resolves it (prereleases, Loadweaver scope)', async () => {
    const loadweaver = new UpdateCheckService(
      store as unknown as UpdatesRedisStore,
      githubReleasesClient as unknown as GitHubReleasesClient,
      {
        ...options,
        applicationId: 'loadweaver',
        productScope: 'loadweaver',
        serviceName: 'control-plane',
        resolveChannel: async () => 'beta' as const,
      },
      queue,
    );
    const beta = {
      tagName: 'v3.6.0-beta.1',
      name: '3.6.0-beta.1',
      body: '* feat(loadweaver): rolling upgrades\n* feat(decabill): other product',
      htmlUrl: 'https://example.com/beta',
      publishedAt: '2026-10-19T00:00:00.000Z',
      prerelease: true,
    };

    githubReleasesClient.fetchLatestRelease.mockResolvedValue(beta);
    githubReleasesClient.fetchReleasesNewerThan.mockResolvedValue([beta]);

    const previousVersion = process.env.VERSION;

    process.env.VERSION = '3.5.0';
    await loadweaver.runCheck();

    expect(githubReleasesClient.fetchLatestRelease).toHaveBeenCalledWith({ includePrereleases: true });
    expect(githubReleasesClient.fetchReleasesNewerThan).toHaveBeenCalledWith('3.5.0', { includePrereleases: true });
    expect(store.setRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tagName: 'v3.6.0-beta.1',
        prerelease: true,
        scopedChangelog: {
          product: [expect.objectContaining({ product: 'loadweaver' })],
          shared: [],
        },
      }),
    );
    expect(options.publishNotification).toHaveBeenCalledWith(
      'application.update_available',
      expect.objectContaining({ latestVersion: '3.6.0-beta.1' }),
    );

    if (previousVersion === undefined) delete process.env.VERSION;
    else process.env.VERSION = previousVersion;
  });

  it('stays on the stable channel by default', async () => {
    githubReleasesClient.fetchLatestRelease.mockResolvedValue(null);

    await service.runCheck();

    expect(githubReleasesClient.fetchLatestRelease).toHaveBeenCalledWith();
  });
});
