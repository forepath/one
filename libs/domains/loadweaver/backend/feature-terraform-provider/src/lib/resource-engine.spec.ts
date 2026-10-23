import { createPluginLogger, UNKNOWN, type TfObject } from '@forepath/loadweaver/backend/util-terraform-protocol';

import { LoadweaverApiError, LoadweaverClient } from './api-client';
import { DATA_SOURCE_DEFINITIONS } from './data-sources';
import type { RunnerContext } from './plan-runner';
import type { ProviderSettings } from './provider-config';
import {
  applyResourceChange,
  importResourceState,
  planResourceChange,
  readResource,
  validateResourceConfig,
} from './resource-engine';
import { definitionFor, resourceSchema, type ResourceDefinition } from './resources';
import { FakeControlPlane } from './testing/fake-control-plane';

const SETTINGS: ProviderSettings = {
  endpoint: 'https://cp.test',
  token: 'test-token',
  project: 'shop',
  caCertificate: null,
  approvalTimeoutMs: 60_000,
  applyTimeoutMs: 60_000,
  pollIntervalMs: 10,
  confirmPins: false,
  dryRun: true,
};

function setup(settings: Partial<ProviderSettings> = {}, extra: Partial<RunnerContext> = {}) {
  const fake = new FakeControlPlane();
  const logs: string[] = [];
  const ctx: RunnerContext = {
    client: new LoadweaverClient('https://cp.test', 'test-token', fake.transport(), 'test'),
    settings: { ...SETTINGS, ...settings },
    logger: createPluginLogger('test', (l) => logs.push(l)),
    signal: new AbortController().signal,
    sleep: async () => undefined,
    ...extra,
  };

  return { fake, ctx, logs };
}

function def(typeName: string): ResourceDefinition {
  const d = definitionFor(typeName);

  if (!d) throw new Error(typeName);

  return d;
}

/** A configuration object with every schema attribute (null if not given), as Terraform sends it. */
function config(typeName: string, values: TfObject): TfObject {
  return {
    ...Object.fromEntries(resourceSchema(def(typeName)).attributes.map((a) => [a.name, null])),
    ...values,
  };
}

/** Terraform's proposed new state: config, with optional+computed attributes taken from the prior state. */
function proposed(typeName: string, cfg: TfObject, prior: TfObject | null): TfObject {
  const out: TfObject = { ...cfg };

  for (const a of resourceSchema(def(typeName)).attributes)
    if (a.computed && (cfg[a.name] === null || cfg[a.name] === undefined)) out[a.name] = prior?.[a.name] ?? null;

  return out;
}

async function planAndApply(
  ctx: RunnerContext,
  typeName: string,
  cfg: TfObject,
  prior: TfObject | null,
): Promise<TfObject | null> {
  const plan = await planResourceChange(def(typeName), ctx, {
    prior,
    proposed: proposed(typeName, cfg, prior),
    config: cfg,
  });

  expect(plan.diagnostics.filter((d) => d.severity === 1)).toEqual([]);

  const applied = await applyResourceChange(def(typeName), ctx, { prior, planned: plan.planned });

  expect(applied.diagnostics.filter((d) => d.severity === 1)).toEqual([]);

  return applied.newState;
}

const json = (v: unknown) => JSON.stringify(v);

/** A nested object as Terraform sends it: every attribute of the nested schema, null where not configured. */
function nested(typeName: string, attribute: string, values: TfObject): TfObject {
  const schema = resourceSchema(def(typeName)).attributes.find((a) => a.name === attribute);

  return { ...Object.fromEntries((schema?.nested?.attributes ?? []).map((a) => [a.name, null])), ...values };
}

const VM = 'loadweaver_virtual_machine';
const vmDisk = (values: TfObject) => nested(VM, 'disks', values);
const vmNic = (values: TfObject) => nested(VM, 'nics', values);
const VM_CREATE: TfObject = {
  name: 'db1',
  labels: { app: 'db' },
  image: 'registry.lw/shop/debian-13:20261017',
  vcpus: 2,
  memory: '4Gi',
  disks: [
    vmDisk({ name: 'root', size: '20Gi', source: 'image', replicas: 2 }),
    vmDisk({ name: 'data', size: '100Gi' }),
  ],
  nics: [vmNic({ name: 'eth0', groups: ['db'] }), vmNic({ name: 'backup', ipv6: false })],
  cloud_init: nested(VM, 'cloud_init', { ssh_authorized_keys: ['ssh-ed25519 AAAA test'] }),
};

const CASES: [string, string, TfObject, TfObject][] = [
  [
    'loadweaver_project',
    'Project/shop',
    { name: 'shop', description: 'Shop', quota_cpu: '8' },
    { description: 'Shop v2' },
  ],
  [
    'loadweaver_deployment',
    'Deployment/shop/site',
    { name: 'site', compose: 'services:\n  web:\n    image: nginx\n', variables: { TAG: '1' } },
    { variables: { TAG: '2' } },
  ],
  [
    'loadweaver_workload_group',
    'WorkloadGroup/shop/web',
    { name: 'web', spec: json({ selector: { matchLabels: { app: 'web' } } }) },
    { spec: json({ selector: { matchLabels: { app: 'web' } }, exposed: true }) },
  ],
  [
    'loadweaver_node_group',
    'NodeGroup/edge',
    { name: 'edge', spec: json({ selector: { matchLabels: { role: 'edge' } } }) },
    { labels: { tier: 'edge' } },
  ],
  ['loadweaver_client_group', 'ClientGroup/staff', { name: 'staff', spec: json({}) }, { labels: { team: 'ops' } }],
  [
    'loadweaver_policy',
    'Policy/shop/web-in',
    {
      name: 'web-in',
      spec: json({ from: [{ builtin: 'internet' }], to: [{ group: 'web' }], rules: [{ ports: [80] }] }),
    },
    { spec: json({ from: [{ builtin: 'internet' }], to: [{ group: 'web' }], rules: [{ ports: [443] }] }) },
  ],
  [
    'loadweaver_dns_zone',
    'DnsZone/example',
    { name: 'example', spec: json({ zone: 'example.com', provider: 'cloudflare' }) },
    { labels: { env: 'prod' } },
  ],
  [
    'loadweaver_dns_record',
    'DnsRecord/shop/www',
    { name: 'www', spec: json({ zone: 'example', name: 'www', type: 'A', values: ['192.0.2.1'] }) },
    { spec: json({ zone: 'example', name: 'www', type: 'A', values: ['192.0.2.2'] }) },
  ],
  [
    'loadweaver_alert_rule',
    'AlertRule/shop/cpu',
    { name: 'cpu', spec: json({ condition: { metric: { name: 'replica.cpu', op: '>', threshold: 0.9 } } }) },
    { spec: json({ condition: { metric: { name: 'replica.cpu', op: '>', threshold: 0.8 } } }) },
  ],
  [
    'loadweaver_backup_policy',
    'BackupPolicy/shop/daily',
    { name: 'daily', spec: json({ schedules: ['@daily'] }) },
    { spec: json({ schedules: ['@hourly'] }) },
  ],
  [VM, 'VirtualMachine/shop/db1', VM_CREATE, { vcpus: 4, run_strategy: 'Manual' }],
  [
    'loadweaver_resource',
    'ImagePolicy/shop/signed',
    {
      kind: 'ImagePolicy',
      name: 'signed',
      spec: json({ selector: { matchLabels: { app: 'web' } }, vulnerabilities: { block: ['CRITICAL'] } }),
    },
    { labels: { strict: 'yes' } },
  ],
];

describe.each(CASES)('%s', (typeName, key, create, update) => {
  it('plans with a dry-run plan, applies, reads back stable, updates and deletes through Loadweaver plans', async () => {
    const { fake, ctx } = setup();
    const cfg = config(typeName, create);
    const plan = await planResourceChange(def(typeName), ctx, {
      prior: null,
      proposed: proposed(typeName, cfg, null),
      config: cfg,
    });

    expect(plan.diagnostics.filter((d) => d.severity === 1)).toEqual([]);
    expect(plan.planned?.['id']).toBe(key);
    expect(plan.planned?.['last_plan_id']).toBe(UNKNOWN);
    // The dry-run plan was created and discarded; nothing stored.
    expect([...fake.plans.values()].map((p) => p.status)).toEqual(['discarded']);
    expect(fake.resources.size).toBe(0);

    const created = await planAndApply(ctx, typeName, cfg, null);

    expect(fake.resources.has(key)).toBe(true);
    expect(created?.['id']).toBe(key);
    expect(typeof created?.['last_plan_id']).toBe('string');

    // Refresh keeps the configured form (the control plane filled in defaults) → no diff.
    const read = await readResource(def(typeName), ctx, created);

    expect(read.newState).toEqual(created);

    const noop = await planResourceChange(def(typeName), ctx, {
      prior: read.newState,
      proposed: proposed(typeName, cfg, read.newState),
      config: cfg,
    });

    expect(noop.planned).toEqual(read.newState);
    expect(noop.requiresReplace).toEqual([]);

    const updatedCfg = config(typeName, { ...create, ...update });
    const updated = await planAndApply(ctx, typeName, updatedCfg, read.newState);

    expect(updated?.['last_plan_id']).not.toBe(created?.['last_plan_id']);
    expect((await readResource(def(typeName), ctx, updated)).newState).toEqual(updated);

    const destroyPlan = await planResourceChange(def(typeName), ctx, { prior: updated, proposed: null, config: null });

    expect(destroyPlan.planned).toBeNull();

    const destroyed = await applyResourceChange(def(typeName), ctx, { prior: updated, planned: null });

    expect(destroyed).toEqual({ newState: null, diagnostics: [] });
    expect(fake.resources.has(key)).toBe(false);
    expect(fake.pendingPlans()).toEqual([]);
  });
});

describe('loadweaver_virtual_machine', () => {
  it('stores disks, NICs and cloud-init in the spec form and keeps the configured form on refresh', async () => {
    const { fake, ctx } = setup();
    const created = await planAndApply(ctx, VM, config(VM, VM_CREATE), null);

    expect(fake.resources.get('VirtualMachine/shop/db1')).toMatchObject({
      metadata: { name: 'db1', project: 'shop', labels: { app: 'db' } },
      spec: {
        image: 'registry.lw/shop/debian-13:20261017',
        firmware: 'uefi',
        cpu: { vcpus: 2, model: 'host-model' },
        memory: '4Gi',
        disks: [
          { name: 'root', size: '20Gi', source: 'image', replicas: 2, bus: 'virtio', cache: 'none' },
          { name: 'data', size: '100Gi', source: 'blank', bus: 'virtio', cache: 'none' },
        ],
        nics: [
          { name: 'eth0', groups: ['db'] },
          { name: 'backup', groups: [], ipv6: false },
        ],
        cloudInit: { sshAuthorizedKeys: ['ssh-ed25519 AAAA test'], networkConfig: 'auto' },
        ha: { restartElsewhere: true },
        runStrategy: 'Always',
      },
    });
    // Defaults filled in by the control plane don't show up as differences.
    expect(created?.['firmware']).toBeNull();
    expect(created?.['disks']).toEqual(VM_CREATE['disks']);
  });

  it('shows drift inside a nested list and maps issues onto the nested attribute', async () => {
    const { fake, ctx } = setup();
    const created = await planAndApply(ctx, VM, config(VM, VM_CREATE), null);
    const stored = fake.resources.get('VirtualMachine/shop/db1')!;
    const spec = stored.spec as { disks: { size: string }[] };

    fake.seed({ ...stored, spec: { ...spec, disks: [spec.disks[0], { ...spec.disks[1], size: '200Gi' }] } as never });

    const read = await readResource(def(VM), ctx, created);

    expect((read.newState?.['disks'] as TfObject[])[1]).toMatchObject({ name: 'data', size: '200Gi', cache: 'none' });
    // Untouched attributes keep their configured form.
    expect(read.newState?.['nics']).toEqual(VM_CREATE['nics']);
    expect(read.newState?.['firmware']).toBeNull();

    const twoBootDisks = config(VM, {
      ...VM_CREATE,
      name: 'db2',
      disks: [
        vmDisk({ name: 'a', size: '20Gi', source: 'image' }),
        vmDisk({ name: 'b', size: '1Gi', source: 'image' }),
      ],
    });
    const plan = await planResourceChange(def(VM), ctx, { prior: null, proposed: twoBootDisks, config: twoBootDisks });

    expect(plan.diagnostics).toEqual([
      expect.objectContaining({
        severity: 1,
        summary: 'Invalid VirtualMachine',
        attribute: { steps: [{ attribute_name: 'disks' }] },
      }),
    ]);
  });

  it('reads the status of a virtual machine', async () => {
    const { ctx } = setup();

    await planAndApply(ctx, VM, config(VM, VM_CREATE), null);

    const status = DATA_SOURCE_DEFINITIONS.find((d) => d.typeName === 'loadweaver_virtual_machine_status')!;
    const read = await status.read(ctx, { name: 'db1', project: null });

    expect(read.state).toMatchObject({
      id: 'VirtualMachine/shop/db1',
      phase: 'Running',
      node: 'node-1',
      addresses: ['10.64.1.10', '10.64.1.11'],
      nics: [
        { name: 'eth0', primary: true, addresses: ['10.64.1.10'] },
        { name: 'backup', primary: false },
      ],
      disks: [
        { name: 'root', volume: 'shop/lw-vm/db1.root', boot: true, size_bytes: 20 * 1024 ** 3 },
        { name: 'data', boot: false },
      ],
    });
    expect((read.state?.['pinned_image'] as string).startsWith('registry.lw/shop/debian-13:20261017@sha256:')).toBe(
      true,
    );

    const missing = await status.read(ctx, { name: 'nope', project: 'shop' });

    expect(missing.diagnostics[0]).toMatchObject({ summary: 'Virtual machine not found' });
  });
});

describe('resource engine', () => {
  it('fills typed defaults from the cluster after the apply (unknown at plan time)', async () => {
    const { ctx } = setup();
    const cfg = config('loadweaver_project', { name: 'shop' });
    const plan = await planResourceChange(def('loadweaver_project'), ctx, { prior: null, proposed: cfg, config: cfg });

    expect(plan.planned?.['default_cpu']).toBe(UNKNOWN);

    const applied = await applyResourceChange(def('loadweaver_project'), ctx, { prior: null, planned: plan.planned });

    expect(applied.newState).toMatchObject({ default_cpu: '0.25', default_memory: '256m', default_volume_size: '10g' });
  });

  it('uses the provider project, and asks for one where a kind needs it', async () => {
    const { ctx } = setup({ project: null });
    const cfg = config('loadweaver_deployment', { name: 'site', compose: 'services: {}\n' });
    const plan = await planResourceChange(def('loadweaver_deployment'), ctx, {
      prior: null,
      proposed: cfg,
      config: cfg,
    });

    expect(plan.diagnostics).toEqual([expect.objectContaining({ severity: 1, summary: 'Missing project' })]);

    // `any` kinds without a project are cluster-wide.
    const policyCfg = config('loadweaver_policy', {
      name: 'p',
      spec: json({ from: [{ builtin: 'cluster' }], to: [{ builtin: 'internet' }] }),
    });
    const policy = await planResourceChange(def('loadweaver_policy'), ctx, {
      prior: null,
      proposed: policyCfg,
      config: policyCfg,
    });

    expect(policy.planned).toMatchObject({ project: '', id: 'Policy/p' });
  });

  it('marks name and project changes as replacements', async () => {
    const { ctx } = setup();
    const cfg = config('loadweaver_workload_group', { name: 'web', spec: json({ selector: {} }) });
    const created = await planAndApply(ctx, 'loadweaver_workload_group', cfg, null);
    const renamed = config('loadweaver_workload_group', {
      name: 'web2',
      spec: json({ selector: {} }),
      project: 'other',
    });
    const plan = await planResourceChange(def('loadweaver_workload_group'), ctx, {
      prior: created,
      proposed: proposed('loadweaver_workload_group', renamed, created),
      config: renamed,
    });

    expect(plan.requiresReplace.sort()).toEqual(['name', 'project']);
  });

  it('reports schema errors locally with the attribute', async () => {
    const { fake, ctx } = setup();
    const cfg = config('loadweaver_policy', { name: 'p', spec: json({ from: [], bogus: 1 }) });
    const plan = await planResourceChange(def('loadweaver_policy'), ctx, { prior: null, proposed: cfg, config: cfg });

    expect(plan.diagnostics.length).toBeGreaterThan(0);
    expect(plan.diagnostics.every((d) => d.severity === 1 && d.attribute?.steps[0].attribute_name === 'spec')).toBe(
      true,
    );
    expect(fake.plans.size).toBe(0);
  });

  it('skips the dry run while values are unknown, and with dry_run = false', async () => {
    const { fake, ctx } = setup();
    const cfg = config('loadweaver_workload_group', { name: 'web', spec: UNKNOWN });

    await planResourceChange(def('loadweaver_workload_group'), ctx, { prior: null, proposed: cfg, config: cfg });
    expect(fake.plans.size).toBe(0);

    const off = setup({ dryRun: false });
    const known = config('loadweaver_workload_group', { name: 'web', spec: json({ selector: {} }) });

    await planResourceChange(def('loadweaver_workload_group'), off.ctx, {
      prior: null,
      proposed: known,
      config: known,
    });
    expect(off.fake.plans.size).toBe(0);
  });

  it('shows network / workload effects and pins of the dry run as a warning', async () => {
    const { fake, ctx } = setup();

    fake.pins = true;

    const cfg = config('loadweaver_policy', {
      name: 'web-in',
      spec: json({ from: [{ builtin: 'internet' }], to: [{ group: 'web' }], rules: [{ ports: [80] }] }),
    });
    const plan = await planResourceChange(def('loadweaver_policy'), ctx, { prior: null, proposed: cfg, config: cfg });

    expect(plan.diagnostics).toEqual([
      expect.objectContaining({
        severity: 2,
        summary: 'Loadweaver dry-run plan: create Policy shop/web-in',
        detail: expect.stringContaining('filtering create on node-1: policy web-in'),
      }),
    ]);
    expect(plan.diagnostics[0].detail).toContain('pin: apply needs confirm_pins = true');
  });

  it('maps control-plane refusals of the dry run onto attributes', async () => {
    const { ctx } = setup();

    jest.spyOn(ctx.client, 'createPlan').mockRejectedValue(
      new LoadweaverApiError(400, {
        message: 'Invalid resources',
        issues: [{ document: 0, path: 'spec.compose', message: 'service web: unknown key' }],
      }),
    );

    const cfg = config('loadweaver_deployment', { name: 'site', compose: 'services: {}\n' });
    const plan = await planResourceChange(def('loadweaver_deployment'), ctx, {
      prior: null,
      proposed: cfg,
      config: cfg,
    });

    expect(plan.diagnostics).toEqual([
      expect.objectContaining({
        severity: 1,
        detail: 'spec.compose: service web: unknown key',
        attribute: { steps: [{ attribute_name: 'compose' }] },
      }),
    ]);
  });

  it('waits for an approval while the apply is blocked, then applies', async () => {
    let polls = 0;
    const holder: { fake?: FakeControlPlane } = {};
    const { fake, ctx, logs } = setup(
      {},
      {
        sleep: async () => {
          if (++polls === 3) holder.fake?.approve(holder.fake.pendingPlans()[0].id);
        },
      },
    );

    holder.fake = fake;
    fake.approvalRequired.add('shop');

    const cfg = config('loadweaver_workload_group', { name: 'web', spec: json({ selector: {} }) });
    const plan = await planResourceChange(def('loadweaver_workload_group'), ctx, {
      prior: null,
      proposed: cfg,
      config: cfg,
    });
    const applied = await applyResourceChange(def('loadweaver_workload_group'), ctx, {
      prior: null,
      planned: plan.planned,
    });

    expect(applied.newState?.['id']).toBe('WorkloadGroup/shop/web');
    expect(applied.diagnostics).toEqual([
      expect.objectContaining({ severity: 2, summary: expect.stringContaining('was approved') }),
    ]);
    expect(polls).toBe(3);
    expect(logs.some((l) => l.includes('waits for approval: project shop'))).toBe(true);
  });

  it('gives up after approval_timeout, discards the plan and explains how to approve', async () => {
    let t = 0;
    const { fake, ctx } = setup({ approvalTimeoutMs: 1_000 }, { now: () => (t += 400) });

    fake.approvalRequired.add('shop');

    const cfg = config('loadweaver_workload_group', { name: 'web', spec: json({ selector: {} }) });
    const plan = await planResourceChange(def('loadweaver_workload_group'), ctx, {
      prior: null,
      proposed: cfg,
      config: cfg,
    });
    const applied = await applyResourceChange(def('loadweaver_workload_group'), ctx, {
      prior: null,
      planned: plan.planned,
    });

    expect(applied.newState).toBeNull();
    expect(applied.diagnostics[0]).toMatchObject({ severity: 1, summary: 'Loadweaver plan not approved in time' });
    expect(applied.diagnostics[0].detail).toContain('project shop: an approval by an operator or admin is required');
    expect(fake.pendingPlans()).toEqual([]);
    expect(fake.resources.size).toBe(0);
  });

  it('discards the pending plan when Terraform stops the provider while waiting', async () => {
    const abort = new AbortController();
    const { fake, ctx } = setup(
      {},
      {
        signal: abort.signal,
        sleep: async () => {
          abort.abort();
          throw new Error('interrupted');
        },
      },
    );

    fake.approvalRequired.add('shop');

    const cfg = config('loadweaver_workload_group', { name: 'web', spec: json({ selector: {} }) });
    const applied = await applyResourceChange(def('loadweaver_workload_group'), ctx, {
      prior: null,
      planned: { ...cfg, project: 'shop', id: 'WorkloadGroup/shop/web', last_plan_id: UNKNOWN },
    });

    expect(applied.diagnostics[0]).toMatchObject({ summary: 'Interrupted' });
    expect(fake.pendingPlans()).toEqual([]);
  });

  it('refuses pins unless confirm_pins is set', async () => {
    const planned = (ctx: RunnerContext) =>
      applyResourceChange(def('loadweaver_backup_policy'), ctx, {
        prior: null,
        planned: {
          ...config('loadweaver_backup_policy', { name: 'daily', spec: json({ schedules: ['@daily'] }) }),
          project: 'shop',
          id: 'BackupPolicy/shop/daily',
          last_plan_id: UNKNOWN,
        },
      });
    const refused = setup();

    refused.fake.pins = true;
    expect((await planned(refused.ctx)).diagnostics[0]).toMatchObject({
      summary: 'The Loadweaver plan contains unacknowledged pins',
    });

    const confirmed = setup({ confirmPins: true });

    confirmed.fake.pins = true;
    expect((await planned(confirmed.ctx)).newState?.['last_plan_id']).toEqual(expect.any(String));
  });

  it('follows an apply until it settled and reports a rollback', async () => {
    const { fake, ctx } = setup();

    fake.applyingPolls = 2;

    const cfg = config('loadweaver_workload_group', { name: 'web', spec: json({ selector: {} }) });
    const planned: TfObject = { ...cfg, project: 'shop', id: 'WorkloadGroup/shop/web', last_plan_id: UNKNOWN };

    expect(
      (await applyResourceChange(def('loadweaver_workload_group'), ctx, { prior: null, planned })).newState,
    ).toMatchObject({
      id: 'WorkloadGroup/shop/web',
    });

    fake.failApplyWith = 'node-2 failed: port 80 in use';

    const failed = await applyResourceChange(def('loadweaver_workload_group'), ctx, {
      prior: null,
      planned: { ...planned, labels: { a: 'b' } },
    });

    expect(failed.newState).toBeNull();
    expect(failed.diagnostics[0].summary).toMatch(/rolled-back$/);
    expect(failed.diagnostics[0].detail).toContain('node-2 failed: port 80 in use');
  });

  it('removes deleted resources from the state on refresh and puts drift into it', async () => {
    const { fake, ctx } = setup();
    const cfg = config('loadweaver_workload_group', {
      name: 'web',
      spec: json({ selector: { matchLabels: { app: 'web' } } }),
    });
    const created = await planAndApply(ctx, 'loadweaver_workload_group', cfg, null);
    const stored = fake.resources.get('WorkloadGroup/shop/web');

    fake.seed({ ...stored!, spec: { ...(stored!.spec as object), exposed: true } as never });

    const drifted = await readResource(def('loadweaver_workload_group'), ctx, created);

    expect(JSON.parse(String(drifted.newState?.['spec']))).toMatchObject({ exposed: true, intraGroup: 'allow' });

    fake.resources.clear();
    expect((await readResource(def('loadweaver_workload_group'), ctx, created)).newState).toBeNull();
  });

  it('imports by name, project/name and Kind/project/name', () => {
    const attrs = (t: string) => resourceSchema(def(t)).attributes.map((a) => a.name);

    expect(
      importResourceState(def('loadweaver_project'), 'shop', attrs('loadweaver_project'), null).state,
    ).toMatchObject({
      id: 'Project/shop',
      name: 'shop',
      description: null,
    });
    expect(
      importResourceState(def('loadweaver_deployment'), 'shop/site', attrs('loadweaver_deployment'), null).state,
    ).toMatchObject({
      id: 'Deployment/shop/site',
      project: 'shop',
    });
    expect(
      importResourceState(def('loadweaver_deployment'), 'site', attrs('loadweaver_deployment'), 'shop').state,
    ).toMatchObject({
      project: 'shop',
    });
    expect(
      importResourceState(def('loadweaver_policy'), 'global', attrs('loadweaver_policy'), 'shop').state,
    ).toMatchObject({
      id: 'Policy/global',
      project: '',
    });
    expect(
      importResourceState(def('loadweaver_resource'), 'ImagePolicy/shop/signed', attrs('loadweaver_resource'), null)
        .state,
    ).toMatchObject({ kind: 'ImagePolicy', project: 'shop', name: 'signed' });
    expect(
      importResourceState(def('loadweaver_deployment'), 'site', attrs('loadweaver_deployment'), null).diagnostics[0]
        .summary,
    ).toBe('Invalid import ID');
    expect(
      importResourceState(def('loadweaver_project'), 'a/b', attrs('loadweaver_project'), null).diagnostics[0].summary,
    ).toBe('Invalid import ID');
    expect(
      importResourceState(def('loadweaver_resource'), 'Nope/x', attrs('loadweaver_resource'), null).diagnostics[0]
        .summary,
    ).toBe('Invalid import ID');
  });

  it('reads imported resources fully (spec as canonical JSON, typed attributes)', async () => {
    const { fake, ctx } = setup();

    fake.seed({
      apiVersion: 'loadweaver.com/v1',
      kind: 'Project',
      metadata: { name: 'shop', labels: { team: 'a' } },
      spec: { description: 'S', defaults: { cpu: '1', memory: '1g', volumeSize: '5g' } },
    } as never);

    const attrs = resourceSchema(def('loadweaver_project')).attributes.map((a) => a.name);
    const imported = importResourceState(def('loadweaver_project'), 'shop', attrs, null).state;
    const read = await readResource(def('loadweaver_project'), ctx, imported);

    expect(read.newState).toMatchObject({ description: 'S', default_cpu: '1', labels: { team: 'a' }, quota_cpu: null });
  });

  it('validates names, kinds and JSON before planning', () => {
    expect(
      validateResourceConfig(def('loadweaver_policy'), config('loadweaver_policy', { name: 'Bad_Name', spec: '{' })),
    ).toEqual([
      expect.objectContaining({ summary: 'Invalid name' }),
      expect.objectContaining({ summary: 'Invalid spec' }),
    ]);
    expect(
      validateResourceConfig(
        def('loadweaver_resource'),
        config('loadweaver_resource', { kind: 'Nope', name: 'x', spec: '[]' }),
      ),
    ).toEqual([
      expect.objectContaining({ summary: 'Unknown kind' }),
      expect.objectContaining({ summary: 'Invalid spec' }),
    ]);
  });

  it('reports a 403 with the scopes it needs', async () => {
    const { fake, ctx } = setup();

    fake.transport = () => async () => ({
      status: 403,
      body: JSON.stringify({ message: 'project shop: developer role or higher required' }),
    });
    ctx.client = new LoadweaverClient('https://cp.test', 'test-token', fake.transport(), 'test');

    const cfg = config('loadweaver_workload_group', { name: 'web', spec: json({ selector: {} }) });
    const plan = await planResourceChange(def('loadweaver_workload_group'), ctx, {
      prior: null,
      proposed: cfg,
      config: cfg,
    });

    expect(plan.diagnostics[0]).toMatchObject({ severity: 1, summary: 'Not allowed to dry-run plan' });
    expect(plan.diagnostics[0].detail).toContain('plans:create');
  });
});
