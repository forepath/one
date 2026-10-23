import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { ChangeEventsService } from '../services/change-events.service';

import type { AccessCaller } from '../access/access.utils';
import type { ProjectAccessService } from '../access/project-access.service';
import type { CreateGitConnectionDto } from '../dto/git.dto';
import type { AuditLogService } from '../services/audit-log.service';
import type { PlatformCredentialsService } from '../services/platform-credentials.service';
import { GitConnectionsService } from './git-connections.service';
import type { GitHubAppTokens } from './github-app';

const callers: Record<string, AccessCaller> = {
  admin: { userId: 'u-admin', isApiKey: false, clusterRole: 'cluster-admin', projects: new Map() },
  creator: { userId: 'u-creator', isApiKey: false, projects: new Map([['shop', 'admin']]) },
  shopAdmin: { userId: 'u-shop-admin', isApiKey: false, projects: new Map([['shop', 'admin']]) },
  dev: { userId: 'u-dev', isApiKey: false, projects: new Map([['shop', 'developer']]) },
};

const CONNECTION_ID = '6f1c1b0e-0000-4000-8000-000000000001';

/** A stored connection (for update / delete / rotate). */
const stored = (over: Record<string, unknown> = {}) => ({
  id: CONNECTION_ID,
  project: 'shop',
  scopeKey: 'shop',
  provider: 'gitlab',
  repoUrl: 'https://gitlab.example.com/acme/shop.git',
  branch: 'main',
  path: 'deploy',
  mode: 'authoritative',
  credentials: 'secret://shop/gitlab-token',
  apiUrl: null,
  caCertificate: null,
  pollIntervalSeconds: null,
  webhook: true,
  approvalByMergeReview: false,
  membershipsFromGit: false,
  autoMerge: true,
  sops: false,
  githubApp: false,
  webhookSalt: 'salt-1',
  webhookGeneration: 0,
  pushAuthors: null,
  hostKey: null,
  lastSyncedCommit: 'abc',
  lastSyncAt: null,
  lastError: null,
  createdBy: 'u-shop-admin',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function service(who: keyof typeof callers, existing: unknown = null, current: unknown = null) {
  const saved: unknown[] = [];
  const updates: unknown[] = [];
  const deleted: { entity: string; where: unknown }[] = [];
  const plans = new Map<string, { id: string; status: string }>([
    ['p-pending', { id: 'p-pending', status: 'pending' }],
  ]);
  const repo = (entity: string) => ({
    findOne: jest.fn(async (q: { where?: { id?: string } }) =>
      entity === 'PlanEntity' ? (plans.get(q.where?.id ?? '') ?? null) : existing,
    ),
    find: jest.fn(async () =>
      entity === 'GitPullRequestEntity' ? [{ planId: 'p-pending', applyPlanId: null }, { planId: 'p-gone' }] : [],
    ),
    create: (x: object) => x,
    save: jest.fn(async (x: object) => {
      saved.push(x);

      return { id: CONNECTION_ID, createdAt: new Date(), updatedAt: new Date(), ...x };
    }),
    update: jest.fn(async (where: unknown, values: unknown) => {
      updates.push({ entity, where, values });

      return { affected: 1 };
    }),
    delete: jest.fn(async (where: unknown) => {
      deleted.push({ entity, where });
    }),
  });
  const manager = {
    getRepository: (e: { name: string }) => repo(e.name),
    query: jest.fn(async () => []),
  };
  const dataSource = {
    getRepository: (e: { name: string }) =>
      e.name === 'GitConnectionEntity'
        ? { findOne: async () => current }
        : { findOne: async () => ({ kind: 'Project', name: 'shop' }) },
    transaction: async (fn: (m: unknown) => Promise<unknown>) => await fn(manager),
    manager: {},
  } as unknown as DataSource;
  const events = { planStatus: jest.fn() } as unknown as ChangeEventsService;
  const access = {
    caller: async () => callers[who],
    settings: async () => ({ createdBy: 'u-creator' }),
  } as unknown as ProjectAccessService;
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditLogService;

  return {
    svc: new GitConnectionsService(
      dataSource,
      access,
      audit,
      {} as PlatformCredentialsService,
      { installationToken: async () => null } as unknown as GitHubAppTokens,
      events,
    ),
    saved,
    updates,
    deleted,
    audit,
    events,
    manager,
  };
}

const dto = (over: Partial<CreateGitConnectionDto> = {}): CreateGitConnectionDto =>
  ({
    project: 'shop',
    provider: 'gitlab',
    repoUrl: 'https://gitlab.example.com/acme/shop.git',
    branch: 'main',
    path: './deploy/',
    mode: 'authoritative',
    credentials: 'secret://shop/gitlab-token',
    ...over,
  }) as CreateGitConnectionDto;

describe('GitConnectionsService', () => {
  const env = process.env['ENCRYPTION_KEY'];

  beforeAll(() => (process.env['ENCRYPTION_KEY'] = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE='));
  afterAll(() => (process.env['ENCRYPTION_KEY'] = env));

  it('lets project admins connect their project; the webhook secret is returned once, the path normalized', async () => {
    const { svc, saved, audit } = service('shopAdmin');
    const created = await svc.create(undefined, dto());

    expect(created).toMatchObject({
      project: 'shop',
      path: 'deploy',
      webhookPath: expect.stringContaining('/api/git/webhooks/'),
    });
    expect(created.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(saved[0]).toMatchObject({ scopeKey: 'shop', webhook: true, mode: 'authoritative' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'git.connection.create' }),
    );
  });

  it('refuses developers, and project admins for the cluster scope', async () => {
    await expect(service('dev').svc.create(undefined, dto())).rejects.toThrow(ForbiddenException);
    await expect(service('shopAdmin').svc.create(undefined, dto({ project: undefined }))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service('admin').svc.create(undefined, dto({ project: undefined }))).resolves.toMatchObject({
      project: null,
    });
  });

  it.each([
    [{ repoUrl: 'file:///srv/repo' }, 'only https://'],
    [{ repoUrl: 'https://user:pw@gitlab.example.com/a/b.git' }, 'credentials do not belong'],
    [{ branch: '-x' }, 'invalid branch'],
    [{ path: '../x' }, 'relative'],
    [{ credentials: 'secret://other/token' }, 'its own secrets'],
    [{ repoUrl: 'git@gitlab.example.com:a/b.git', credentials: undefined }, 'deploy key'],
    [{ webhook: false }, 'enable webhooks or polling'],
    [{ apiUrl: 'http://gitlab.example.com/api/v4' }, 'https://'],
    [{ caCertificate: '-----BEGIN PRIVATE KEY-----' }, 'PEM certificates'],
  ])('validates %j', async (over, reason) => {
    const attempt = service('shopAdmin').svc.create(undefined, dto(over as Partial<CreateGitConnectionDto>));

    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow(reason);
  });

  it('lets only cluster admins and the project creator enable memberships from Git (they can grant admin roles)', async () => {
    await expect(service('shopAdmin').svc.create(undefined, dto({ membershipsFromGit: true }))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service('creator').svc.create(undefined, dto({ membershipsFromGit: true }))).resolves.toMatchObject({
      membershipsFromGit: true,
    });
    await expect(service('admin').svc.create(undefined, dto({ membershipsFromGit: true }))).resolves.toBeDefined();
  });

  it('allows one connection per scope', async () => {
    await expect(service('shopAdmin', { id: 'x' }).svc.create(undefined, dto())).rejects.toThrow(ConflictException);
  });

  it('lets only cluster admins hand the GitHub App to a connection', async () => {
    const github = { provider: 'github' as const, repoUrl: 'https://github.com/acme/infra.git', githubApp: true };

    await expect(service('shopAdmin').svc.create(undefined, dto(github))).rejects.toThrow(
      new ForbiddenException('only cluster admins may let a connection use the GitHub App'),
    );
    await expect(service('admin').svc.create(undefined, dto({ ...github, provider: 'gitlab' }))).rejects.toThrow(
      BadRequestException,
    );
    expect((await service('admin').svc.create(undefined, dto(github))).githubApp).toBe(true);
  });

  describe('updates', () => {
    it('rejects null for settings that cannot be cleared, and unknown providers / modes (400)', async () => {
      for (const over of [{ provider: null }, { repoUrl: null }, { branch: null }, { webhook: null }, { path: null }])
        await expect(
          service('shopAdmin', null, stored()).svc.update(undefined, CONNECTION_ID, over as never),
        ).rejects.toThrow(BadRequestException);

      await expect(
        service('shopAdmin', null, stored()).svc.update(undefined, CONNECTION_ID, { provider: 'svn' } as never),
      ).rejects.toThrow('provider must be one of');
      await expect(
        service('shopAdmin', null, stored()).svc.update(undefined, CONNECTION_ID, { credentials: null }),
      ).resolves.toMatchObject({ credentials: null });
    });

    it('with memberships from Git: pointing it elsewhere needs who may manage admins, others turn it off (M3)', async () => {
      const on = stored({ membershipsFromGit: true });

      // A project admin (not the creator) changing the repository / branch / credentials: the flag goes off.
      for (const change of [
        { repoUrl: 'https://gitlab.example.com/evil/shop.git' },
        { branch: 'other' },
        { path: 'elsewhere' },
        { credentials: 'secret://shop/other-token' },
        { apiUrl: 'https://gitlab.example.com/api/v4' },
        { caCertificate: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----' },
      ])
        expect(
          (await service('shopAdmin', null, on).svc.update(undefined, CONNECTION_ID, change)).membershipsFromGit,
        ).toBe(false);

      // ... and can't keep it on explicitly.
      await expect(
        service('shopAdmin', null, on).svc.update(undefined, CONNECTION_ID, {
          branch: 'other',
          membershipsFromGit: true,
        }),
      ).rejects.toThrow(ForbiddenException);

      // Unrelated changes keep it; the creator and cluster admins keep it on any change.
      expect(
        (await service('shopAdmin', null, on).svc.update(undefined, CONNECTION_ID, { autoMerge: false }))
          .membershipsFromGit,
      ).toBe(true);
      expect(
        (await service('creator', null, on).svc.update(undefined, CONNECTION_ID, { branch: 'other' }))
          .membershipsFromGit,
      ).toBe(true);
      expect(
        (
          await service('admin', null, on).svc.update(undefined, CONNECTION_ID, {
            repoUrl: 'https://gitlab.example.com/a/b.git',
          })
        ).membershipsFromGit,
      ).toBe(true);
    });

    it('forgets the synced resource state when the repository, branch or path changes (L2)', async () => {
      const moved = service('shopAdmin', null, stored());

      await moved.svc.update(undefined, CONNECTION_ID, { path: 'other' });
      expect(moved.deleted).toContainEqual({
        entity: 'GitResourceStateEntity',
        where: { connectionId: CONNECTION_ID },
      });

      const same = service('shopAdmin', null, stored());

      await same.svc.update(undefined, CONNECTION_ID, { autoMerge: false });
      expect(same.deleted).toEqual([]);
    });
  });

  it('rotates the webhook secret: a new salt, the old secret stops working, audited', async () => {
    const { svc, updates, audit } = service('shopAdmin', null, stored());
    const before = svc.webhookSecretOf({ id: CONNECTION_ID, webhookSalt: 'salt-1' });
    const rotated = await svc.rotateWebhookSecret(undefined, CONNECTION_ID);

    expect(rotated.webhookGeneration).toBe(1);
    expect(rotated.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated.webhookSecret).not.toBe(before);

    const salt = (updates[0] as { values: { webhookSalt: string } }).values.webhookSalt;

    expect(svc.webhookSecretOf({ id: CONNECTION_ID, webhookSalt: salt })).toBe(rotated.webhookSecret);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'git.connection.webhook-secret-rotated', details: { generation: 1 } }),
    );
    await expect(service('dev', null, stored()).svc.rotateWebhookSecret(undefined, CONNECTION_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('discards the pending plans of its pull requests and releases their locks on delete (L8)', async () => {
    const { svc, updates, manager, events } = service('shopAdmin', null, stored());

    await svc.remove(undefined, CONNECTION_ID);
    expect(updates).toContainEqual({
      entity: 'PlanEntity',
      where: { id: 'p-pending', status: 'pending' },
      values: { status: 'discarded' },
    });
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('lw_resource_locks'), ['p-pending']);
    expect(events.planStatus).toHaveBeenCalledWith('p-pending', 'discarded');
  });
});
