import type { RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { ChangeEventsService } from '../services/change-events.service';

import type { AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { ClusterMemberEntity } from '../entities/cluster-member.entity';
import type { FleetGrantRole, VerifiedFleetIdentity } from '../fleet-identity/fleet-identity.utils';
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

  describe('through a fleet (3.41): the signed person, capped by the service user', () => {
    const PERSON = 'fleet:fleet-1:alice';
    const SHOP = stored();
    const OTHER = stored({ id: '6f1c1b0e-0000-4000-8000-000000000002', project: 'other', scopeKey: 'other' });
    const CLUSTER = stored({ id: '6f1c1b0e-0000-4000-8000-000000000003', project: null, scopeKey: '' });
    const identity = (role: FleetGrantRole | null, projects: Record<string, FleetGrantRole> = {}) =>
      ({
        person: PERSON,
        issuer: 'fleet-1',
        subject: 'alice',
        email: 'alice@example.com',
        emailVerified: true,
        role,
        projects,
        jti: 'jti-0123456789abcdef',
        expiresAt: new Date(Date.now() + 60_000),
      }) satisfies VerifiedFleetIdentity;
    /** The fleet's service user (a cluster-admin PAT with `fleet:on-behalf-of`), optionally with a verified person. */
    const relayed = (person?: VerifiedFleetIdentity) =>
      ({
        user: { id: 'svc-fleet', roles: ['user'], amr: ['pat'], scopes: ['fleet:on-behalf-of', 'git:admin'] },
        ...(person ? { fleetIdentity: person } : {}),
      }) as unknown as RequestWithUser;

    function fleetService(current: unknown = null) {
      const saved: Record<string, unknown>[] = [];
      const access = new ProjectAccessService(
        {
          manager: {
            getRepository: (entity: unknown) =>
              entity === ClusterMemberEntity
                ? { findOne: async () => ({ userId: 'svc-fleet', role: 'cluster-admin' }) }
                : { find: async () => [] },
          },
        } as never,
        {} as never,
      );
      const manager = {
        getRepository: () => ({
          findOne: async () => null,
          create: (x: object) => x,
          save: async (x: Record<string, unknown>) => {
            saved.push(x);

            return { id: CONNECTION_ID, createdAt: new Date(), updatedAt: new Date(), ...x };
          },
          update: async () => ({ affected: 1 }),
          delete: async () => undefined,
          find: async () => [],
        }),
        query: async () => [],
      };
      const dataSource = {
        getRepository: (e: { name: string }) =>
          e.name === 'GitConnectionEntity'
            ? { findOne: async () => current, find: async () => [CLUSTER, SHOP, OTHER] }
            : { findOne: async () => (e.name === 'ResourceEntity' ? { kind: 'Project', name: 'x' } : null) },
        transaction: async (fn: (m: unknown) => Promise<unknown>) => await fn(manager),
        manager: {},
      } as unknown as DataSource;
      const audit = {
        record: jest.fn(async () => undefined),
        recordStandalone: jest.fn(async () => undefined),
      } as unknown as AuditLogService;
      const svc = new GitConnectionsService(
        dataSource,
        access,
        audit,
        {} as PlatformCredentialsService,
        { installationToken: async () => null } as unknown as GitHubAppTokens,
        { planStatus: jest.fn() } as unknown as ChangeEventsService,
      );

      return { svc, saved, audit };
    }

    it('lets a project admin grant manage their own project’s connection as the person, audited on behalf', async () => {
      const shopAdmin = relayed(identity(null, { shop: 'admin' }));
      const { svc, saved, audit } = fleetService();

      await expect(svc.create(shopAdmin, dto())).resolves.toMatchObject({ project: 'shop' });
      expect(saved[0]).toMatchObject({ createdBy: PERSON });
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'git.connection.create',
          actor: expect.objectContaining({ id: 'svc-fleet', onBehalfOf: PERSON, person: PERSON }),
        }),
      );

      const update = fleetService(SHOP);

      await expect(update.svc.update(shopAdmin, CONNECTION_ID, { branch: 'next' })).resolves.toMatchObject({
        branch: 'next',
      });
      expect(update.audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actor: expect.objectContaining({ onBehalfOf: PERSON }) }),
      );
    });

    it('denies the person another project, the cluster scope and what stays stricter (GitHub App)', async () => {
      const shopAdmin = relayed(identity(null, { shop: 'admin' }));

      await expect(fleetService().svc.create(shopAdmin, dto({ project: 'other' }))).rejects.toThrow(ForbiddenException);
      await expect(fleetService().svc.create(shopAdmin, dto({ project: undefined }))).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        fleetService().svc.create(
          shopAdmin,
          dto({ provider: 'github', repoUrl: 'https://github.com/acme/shop.git', githubApp: true }),
        ),
      ).rejects.toThrow('only cluster admins may let a connection use the GitHub App');
      // Another project's / the cluster's connection: not even visible to the person.
      await expect(fleetService(OTHER).svc.update(shopAdmin, OTHER.id, { branch: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      await expect(fleetService(CLUSTER).svc.remove(shopAdmin, CLUSTER.id)).rejects.toThrow(NotFoundException);
      await expect(fleetService(CLUSTER).svc.revealWebhookSecret(shopAdmin, CLUSTER.id)).rejects.toThrow(
        NotFoundException,
      );
      // A project viewer reads but never manages.
      await expect(
        fleetService(SHOP).svc.update(relayed(identity(null, { shop: 'viewer' })), CONNECTION_ID, { branch: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lists only what the person may see', async () => {
      const { svc } = fleetService();

      expect((await svc.list(relayed(identity(null, { shop: 'admin' })))).map((c) => c.project)).toEqual(['shop']);
      expect((await svc.list(relayed(identity(null, { shop: 'viewer' })))).map((c) => c.project)).toEqual(['shop']);
      expect(await svc.list(relayed(identity(null)))).toEqual([]);
      // Cluster-wide fleet admins (and the service user itself, without a claim) see every scope, as before.
      expect((await svc.list(relayed(identity('admin')))).map((c) => c.project)).toEqual([null, 'shop', 'other']);
      expect((await svc.list(relayed())).map((c) => c.project)).toEqual([null, 'shop', 'other']);
    });

    it('keeps cluster-wide fleet admins working: every scope, as the person', async () => {
      const admin = relayed(identity('admin'));
      const { svc, saved, audit } = fleetService();

      await expect(svc.create(admin, dto({ project: undefined }))).resolves.toMatchObject({ project: null });
      expect(saved[0]).toMatchObject({ createdBy: PERSON });
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actor: expect.objectContaining({ onBehalfOf: PERSON }) }),
      );
      await expect(fleetService(OTHER).svc.revealWebhookSecret(admin, OTHER.id)).resolves.toMatchObject({
        webhookSecret: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      // A cluster-wide operator grant is no cluster admin (infra operator): the cluster scope stays closed.
      await expect(
        fleetService().svc.create(relayed(identity('operator')), dto({ project: undefined })),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
