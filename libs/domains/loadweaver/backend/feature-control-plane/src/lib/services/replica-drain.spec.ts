import { randomBytes } from 'node:crypto';

import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import { clusterNetworkSchema, projectSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { FindOperator } from 'typeorm';

import { defaultClusterNetwork } from '../utils/network-allocation.utils';
import {
  DEFAULT_DRAIN_MS,
  drainDeadline,
  drainDelayMs,
  drainFinished,
  MAX_DRAIN_MS,
  MIN_DRAIN_MS,
  removalAction,
} from '../utils/replica-drain.utils';
import { translateDeployments } from '../utils/workload-planning.utils';
import { effectiveSpec, nodeWorkloads, workloadCompilerInput, type WorkloadContext } from './network-state.service';
import { ReplicaDrainService } from './replica-drain.service';
import { stopGraceOf, WorkloadPlannerService, type WorkloadPlan } from './workload-planner.service';

/**
 * Two-phase removal (M6 gate): scale-down and plan-removed replicas first leave routing while they keep running,
 * then stop after their service's grace period. The deadline is stored on the placement (`drain_until`).
 */
const compose = (image: string, grace = '30s') => `
services:
  web:
    image: ${image}
    stop_grace_period: ${grace}
    ports: ['8080']
    x-loadweaver: { replicas: 3 }
`;
const projects = new Map([['shop', projectSpecSchema.parse({})]]);
const parse = (image = 'nginx:1.27', grace?: string) =>
  translateDeployments([{ project: 'shop', name: 'store', spec: { compose: compose(image, grace) } }], projects).parsed;
const network = clusterNetworkSchema.parse(defaultClusterNetwork((n) => randomBytes(n)));

describe('drain timing', () => {
  it("uses the service's stop grace period, bounded", () => {
    expect(drainDelayMs(undefined)).toBe(DEFAULT_DRAIN_MS);
    expect(drainDelayMs(30_000)).toBe(30_000);
    expect(drainDelayMs(0)).toBe(MIN_DRAIN_MS);
    expect(drainDelayMs(3_600_000)).toBe(MAX_DRAIN_MS);
    expect(stopGraceOf(parse(), { project: 'shop', deployment: 'store', service: 'web', releasedSpec: null })).toBe(
      30_000,
    );
    // The service is gone: the spec the replica last ran.
    expect(
      stopGraceOf([], {
        project: 'shop',
        deployment: 'store',
        service: 'web',
        releasedSpec: { stopGracePeriodMs: 5_000 } as never,
      }),
    ).toBe(5_000);
  });

  it('never prolongs a running drain and knows when it ended', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    const first = drainDeadline({ drainUntil: null }, 30_000, now);

    expect(first.toISOString()).toBe('2026-10-20T10:00:30.000Z');
    expect(drainDeadline({ drainUntil: first }, 30_000, new Date(now.getTime() + 20_000))).toEqual(first);
    expect(drainFinished({ drainUntil: first }, new Date(now.getTime() + 29_999))).toBe(false);
    expect(drainFinished({ drainUntil: first }, new Date(now.getTime() + 30_000))).toBe(true);
    expect(drainFinished({ drainUntil: null }, now)).toBe(false);
  });

  it('deletes at once what cannot drain: node gone, or already stopped by a short-stop migration', () => {
    const live = new Set(['n1']);

    expect(removalAction({ node: 'n1' }, live)).toBe('drain');
    expect(removalAction({ node: 'gone' }, live)).toBe('delete');
    expect(removalAction({ node: 'n1', migration: { method: 'short-stop', phase: 'stopping' } }, live)).toBe('delete');
    expect(removalAction({ node: 'n1', migration: { method: 'blue-green', phase: 'starting' } }, live)).toBe('drain');
  });
});

describe('rendering a draining replica', () => {
  const placement = (index: number, extra: Partial<WorkloadContext['placements'][number]> = {}) => ({
    id: `shop/store/web/${index}`,
    node: 'n1',
    addresses: [`10.42.1.${10 + index}`],
    ...extra,
  });

  function context(parsed = parse(), drainingExtra: Partial<WorkloadContext['placements'][number]> = {}) {
    const base: WorkloadContext = {
      parsed: parse(),
      placements: [placement(0), placement(1), placement(2)],
      services: [{ id: 'shop/store/web', addressV4: '10.43.0.10', addressV6: null }],
    };
    // What replica 2 last ran (recorded by the compile as `releasedSpec`).
    const released = effectiveSpec(placement(2), placement(2).addresses, base, 'lw') as WorkloadSpec;

    return {
      released,
      ctx: {
        ...base,
        parsed,
        placements: [
          placement(0),
          placement(1),
          placement(2, {
            drainUntil: new Date(Date.now() + 30_000),
            releasedSpec: released as never,
            ...drainingExtra,
          }),
        ],
      } as WorkloadContext,
    };
  }

  it('keeps it in the node workloads, out of routing (compiler input marks it draining)', () => {
    const { ctx, released } = context();
    const workloads = nodeWorkloads('n1', ctx, 'lw');

    expect(workloads.map((w) => w.id)).toEqual(['shop/store/web/0', 'shop/store/web/1', 'shop/store/web/2']);
    expect(workloads[2]).toEqual(released);

    const input = workloadCompilerInput(ctx);

    expect(input.workloads.find((w) => w.id === 'shop/store/web/2')?.draining).toBe(true);
    expect(input.workloads.filter((w) => w.draining)).toHaveLength(1);
  });

  it('runs what it ran even when its service changed or is gone (no restart while draining)', () => {
    const changed = context(parse('nginx:1.28'));
    const gone = context([]);

    expect(nodeWorkloads('n1', changed.ctx, 'lw')[2]).toEqual(changed.released);
    expect(nodeWorkloads('n1', changed.ctx, 'lw')[0].image).toContain('nginx:1.28');
    expect(nodeWorkloads('n1', gone.ctx, 'lw').map((w) => w.id)).toEqual(['shop/store/web/2']);
  });

  it('stops it once the placement is gone (drain ended) or when nothing was released for it', () => {
    const { ctx } = context();
    const after = { ...ctx, placements: ctx.placements.slice(0, 2) };

    expect(nodeWorkloads('n1', after, 'lw').map((w) => w.id)).toEqual(['shop/store/web/0', 'shop/store/web/1']);
    expect(nodeWorkloads('n1', context(parse(), { releasedSpec: null }).ctx, 'lw')).toHaveLength(2);
  });
});

/** In-memory repositories keyed by entity, with the FindOperators the planner uses. */
function fakeManager(seed: { nodes: Record<string, unknown>[]; placements: Record<string, unknown>[] }) {
  const tables = new Map<string, Map<string, Record<string, unknown>>>([
    ['NodeEntity', new Map(seed.nodes.map((n) => [n['name'] as string, n]))],
    ['WorkloadPlacementEntity', new Map(seed.placements.map((p) => [p['id'] as string, { ...p }]))],
    ['ServiceAddressEntity', new Map()],
    ['VolumePlacementEntity', new Map()],
  ]);
  const matches = (row: Record<string, unknown>, where?: Record<string, unknown>): boolean =>
    !where ||
    Object.entries(where).every(([k, v]) => {
      if (v instanceof FindOperator) {
        const op = v as FindOperator<unknown>;

        if (op.type === 'isNull') return row[k] === null || row[k] === undefined;

        if (op.type === 'not')
          return op.value instanceof FindOperator ? !matches(row, { [k]: op.value }) : row[k] !== op.value;

        if (op.type === 'lessThanOrEqual') return row[k] != null && (row[k] as Date) <= (op.value as Date);

        throw new Error(`operator ${op.type}`);
      }

      return row[k] === v;
    });
  const repo = (entity: { name: string }) => {
    const table = tables.get(entity.name) ?? new Map();
    const key = (row: Record<string, unknown>) => (row['id'] ?? row['name']) as string;

    return {
      find: async (opts?: { where?: Record<string, unknown> }) =>
        [...table.values()].filter((r) => matches(r, opts?.where)).map((r) => ({ ...r })),
      findOne: async (opts: { where: Record<string, unknown> }) =>
        [...table.values()].find((r) => matches(r, opts.where)) ?? null,
      create: (v: Record<string, unknown>) => ({ ...v }),
      save: async (v: Record<string, unknown>) => {
        const merged = {
          ...(table.get(key(v)) ?? {}),
          ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)),
        };

        table.set(key(v), merged);

        return merged;
      },
      update: async (where: Record<string, unknown>, values: Record<string, unknown>) => {
        for (const row of table.values()) if (matches(row, where)) Object.assign(row, values);
      },
      delete: async (where: Record<string, unknown>) => {
        for (const [k, row] of [...table.entries()]) if (matches(row, where)) table.delete(k);
      },
    };
  };

  return {
    tables,
    placements: () => tables.get('WorkloadPlacementEntity') as Map<string, Record<string, unknown>>,
    manager: { query: async () => [{ locked: true }], getRepository: repo },
  };
}

describe('planner: removed replicas drain (state machine)', () => {
  const nodes = [
    { name: 'n1', lifecycle: 'active', podSubnetV4: '10.42.1.0/24', podSubnetV6: null },
    { name: 'n2', lifecycle: 'active', podSubnetV4: '10.42.2.0/24', podSubnetV6: null },
  ];
  const placed = (index: number, node = 'n1', extra: Record<string, unknown> = {}) => ({
    id: `shop/store/web/${index}`,
    project: 'shop',
    deployment: 'store',
    service: 'web',
    node,
    addresses: [`10.42.${node === 'n1' ? 1 : 2}.${10 + index}`],
    targetNode: null,
    targetAddresses: [],
    migration: null,
    restored: null,
    gate: null,
    releasedSpec: null,
    cronRun: null,
    drainUntil: null,
    specHash: null,
    status: null,
    ...extra,
  });
  const plan = (replicas: { index: number; node: string }[]): WorkloadPlan =>
    ({
      parsed: parse(),
      issues: [],
      schedule: {
        replicas: replicas.map((r) => ({
          service: 'shop/store/web',
          replica: `shop/store/web/${r.index}`,
          node: r.node,
        })),
        volumes: [],
        unschedulable: [],
        allocated: {},
      },
      analysis: { findings: [], nPlusOne: true },
      changes: [],
      statefulServices: new Set(),
      choices: new Map(),
      autoscaled: [],
    }) as WorkloadPlan;
  const planner = new WorkloadPlannerService();

  it('scale-down 3 → 2: the removed replica drains for its grace period instead of being deleted', async () => {
    const { manager, placements } = fakeManager({ nodes, placements: [placed(0), placed(1), placed(2)] });
    const before = Date.now();

    await planner.persist(
      manager as never,
      plan([
        { index: 0, node: 'n1' },
        { index: 1, node: 'n1' },
      ]),
      network,
    );

    const draining = placements().get('shop/store/web/2');

    expect(placements().size).toBe(3);
    expect(draining?.['drainUntil']).toBeInstanceOf(Date);
    expect((draining?.['drainUntil'] as Date).getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect((draining?.['drainUntil'] as Date).getTime()).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(placements().get('shop/store/web/0')?.['drainUntil']).toBeNull();
    // Plans no longer see it.
    expect((await planner.current(manager as never)).replicas.map((r) => r.replica)).toEqual([
      'shop/store/web/0',
      'shop/store/web/1',
    ]);

    // Planning again doesn't prolong the drain.
    const deadline = draining?.['drainUntil'];

    await planner.persist(
      manager as never,
      plan([
        { index: 0, node: 'n1' },
        { index: 1, node: 'n1' },
      ]),
      network,
    );
    expect(placements().get('shop/store/web/2')?.['drainUntil']).toEqual(deadline);
  });

  it('scale back up on the same node ends the drain; on another node the drain is cut short and it starts anew', async () => {
    const drainUntil = new Date(Date.now() + 20_000);
    const same = fakeManager({ nodes, placements: [placed(0), placed(1), placed(2, 'n1', { drainUntil })] });

    await planner.persist(same.manager as never, plan([0, 1, 2].map((index) => ({ index, node: 'n1' }))), network);
    expect(same.placements().get('shop/store/web/2')).toMatchObject({
      node: 'n1',
      drainUntil: null,
      addresses: ['10.42.1.12'],
    });

    const moved = fakeManager({ nodes, placements: [placed(0), placed(1), placed(2, 'n1', { drainUntil })] });

    await planner.persist(
      moved.manager as never,
      plan([
        { index: 0, node: 'n1' },
        { index: 1, node: 'n1' },
        { index: 2, node: 'n2' },
      ]),
      network,
    );
    expect(moved.placements().get('shop/store/web/2')).toMatchObject({ node: 'n2', drainUntil: null, migration: null });
  });

  it('deletes replicas of a node that left at once (nothing to drain there)', async () => {
    const { manager, placements } = fakeManager({
      nodes: [nodes[0]],
      placements: [placed(0), placed(1, 'n2')],
    });

    await planner.persist(manager as never, plan([{ index: 0, node: 'n1' }]), network, 'failover');
    expect([...placements().keys()]).toEqual(['shop/store/web/0']);
  });
});

describe('ReplicaDrainService (second phase)', () => {
  function setup(locked = true) {
    const now = new Date('2026-10-20T10:00:00Z');
    const { manager, placements } = fakeManager({
      nodes: [],
      placements: [
        { id: 'shop/store/web/1', cronRun: null, drainUntil: new Date(now.getTime() + 5_000) },
        { id: 'shop/store/web/2', cronRun: null, drainUntil: new Date(now.getTime() - 1) },
        { id: 'shop/store/web/0', cronRun: null, drainUntil: null },
      ],
    });
    const lockedManager = { ...manager, query: async () => [{ locked }] };
    const dataSource = {
      transaction: async (fn: (m: typeof lockedManager) => Promise<unknown>) => await fn(lockedManager),
    };
    const network = { requestRecompile: jest.fn() };

    return { now, placements, network, service: new ReplicaDrainService(dataSource as never, network as never) };
  }

  it('deletes placements whose drain ended and recompiles, so the agent stops them', async () => {
    const { now, placements, network, service } = setup();

    expect(await service.tick(now)).toEqual(['shop/store/web/2']);
    expect([...placements().keys()].sort()).toEqual(['shop/store/web/0', 'shop/store/web/1']);
    expect(network.requestRecompile).toHaveBeenCalledWith('replicas drained');

    expect(await service.tick(new Date(now.getTime() + 5_000))).toEqual(['shop/store/web/1']);
    expect([...placements().keys()]).toEqual(['shop/store/web/0']);
  });

  it('leaves everything to the replica holding the lock', async () => {
    const { now, placements, network, service } = setup(false);

    expect(await service.tick(now)).toEqual([]);
    expect(placements().size).toBe(3);
    expect(network.requestRecompile).not.toHaveBeenCalled();
  });
});
