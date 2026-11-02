import type { CatalogSource } from '@forepath/loadweaver/shared/util-app-catalog';
import {
  APP_INSTALL_ANNOTATION,
  APP_SECRETS_ANNOTATION,
  backupBeforeUpdateOf,
  installedAppOf,
  parseResourceDocuments,
  type Resource,
} from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { parse } from 'yaml';

import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { AppCatalogsService } from './app-catalogs.service';
import { AppPlansService } from './app-plans.service';
import { AppCatalogEntity, AppPackageEntity, AppTakedownFlagEntity } from './app-store.entities';
import {
  blobSignature,
  memoryDataSource,
  testCatalog,
  WIKI_COMPOSE,
  WIKI_MANIFEST,
  type TestCatalog,
} from './app-store.testing';

const KEYS = new Map<unknown, string[]>([
  [AppCatalogEntity, ['name']],
  [AppPackageEntity, ['catalog', 'app', 'version']],
  [AppTakedownFlagEntity, ['project', 'deployment']],
  [ResourceEntity, ['kind', 'projectKey', 'name']],
  [VolumePlacementEntity, ['id']],
]);

const developer = { isApiKey: false, projects: new Map([['shop', 'developer']]) };
const viewer = { isApiKey: false, projects: new Map([['shop', 'viewer']]) };
const admin = { clusterRole: 'cluster-admin', isApiKey: false, projects: new Map() };
const install = {
  project: 'shop',
  parameters: { hostname: 'wiki.example.com' },
  secrets: { 'db-password': 'secret://shop/wiki-db' },
};

async function setup(catalog: TestCatalog = testCatalog(['1.0.0', '1.2.0']), allowedTrust?: string[]) {
  const { dataSource, table } = memoryDataSource(KEYS);
  const caller = { current: admin as Record<string, unknown> };
  const access = { caller: jest.fn(async () => caller.current) };
  const audit = { record: jest.fn(async () => undefined) };
  let served = catalog;
  const catalogs = new AppCatalogsService(
    dataSource as never,
    access as never,
    audit as never,
    {} as never,
    {} as never,
  );

  catalogs.official = { type: 'oci', url: 'oci://ghcr.io/forepath/loadweaver-apps', publicKeys: [] };
  catalogs.clients = {
    git: {
      fetchIndex: async () => {
        const bytes = served.indexBytes();

        return { bytes, signature: blobSignature(bytes, served.catalogKey) };
      },
      fetchPackage: async (_s: CatalogSource, _a: string, version: string) => {
        const bytes = served.packages.get(version) as Buffer;

        return { bytes, signature: blobSignature(bytes, served.publisherKey) };
      },
    },
  };
  table(ResourceEntity).push({
    kind: 'Cluster',
    projectKey: '',
    name: 'cluster',
    spec: {
      appStore: {
        catalogs: [
          {
            name: 'acme',
            type: 'git',
            url: 'https://git.example.com/acme/apps.git',
            publicKeys: [catalog.catalogKey.publicKeyPem],
            enabled: true,
          },
        ],
        ...(allowedTrust ? { allowedTrust } : {}),
      },
    },
  });
  await catalogs.refresh(undefined);

  const drafts = {
    create: jest.fn(async (_req: unknown, input: { title: string; ops: unknown[] }) => ({
      id: 'draft-1',
      title: input.title,
      ops: input.ops,
    })),
  };
  const plans = new AppPlansService(dataSource as never, access as never, catalogs, drafts as never, audit as never);

  caller.current = developer;

  return { plans, catalogs, drafts, table, caller, audit, serve: (next: TestCatalog) => (served = next) };
}

function docs(ops: { document?: string }[]): Resource[] {
  return ops.flatMap((op) => {
    if (!op.document) return [];

    const parsed = parseResourceDocuments(op.document);

    if (parsed.ok === false) throw new Error('invalid document');

    return parsed.resources;
  });
}

/** Applies an install draft to the memory store (what submitting the plan would do). */
function apply(table: (e: unknown) => Record<string, unknown>[], resources: Resource[]) {
  for (const r of resources)
    table(ResourceEntity).push({
      kind: r.kind,
      name: r.metadata.name,
      project: r.metadata.project,
      projectKey: r.metadata.project ?? '',
      labels: r.metadata.labels ?? {},
      annotations: r.metadata.annotations ?? {},
      spec: r.spec,
      generation: 3,
    });
}

describe('AppPlansService: install (P1)', () => {
  it('creates a draft with the Deployment and the suggestions as separate ops', async () => {
    const { plans, drafts, audit } = await setup();
    const result = await plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', install);
    const ops = drafts.create.mock.calls[0][1].ops as { op: string; document: string }[];
    const [deployment, group, backup] = docs(ops);

    expect(drafts.create.mock.calls[0][1].title).toBe('Install Wiki 1.2.0 as shop/wiki');
    expect(ops.map((o) => o.op)).toEqual(['upsert', 'upsert', 'upsert']);
    expect(installedAppOf(deployment.metadata.annotations)).toMatchObject({
      catalog: 'acme',
      name: 'wiki',
      version: '1.2.0',
      channel: 'stable',
    });
    expect([group.kind, backup.kind]).toEqual(['WorkloadGroup', 'BackupPolicy']);
    expect(result.ops.map((o) => [o.role, o.kind, o.group ?? null])).toEqual([
      ['deployment', 'Deployment', null],
      ['suggestion', 'WorkloadGroup', 'groups'],
      ['suggestion', 'BackupPolicy', 'backups'],
    ]);
    expect(result.warnings).toEqual([expect.stringContaining('Cluster is a cluster-level resource')]);
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'app.install-plan', target: 'deployment/shop/wiki' }),
    );
  });

  it('takes a deployment name and a subset of suggestions; existing resources are left alone', async () => {
    const { plans, drafts, table } = await setup();

    table(ResourceEntity).push({
      kind: 'BackupPolicy',
      projectKey: 'shop',
      project: 'shop',
      name: 'docs-nightly',
      annotations: {},
    });

    const result = await plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', {
      ...install,
      deployment: 'docs',
      suggestions: ['backups'],
    });

    expect(docs(drafts.create.mock.calls[0][1].ops as never).map((r) => r.kind)).toEqual(['Deployment']);
    expect(result.warnings).toContain('BackupPolicy shop/docs-nightly exists already and is left as it is');
  });

  it('refuses: viewers, existing deployments, disallowed trust, taken-down versions, lint / render errors', async () => {
    const { plans, caller, table } = await setup();

    caller.current = viewer;
    await expect(plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', install)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    caller.current = developer;
    await expect(
      plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', { ...install, parameters: {} }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    table(ResourceEntity).push({
      kind: 'Deployment',
      projectKey: 'shop',
      project: 'shop',
      name: 'wiki',
      annotations: {},
    });
    await expect(plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', install)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const community = await setup(testCatalog(['1.2.0'], { trust: 'community' }));

    await expect(community.plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', install)).rejects.toThrow(
      "doesn't allow installing community apps",
    );

    const takenDown = await setup(
      testCatalog(['1.2.0'], {
        takedowns: [{ app: 'wiki', versions: 'all', reason: 'abandoned', at: '2026-10-31T00:00:00Z' }],
      }),
    );

    await expect(takenDown.plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', install)).rejects.toBeInstanceOf(
      GoneException,
    );
  });
});

describe('AppPlansService: conditional secrets (2026-11-01)', () => {
  // A token needed only with search on (`requiredWhen`), mounted next to the database password.
  const manifest = WIKI_MANIFEST.replace(
    '    bundlePostgres: { type: boolean, default: true }\n',
    '    bundlePostgres: { type: boolean, default: true }\n    search: { type: boolean, default: false }\n',
  ).replace(
    '    description: Database password\n',
    '    description: Database password\n  - name: search-token\n    description: Search token\n    requiredWhen: { parameter: search }\n',
  );
  const compose = WIKI_COMPOSE.replace(
    '    secrets: [db-password]\n',
    '    secrets: [db-password, search-token]\n',
  ).replace(
    '    x-loadweaver-ref: ${secret:db-password}\n',
    '    x-loadweaver-ref: ${secret:db-password}\n  search-token:\n    x-loadweaver-ref: ${secret:search-token}\n',
  );

  it('installs without the secret while its condition is off (left out of the compose), refuses it when on', async () => {
    const { plans, drafts } = await setup(testCatalog(['1.2.0'], { manifest, compose }));
    const off = await plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', install);
    const [deployment] = docs(drafts.create.mock.calls[0][1].ops as { document?: string }[]);
    const tree = parse((deployment.spec as { compose: string }).compose);

    expect(off.action).toBe('install');
    expect(Object.keys(tree.secrets)).toEqual(['db-password']);
    expect(tree.services.web.secrets).toEqual(['db-password']);

    await expect(
      plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', {
        ...install,
        deployment: 'wiki-2',
        parameters: { ...install.parameters, search: true },
      }),
    ).rejects.toMatchObject({
      response: { errors: ['secret search-token needs a secret reference (required while search is true)'] },
    });

    await plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', {
      ...install,
      deployment: 'wiki-3',
      parameters: { ...install.parameters, search: true },
      secrets: { ...install.secrets, 'search-token': 'secret://shop/search' },
    });

    const [on] = docs(drafts.create.mock.calls.at(-1)?.[1].ops as { document?: string }[]);

    expect(parse((on.spec as { compose: string }).compose).secrets['search-token']).toEqual({
      'x-loadweaver-ref': 'secret://shop/search',
    });
  });

  it('drops a reference given while the condition is off: not mounted, not recorded, not checked', async () => {
    const { plans, drafts } = await setup(testCatalog(['1.2.0'], { manifest, compose }));

    await plans.installPlan(undefined, 'acme', 'wiki', '1.2.0', {
      ...install,
      secrets: { ...install.secrets, 'search-token': 'secret://other/search' },
    });

    const [deployment] = docs(drafts.create.mock.calls[0][1].ops as { document?: string }[]);
    const tree = parse((deployment.spec as { compose: string }).compose);

    expect(Object.keys(tree.secrets)).toEqual(['db-password']);
    expect(tree.services.web.secrets).toEqual(['db-password']);
    expect(JSON.parse(deployment.metadata.annotations?.[APP_SECRETS_ANNOTATION] ?? '{}')).toEqual(install.secrets);
  });

  it('removes the mount when an update switches the condition off', async () => {
    const { plans, drafts, table } = await setup(testCatalog(['1.0.0', '1.2.0'], { manifest, compose }));
    const on = {
      ...install,
      parameters: { ...install.parameters, search: true },
      secrets: { ...install.secrets, 'search-token': 'secret://shop/search' },
    };

    await plans.installPlan(undefined, 'acme', 'wiki', '1.0.0', on);
    apply(table, docs(drafts.create.mock.calls[0][1].ops as never));
    drafts.create.mockClear();
    await plans.updatePlan(undefined, 'shop', 'wiki', { version: '1.2.0', parameters: { search: false } });

    const [deployment] = docs(drafts.create.mock.calls[0][1].ops as { document?: string }[]);
    const tree = parse((deployment.spec as { compose: string }).compose);

    expect(Object.keys(tree.secrets)).toEqual(['db-password']);
    expect(tree.services.web.secrets).toEqual(['db-password']);
    expect(JSON.parse(deployment.metadata.annotations?.[APP_SECRETS_ANNOTATION] ?? '{}')).toEqual(install.secrets);
  });
});

describe('AppPlansService: minLoadweaver on install (P1)', () => {
  it('refuses an install the cluster is too old for (400); allows a newer cluster and development builds', async () => {
    const { plans, catalogs, drafts } = await setup(testCatalog(['1.0.0'], { minLoadweaver: '4.2.0' }));

    catalogs.loadweaverVersion = () => '4.1.0';
    await expect(plans.installPlan(undefined, 'acme', 'wiki', '1.0.0', install)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(plans.installPlan(undefined, 'acme', 'wiki', '1.0.0', install)).rejects.toThrow(
      'needs Loadweaver 4.2.0 or newer; this cluster runs 4.1.0',
    );
    expect(drafts.create).not.toHaveBeenCalled();

    catalogs.loadweaverVersion = () => '0.0.0-dev';
    expect((await plans.installPlan(undefined, 'acme', 'wiki', '1.0.0', install)).warnings.join(' ')).toContain(
      'development build',
    );

    catalogs.loadweaverVersion = () => '4.2.0';
    await expect(
      plans.installPlan(undefined, 'acme', 'wiki', '1.0.0', { ...install, deployment: 'wiki-2' }),
    ).resolves.toMatchObject({ action: 'install' });
  });
});

describe('AppPlansService: update (P1)', () => {
  async function installed(catalog?: TestCatalog) {
    const ctx = await setup(catalog);
    await ctx.plans.installPlan(undefined, 'acme', 'wiki', '1.0.0', install);
    apply(ctx.table, docs(ctx.drafts.create.mock.calls[0][1].ops as never));
    ctx
      .table(VolumePlacementEntity)
      .push({ id: 'shop/wiki/data' }, { id: 'shop/wiki/pgdata' }, { id: 'shop/other/data' });
    ctx.drafts.create.mockClear();

    return ctx;
  }

  it('marks the declared backups for the apply (backup first), adds the migrations as jobs, keeps the inputs', async () => {
    const { plans, drafts } = await installed();
    const result = await plans.updatePlan(undefined, 'shop', 'wiki', { version: '1.2.0' });
    const input = drafts.create.mock.calls[0][1] as {
      title: string;
      ops: { document: string; baseGeneration: number }[];
    };
    const [deployment] = docs(input.ops);
    const compose = parse((deployment.spec as { compose: string }).compose);

    // Nothing is backed up while planning (a developer may plan it): the apply backs up the declared volumes first.
    expect(backupBeforeUpdateOf(deployment.metadata.annotations)).toEqual({ version: '1.2.0', volumes: ['pgdata'] });
    expect(result.backups).toEqual([{ volume: 'shop/wiki/pgdata', status: 'planned', backup: null }]);
    expect(result.warnings.join(' ')).toContain('backs up pgdata first');
    expect(input.title).toBe('Update Wiki 1.0.0 → 1.2.0 in shop/wiki (backs up 1 volume(s) first)');
    expect(input.ops[0].baseGeneration).toBe(3);
    expect(installedAppOf(deployment.metadata.annotations)?.version).toBe('1.2.0');
    expect(compose.services.web.environment.HOSTNAME).toBe('wiki.example.com');
    expect(Object.keys(compose.services).filter((s) => s.startsWith('lw-migrate'))).toEqual([
      'lw-migrate-1-1-0-1',
      'lw-migrate-1-2-0-2',
    ]);
    expect(result.migrations.map((m) => m.version)).toEqual(['1.1.0', '1.2.0']);
    expect(result).toMatchObject({ action: 'update', from: '1.0.0', app: { version: '1.2.0' } });
  });

  it('records a skipped backup; refuses downgrades and deployments not installed from the store', async () => {
    const { plans, drafts, table } = await installed();

    await plans.updatePlan(undefined, 'shop', 'wiki', { version: '1.2.0', backup: 'skip' });
    expect(drafts.create.mock.calls[0][1].title).toContain('(no backup first)');
    expect(backupBeforeUpdateOf(docs(drafts.create.mock.calls[0][1].ops as never)[0].metadata.annotations)).toBeNull();

    await expect(plans.updatePlan(undefined, 'shop', 'wiki', { version: '1.0.0' })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    table(ResourceEntity).push({
      kind: 'Deployment',
      projectKey: 'shop',
      project: 'shop',
      name: 'plain',
      annotations: {},
    });
    await expect(plans.updatePlan(undefined, 'shop', 'plain', { version: '1.2.0' })).rejects.toThrow(
      'was not installed from the app store',
    );
  });

  it('apps without declared backups update as before (no marker, no backup)', async () => {
    const plain = testCatalog(['1.0.0', '1.2.0'], {
      manifest: WIKI_MANIFEST.replace(/backups:\n(?: {2}.*\n)+/, ''),
    });
    const { plans, drafts } = await installed(plain);
    const result = await plans.updatePlan(undefined, 'shop', 'wiki', { version: '1.2.0' });

    expect(backupBeforeUpdateOf(docs(drafts.create.mock.calls[0][1].ops as never)[0].metadata.annotations)).toBeNull();
    expect(result.backups).toEqual([]);
    expect(result.warnings.join(' ')).toContain('declares no backups');
  });

  it('refuses an update the cluster is too old for (minLoadweaver); development builds aren’t checked', async () => {
    const base = testCatalog(['1.0.0', '1.2.0']);
    const { plans, catalogs, serve, caller } = await installed(base);

    // A newer index (same keys): 1.2.0 needs Loadweaver 9.
    serve(testCatalog(['1.0.0', '1.2.0'], { keys: base, minLoadweaver: '9.0.0', generatedAt: '2026-11-01T00:00:00Z' }));
    caller.current = admin;
    await catalogs.refresh(undefined);
    caller.current = developer;

    catalogs.loadweaverVersion = () => '4.1.0';
    await expect(plans.updatePlan(undefined, 'shop', 'wiki', { version: '1.2.0' })).rejects.toThrow(
      'wiki 1.2.0 needs Loadweaver 9.0.0 or newer; this cluster runs 4.1.0',
    );

    catalogs.loadweaverVersion = () => null;
    expect((await plans.updatePlan(undefined, 'shop', 'wiki', { version: '1.2.0' })).warnings.join(' ')).toContain(
      'development build',
    );

    catalogs.loadweaverVersion = () => '9.1.0';
    expect((await plans.updatePlan(undefined, 'shop', 'wiki', { version: '1.2.0' })).warnings.join(' ')).not.toContain(
      'Loadweaver',
    );
  });
});

describe('AppPlansService: uninstall and installed apps (P1)', () => {
  async function installed() {
    const ctx = await setup();
    await ctx.plans.installPlan(undefined, 'acme', 'wiki', '1.0.0', install);
    apply(ctx.table, docs(ctx.drafts.create.mock.calls[0][1].ops as never));
    ctx.table(VolumePlacementEntity).push({ id: 'shop/wiki/pgdata' });
    ctx.drafts.create.mockClear();

    return ctx;
  }

  it('removes the Deployment and the suggested resources; the data decision is explicit', async () => {
    const { plans, drafts } = await installed();
    const keep = await plans.uninstallPlan(undefined, 'shop', 'wiki', { dataPolicy: 'keep' });
    const ops = drafts.create.mock.calls[0][1].ops as { op: string; kind: string; name: string }[];

    expect(ops.map((o) => [o.op, o.kind, o.name])).toEqual([
      ['delete', 'Deployment', 'wiki'],
      ['delete', 'WorkloadGroup', 'wiki-web'],
      ['delete', 'BackupPolicy', 'wiki-nightly'],
    ]);
    expect(keep).toMatchObject({ dataPolicy: 'keep', volumes: ['shop/wiki/pgdata'], backups: [] });
    expect(keep.warnings[0]).toContain('stay after the plan is applied');

    // backup: planning starts nothing (developer role); the Deployment's delete op backs the volumes up at apply.
    const backup = await plans.uninstallPlan(undefined, 'shop', 'wiki', {
      dataPolicy: 'backup',
      removeSuggested: false,
    });

    expect(backup.ops).toHaveLength(1);
    expect(backup.backups).toEqual([{ volume: 'shop/wiki/pgdata', status: 'planned', backup: null }]);
    expect(drafts.create.mock.calls.at(-1)?.[1].ops).toEqual([
      { op: 'delete', kind: 'Deployment', name: 'wiki', project: 'shop', backupFirst: ['pgdata'] },
    ]);
    expect(drafts.create.mock.calls.at(-1)?.[1].title).toContain('final backup of 1 volume(s) first');
    expect(backup.warnings[1]).toContain('backs up shop/wiki/pgdata first and removes the app only once');

    await expect(plans.uninstallPlan(undefined, 'shop', 'wiki', { dataPolicy: 'delete' })).rejects.toThrow(
      'confirm: "wiki"',
    );
    await expect(
      plans.uninstallPlan(undefined, 'shop', 'wiki', { dataPolicy: 'nope' as never }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const deleted = await plans.uninstallPlan(undefined, 'shop', 'wiki', { dataPolicy: 'delete', confirm: 'wiki' });

    expect(drafts.create.mock.calls.at(-1)?.[1].title).toContain('deletes 1 volume(s)');
    // The volumes go in the same plan (deleted once it is applied), after the Deployment and the suggestions.
    expect(
      (drafts.create.mock.calls.at(-1)?.[1].ops as { op: string; kind: string; name: string }[]).map((o) => [
        o.op,
        o.kind,
        o.name,
      ]),
    ).toEqual([
      ['delete', 'Deployment', 'wiki'],
      ['delete', 'WorkloadGroup', 'wiki-web'],
      ['delete', 'BackupPolicy', 'wiki-nightly'],
      ['delete', 'Volume', 'wiki/pgdata'],
    ]);
    expect(deleted.ops.at(-1)).toEqual({
      op: 'delete',
      kind: 'Volume',
      name: 'wiki/pgdata',
      project: 'shop',
      role: 'removal',
    });
    expect(deleted.warnings[0]).toContain('deleted once the plan is applied');
    expect(deleted.warnings[0]).toContain('backups are kept');
  });

  it('lists installed apps the caller may read, with updates and takedown flags', async () => {
    const { plans, table, caller } = await installed();

    table(AppTakedownFlagEntity).push({
      project: 'shop',
      deployment: 'wiki',
      version: '1.0.0',
      reason: 'vulnerable',
      takenDownAt: new Date('2026-11-01T00:00:00Z'),
    });

    const { apps } = await plans.installedApps(undefined);

    expect(apps).toEqual([
      expect.objectContaining({
        project: 'shop',
        deployment: 'wiki',
        title: 'Wiki',
        app: expect.objectContaining({ version: '1.0.0' }),
        updates: [expect.objectContaining({ version: '1.2.0' })],
        availability: 'ok',
        takedown: { reason: 'vulnerable', at: '2026-11-01T00:00:00.000Z' },
        parameters: { hostname: 'wiki.example.com', port: 8080, bundlePostgres: true },
      }),
    ]);

    caller.current = { isApiKey: false, projects: new Map([['other', 'admin']]) };
    expect((await plans.installedApps(undefined)).apps).toEqual([]);
    expect(
      table(ResourceEntity).some(
        (r) => r['annotations'] && (r['annotations'] as Record<string, string>)[APP_INSTALL_ANNOTATION],
      ),
    ).toBe(true);
  });
});
