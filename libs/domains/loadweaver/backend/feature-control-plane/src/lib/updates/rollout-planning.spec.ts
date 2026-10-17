import { maintenanceWindowSpecSchema, type MaintenanceWindowSpec } from '@forepath/loadweaver/shared/util-model';
import { buildManifest } from '@forepath/loadweaver/shared/util-release';

import {
  nextOccurrence,
  nodeWindowState,
  openOccurrence,
  wallClock,
  windowApplies,
  zonedInstant,
} from './maintenance-window.utils';
import { evaluateGates, gateBaseline, type GateInput } from './rollout-gates.utils';
import { componentDiff, drbdSpaasAllowed, planSteps, waveRisks, type PlannerNode } from './rollout-planner.utils';

const window = (spec: Partial<MaintenanceWindowSpec>): MaintenanceWindowSpec =>
  maintenanceWindowSpecSchema.parse({
    days: ['tue', 'thu'],
    start: '02:00',
    end: '05:00',
    timeZone: 'Europe/Berlin',
    ...spec,
  });

const at = (iso: string) => new Date(iso);

describe('maintenance windows (3.26)', () => {
  it('opens on the configured days and hours in the window time zone', () => {
    const w = window({});

    // Tue 2026-10-20 02:30 CEST = 00:30Z
    expect(openOccurrence('w', w, at('2026-10-20T00:30:00Z'))).toMatchObject({
      start: at('2026-10-20T00:00:00Z'),
      end: at('2026-10-20T03:00:00Z'),
    });
    // Tue 05:00 local is the end (exclusive)
    expect(openOccurrence('w', w, at('2026-10-20T03:00:00Z'))).toBeNull();
    // Wed: closed
    expect(openOccurrence('w', w, at('2026-10-21T00:30:00Z'))).toBeNull();
    expect(nextOccurrence('w', w, at('2026-10-21T00:30:00Z'))?.start).toEqual(at('2026-10-22T00:00:00Z'));
  });

  it('crosses midnight: a window starting Tuesday 23:00 still covers Wednesday 01:00', () => {
    const w = window({ days: ['tue'], start: '23:00', end: '02:00', timeZone: 'UTC' });

    expect(openOccurrence('w', w, at('2026-10-21T01:00:00Z'))?.start).toEqual(at('2026-10-20T23:00:00Z'));
    expect(openOccurrence('w', w, at('2026-10-21T02:00:00Z'))).toBeNull();
    // Monday 23:30 is not in a window that only starts on Tuesdays.
    expect(openOccurrence('w', w, at('2026-10-19T23:30:00Z'))).toBeNull();
  });

  it('handles DST: spring-forward gap moves the start, fall-back nights last longer', () => {
    // Europe/Berlin springs forward on 2026-03-29 at 02:00 → 03:00 (a Sunday).
    const spring = window({ days: ['sun'], start: '02:30', end: '04:00' });
    const o = openOccurrence('w', spring, at('2026-03-29T01:45:00Z'));

    expect(o?.start).toEqual(at('2026-03-29T01:30:00Z')); // 03:30 CEST, after the gap
    expect(o?.end).toEqual(at('2026-03-29T02:00:00Z')); // 04:00 CEST

    // Falls back on 2026-10-25 at 03:00 → 02:00: 01:00–04:00 local lasts four real hours.
    const fall = window({ days: ['sun'], start: '01:00', end: '04:00' });
    const f = openOccurrence('w', fall, at('2026-10-25T01:30:00Z'));

    expect(f?.start).toEqual(at('2026-10-24T23:00:00Z'));
    expect(f?.end).toEqual(at('2026-10-25T03:00:00Z'));
    // An ambiguous wall time resolves to its first occurrence.
    expect(zonedInstant({ year: 2026, month: 10, day: 25 }, 2, 30, 'Europe/Berlin')).toBe(
      Date.parse('2026-10-25T00:30:00Z'),
    );
  });

  it('evaluates other time zones (New York, Kathmandu) independently', () => {
    const ny = window({ days: ['mon'], start: '22:00', end: '23:00', timeZone: 'America/New_York' });

    // Mon 2026-10-19 22:30 EDT = Tue 02:30Z
    expect(openOccurrence('w', ny, at('2026-10-20T02:30:00Z'))).not.toBeNull();
    expect(wallClock(Date.parse('2026-10-20T02:30:00Z'), 'America/New_York')).toMatchObject({
      weekday: 'mon',
      hour: 22,
    });

    const ktm = window({ days: ['tue'], start: '00:00', end: '00:30', timeZone: 'Asia/Kathmandu' });

    // +05:45: Tue 00:10 local = Mon 18:25Z
    expect(openOccurrence('w', ktm, at('2026-10-19T18:25:00Z'))).not.toBeNull();
  });

  it('selects nodes by site and labels; nodes outside every window are never open', () => {
    const fra = window({ sites: ['fra1'], selector: { matchLabels: { tier: 'edge' } } });
    const node = { name: 'n1', site: 'fra1', labels: { tier: 'edge' } };

    expect(windowApplies(fra, node)).toBe(true);
    expect(windowApplies(fra, { ...node, site: 'ams1' })).toBe(false);
    expect(windowApplies(fra, { ...node, labels: {} })).toBe(false);

    const state = nodeWindowState([{ name: 'fra', spec: fra }], node, at('2026-10-21T00:30:00Z'));

    expect(state).toMatchObject({ windows: ['fra'], open: false, opensAt: at('2026-10-22T00:00:00Z') });
    expect(nodeWindowState([], node, at('2026-10-21T00:30:00Z'))).toMatchObject({ open: false, opensAt: null });
  });

  it('refuses invalid windows', () => {
    expect(() => window({ timeZone: 'Mars/Olympus' })).toThrow();
    expect(() => window({ start: '25:00' })).toThrow();
    expect(() => window({ start: '02:00', end: '02:00' })).toThrow();
    expect(() => window({ days: [] })).toThrow();
  });
});

const node = (name: string, site: string, extra: Partial<PlannerNode> = {}): PlannerNode => ({
  name,
  site,
  controlPlane: false,
  witness: false,
  lifecycle: 'active',
  replicas: 3,
  components: true,
  ...extra,
});

describe('rollout planner (3.26)', () => {
  const nodes = [
    node('m1', 'fra1', { controlPlane: true, postgres: 'leader' }),
    node('m2', 'fra1', { controlPlane: true, postgres: 'replica' }),
    node('m3', 'ams1', { controlPlane: true, postgres: 'replica' }),
    node('a', 'fra1', { replicas: 5 }),
    node('b', 'fra1', { replicas: 1 }),
    node('c', 'ams1'),
    node('d', 'ams1'),
    node('e', 'par1'),
    node('old', 'par1', { components: false }),
    node('gone', 'par1', { lifecycle: 'left' }),
  ];

  it('updates members one at a time (leader last), then the least busy canary, then one site at a time', () => {
    const plan = planSteps({ nodes, failureDomain: 'node', host: false });

    expect(plan.steps.map((s) => `${s.wave}:${s.phase}:${s.node}`)).toEqual([
      '0:control-plane:m2',
      '1:control-plane:m3',
      '2:control-plane:m1',
      '3:canary:b',
      '4:wave:a',
      '5:wave:c',
      '6:wave:d',
      '7:wave:e',
    ]);
    expect(plan.skipped).toEqual([{ node: 'old', reason: expect.stringContaining('predates release components') }]);
    expect(new Set(plan.steps.map((s) => s.kind))).toEqual(new Set(['components']));
  });

  it('never puts more than the failure domain tolerates into a wave, nor two sites', () => {
    const plan = planSteps({ nodes, failureDomain: 'site', host: true });
    const waves = new Map<number, string[]>();

    for (const s of plan.steps.filter((x) => x.phase === 'wave'))
      waves.set(s.wave, [...(waves.get(s.wave) ?? []), s.site]);

    for (const sites of waves.values()) expect(new Set(sites).size).toBe(1);

    expect(plan.steps.filter((s) => s.phase === 'wave').map((s) => `${s.wave}:${s.node}`)).toEqual([
      '4:a',
      '5:c',
      '5:d',
      '6:e',
    ]);
    expect(plan.steps.every((s) => s.kind === 'host')).toBe(true);
    // Node failure domain: one node per wave.
    const single = planSteps({ nodes, failureDomain: 'node', host: true });

    expect(new Set(single.steps.map((s) => s.wave)).size).toBe(single.steps.length);
  });

  it('works for a single node and for clusters of members only', () => {
    expect(
      planSteps({ nodes: [node('solo', 's', { controlPlane: true })], failureDomain: 'node', host: false }).steps,
    ).toEqual([{ index: 0, wave: 0, phase: 'control-plane', node: 'solo', site: 's', kind: 'components' }]);
    expect(
      planSteps({ nodes: [node('x', 's')], failureDomain: 'node', host: false }).steps.map((s) => s.phase),
    ).toEqual(['canary']);
  });

  it('names what a disruptive wave puts at risk', () => {
    const plan = planSteps({ nodes: [node('a', 's'), node('b', 's')], failureDomain: 'node', host: true });
    const risks = waveRisks(
      plan.steps,
      [
        { id: 'p/d/web/0', node: 'a', project: 'p', deployment: 'd', service: 'web' },
        { id: 'p/d/api/0', node: 'a', project: 'p', deployment: 'd', service: 'api' },
        { id: 'p/d/api/1', node: 'b', project: 'p', deployment: 'd', service: 'api' },
      ],
      [{ id: 'p/d/data', nodes: ['a'] }],
      true,
    );

    expect(risks[0]).toMatchObject({
      nodes: ['a'],
      risk: [expect.stringContaining('p/d/web'), expect.stringContaining('volume p/d/data')],
    });
    expect(risks[1].risk).toEqual([]);
    expect(waveRisks(plan.steps, [], [{ id: 'v', nodes: ['a'] }], false)[0].risk).toEqual([]);
  });

  it('diffs components per node: images by digest, the agent, host components only with host updates', () => {
    const manifest = buildManifest({
      version: '3.5.0',
      channel: 'stable',
      created: '2026-10-19T00:00:00.000Z',
      images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:${'c'.repeat(64)}` },
      agentBinaries: {},
    });
    const base = {
      os: 'debian:13',
      arch: 'amd64',
      agentVersion: '3.4.0',
      packages: { bird2: '2.17.5-0+deb13u1' },
      gvisor: '20261005.0',
      drbd: '9.2.20',
    };
    const diff = componentDiff(
      [
        {
          ...base,
          name: 'm1',
          controlPlane: true,
          images: {
            'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api@sha256:${'b'.repeat(64)}`,
            etcd: manifest.components['etcd']
              ? `quay.io/coreos/etcd@${(manifest.components['etcd'] as { digest: string }).digest}`
              : '',
          },
        },
        { ...base, name: 'n1', controlPlane: false, images: {} },
      ],
      manifest,
      false,
    );

    expect(diff.filter((d) => d.node === 'm1').map((d) => d.component)).toEqual(
      expect.arrayContaining(['node-agent', 'control-plane', 'postgres']),
    );
    expect(diff.some((d) => d.node === 'm1' && d.component === 'etcd')).toBe(false);
    expect(diff.filter((d) => d.node === 'n1').map((d) => d.component)).toEqual(['node-agent']);

    const host = componentDiff([{ ...base, name: 'n1', controlPlane: false, images: {} }], manifest, true);

    expect(host.map((d) => d.component)).toEqual(
      expect.arrayContaining(['gvisor', 'package:drbd-utils', 'package:docker-ce']),
    );
    expect(host.some((d) => d.component === 'package:bird2')).toBe(false);
    expect(host.find((d) => d.component === 'gvisor')?.method).toContain('drain');
  });
});

describe('health gates (3.26)', () => {
  const base = (over: Partial<GateInput> = {}): GateInput => ({
    now: 100_000,
    heartbeatTimeoutMs: 30_000,
    step: {
      node: 'n1',
      kind: 'components',
      release: '3.5.0',
      agentVersion: '3.5.0',
      actionIds: ['act'],
      baseline: { unhealthy: ['volume/p/d/v:at-risk'], burning: [] },
      member: false,
    },
    node: { connected: true, lastSeenAt: 95_000, agentVersion: '3.5.0', components: { release: '3.5.0' } },
    health: [],
    slos: [],
    replication: [],
    members: [],
    ...over,
  });

  it('passes when the node is back with the new version and nothing got worse', () => {
    expect(evaluateGates(base()).state).toBe('pass');
  });

  it('waits for reconnect, version, reboot, replication and quorum', () => {
    expect(
      evaluateGates(base({ node: { connected: false, lastSeenAt: 95_000, agentVersion: '3.5.0', components: null } }))
        .state,
    ).toBe('wait');
    expect(
      evaluateGates(
        base({
          node: { connected: true, lastSeenAt: 95_000, agentVersion: '3.4.0', components: { release: '3.5.0' } },
        }),
      ).gates.find((g) => g.name === 'version')?.state,
    ).toBe('wait');
    expect(
      evaluateGates(
        base({
          step: { ...base().step, bootIdBefore: 'boot-1' },
          node: { ...base().node, components: { release: '3.5.0', bootId: 'boot-1' } },
        }),
      ).state,
    ).toBe('wait');
    expect(evaluateGates(base({ replication: [{ node: 'n2', syncing: 1, degraded: 0 }] })).state).toBe('wait');
    expect(
      evaluateGates(
        base({
          step: { ...base().step, member: true },
          members: [
            { name: 'm1', connected: true, witness: false, postgres: 'replica' },
            { name: 'm2', connected: true, witness: false, postgres: 'replica' },
          ],
        }),
      ).gates.find((g) => g.name === 'quorum'),
    ).toMatchObject({ state: 'wait', message: expect.stringContaining('one Postgres leader') });
  });

  it('fails on failed actions, newly failed entities and newly burning SLOs; at-risk entities are waited for', () => {
    expect(
      evaluateGates(
        base({
          node: {
            ...base().node,
            components: {
              release: '3.5.0',
              actions: [
                { id: 'act', kind: 'self-update', phase: 'failed', error: 'checksum', at: new Date(0).toISOString() },
              ],
            },
          },
        }),
      ),
    ).toMatchObject({ state: 'fail' });
    expect(
      evaluateGates(
        base({
          health: [{ key: 'service/p/d/web', kind: 'service', state: 'failed', reasons: [{ code: 'no-replica' }] }],
        }),
      ).state,
    ).toBe('fail');
    expect(
      evaluateGates(
        base({
          health: [{ key: 'volume/p/d/x', kind: 'volume', state: 'at-risk', reasons: [{ code: 'replica-down' }] }],
        }),
      ).state,
    ).toBe('wait');
    // Unchanged problems from before the step don't count; the node under maintenance doesn't either.
    expect(
      evaluateGates(
        base({
          health: [
            { key: 'volume/p/d/v', kind: 'volume', state: 'at-risk', reasons: [{ code: 'x' }] },
            { key: 'node/n1', kind: 'node', state: 'failed', reasons: [{ code: 'node-down' }] },
          ],
        }),
      ).gates.find((g) => g.name === 'health')?.state,
    ).toBe('pass');
    expect(evaluateGates(base({ slos: [{ key: 'p/d/web', state: 'burning' }] })).state).toBe('fail');
    expect(
      evaluateGates(
        base({
          step: { ...base().step, baseline: { unhealthy: [], burning: ['p/d/web'] } },
          slos: [{ key: 'p/d/web', state: 'burning' }],
        }),
      ).state,
    ).toBe('pass');
  });

  it('fails when the release label matches but the control-plane layer of that apply failed (M6 review H1)', () => {
    const applied = (over: Partial<GateInput['node']>) =>
      base({
        step: { ...base().step, revision: 12 },
        node: { ...base().node, appliedRevision: 11, reportRevision: 12, reportSteps: [], ...over },
      });

    const failed = evaluateGates(
      applied({
        reportSteps: [
          { layer: 'components', status: 'applied' },
          { layer: 'control-plane', status: 'failed', message: 'etcd did not start' },
        ],
      }),
    );

    expect(failed.state).toBe('fail');
    expect(failed.gates.find((g) => g.name === 'apply')?.message).toContain('control-plane: etcd did not start');
    // Another layer failing is waited for; not having applied the revision yet too; the revision applied passes.
    expect(
      evaluateGates(applied({ reportSteps: [{ layer: 'workloads', status: 'failed' }] })).gates.find(
        (g) => g.name === 'apply',
      )?.state,
    ).toBe('wait');
    expect(evaluateGates(applied({ reportRevision: 11 })).state).toBe('wait');
    expect(evaluateGates(applied({ appliedRevision: 12 })).state).toBe('pass');
    // The desired state doesn't carry the release yet.
    expect(evaluateGates(base({ step: { ...base().step, revision: null } })).state).toBe('wait');
  });

  it('waits until every container runs the release digest and a member runs etcd / Postgres / the API', () => {
    const images = { envoy: 'sha256:eee', etcd: 'sha256:111', postgres: 'sha256:222', 'control-plane': 'sha256:333' };
    const node = (running: Record<string, string>, overrides?: string[]) => ({
      ...base().node,
      components: { release: '3.5.0', images: running, ...(overrides ? { overrides } : {}) },
    });

    expect(
      evaluateGates(base({ step: { ...base().step, images }, node: node({ envoy: 'envoy@sha256:old' }) })).gates.find(
        (g) => g.name === 'images',
      ),
    ).toMatchObject({ state: 'wait', message: expect.stringContaining('envoy (envoy@sha256:old)') });
    expect(
      evaluateGates(base({ step: { ...base().step, images }, node: node({ envoy: 'envoy@sha256:old' }, ['envoy']) }))
        .state,
    ).toBe('pass');

    const member = { ...base().step, images, member: true };
    const runningAll = { etcd: 'e@sha256:111', postgres: 'p@sha256:222', 'control-plane': 'c@sha256:333' };

    // etcd stopped: missing from the report.
    expect(
      evaluateGates(
        base({ step: member, node: node({ postgres: 'p@sha256:222', 'control-plane': 'c@sha256:333' }) }),
      ).gates.find((g) => g.name === 'images'),
    ).toMatchObject({ state: 'wait', message: expect.stringContaining('etcd') });
    expect(evaluateGates(base({ step: member, node: node(runningAll) })).state).toBe('pass');
    // Witnesses only run etcd.
    expect(
      evaluateGates(base({ step: { ...member, witness: true }, node: node({ etcd: 'e@sha256:111' }) })).state,
    ).toBe('pass');
  });

  it('waits for etcd health and membership, every Postgres member and caught-up replicas', () => {
    const quorum = (members: GateInput['members']) =>
      evaluateGates(base({ step: { ...base().step, member: true }, members })).gates.find((g) => g.name === 'quorum');
    const healthy = { healthy: true, members: 3 };
    const ok: GateInput['members'] = [
      { name: 'm1', connected: true, witness: false, postgres: 'leader', etcd: healthy },
      { name: 'm2', connected: true, witness: false, postgres: 'replica', postgresLag: 0, etcd: healthy },
      { name: 'w1', connected: true, witness: true, etcd: healthy },
    ];

    expect(quorum(ok)?.state).toBe('pass');
    expect(quorum(ok.map((m) => (m.name === 'm2' ? { ...m, etcd: { healthy: false, members: 3 } } : m)))).toMatchObject(
      { state: 'wait', message: expect.stringContaining('etcd on m2') },
    );
    expect(quorum(ok.map((m) => (m.name === 'w1' ? { ...m, etcd: { healthy: true, members: 2 } } : m)))).toMatchObject({
      state: 'wait',
      message: expect.stringContaining('w1 sees 2'),
    });
    expect(quorum(ok.map((m) => (m.name === 'm2' ? { ...m, postgres: 'unknown' } : m)))).toMatchObject({
      state: 'wait',
      message: expect.stringContaining('Postgres on m2'),
    });
    expect(quorum(ok.map((m) => (m.name === 'm2' ? { ...m, postgresLag: 64 * 1024 * 1024 } : m)))).toMatchObject({
      state: 'wait',
      message: expect.stringContaining('catch up'),
    });
    // N-1 agents report no etcd / lag: not held against them.
    expect(
      quorum(ok.map((m) => ({ name: m.name, connected: m.connected, witness: m.witness, postgres: m.postgres })))
        ?.state,
    ).toBe('pass');
  });

  it('ignores release-keyed actions of an earlier attempt of the step', () => {
    const stale = {
      id: 'self-update:3.5.0',
      kind: 'self-update' as const,
      phase: 'rolled-back' as const,
      error: 'did not confirm',
      at: new Date(50_000).toISOString(),
    };
    const input = (startedAt: number) =>
      base({
        step: { ...base().step, actionIds: ['self-update:3.5.0'], startedAt },
        node: { ...base().node, components: { release: '3.5.0', actions: [stale] } },
      });

    expect(evaluateGates(input(60_000)).state).toBe('pass');
    expect(evaluateGates(input(40_000)).state).toBe('fail');
  });

  it('captures the baseline', () => {
    expect(
      gateBaseline(
        [
          { key: 'a', kind: 'node', state: 'healthy', reasons: [] },
          { key: 'b', kind: 'volume', state: 'at-risk', reasons: [] },
        ],
        [{ key: 's', state: 'exhausted' }],
      ),
    ).toEqual({ unhealthy: ['b:at-risk'], burning: ['s'] });
  });
});

describe('DRBD SPAAS fallback (3.26, online clusters only)', () => {
  it('allows SPAAS only when the snapshot came from upstream and bundles are not upload-only', () => {
    expect(drbdSpaasAllowed(undefined, 'plan')).toBe(true);
    expect(drbdSpaasAllowed({ source: 'github' }, 'plan')).toBe(true);
    expect(drbdSpaasAllowed({ source: 'mirror' }, 'plan')).toBe(true);
    // Air-gapped: upload-only bundles, or the bundle's snapshot because upstream was unreachable at plan time.
    expect(drbdSpaasAllowed({ source: 'upload' }, 'plan')).toBe(false);
    expect(drbdSpaasAllowed({ source: 'github' }, 'bundle')).toBe(false);
    expect(drbdSpaasAllowed(undefined, undefined)).toBe(false);
  });
});
