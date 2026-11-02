import { schedule } from '@forepath/loadweaver/shared/util-scheduler';

import type { NodeEntity } from '../entities/node.entity';
import { heldVolumeIssues, plannerNodes } from '../services/workload-planner.service';
import { JOINING_WINDOW_MS, nodeNotReady, type ReadinessFacts } from './node-readiness.utils';
import { samePlacements, toSchedulerNodes, volumeCopyChanges, volumeHoldersChanged } from './workload-planning.utils';

/** Volume plans while a node is joining (M6 gate). */
describe('node readiness for new volume copies', () => {
  const now = Date.parse('2026-10-20T10:00:00Z');
  const facts = (extra: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
    joinedAt: new Date(now - 60_000),
    connected: true,
    appliedRevision: 12,
    lastReportSteps: null,
    controlPlane: false,
    ...extra,
  });

  it('counts a recently joined node as ready once it applied its current desired state', () => {
    expect(nodeNotReady(facts(), 12, now)).toBeNull();
    expect(nodeNotReady(facts({ appliedRevision: 13 }), 12, now)).toBeNull();
  });

  it('holds a joining node: not connected, nothing compiled, or behind its desired state', () => {
    expect(nodeNotReady(facts({ connected: false }), 12, now)).toBe('joining: agent not connected yet');
    expect(nodeNotReady(facts(), undefined, now)).toBe('joining: no desired state compiled yet');
    expect(nodeNotReady(facts({ appliedRevision: 0 }), 12, now)).toBe(
      'joining: still applying its desired state (applied revision 0 of 12)',
    );
    // A new control-plane member pulling / starting etcd, Postgres and the API (the DR drill case).
    expect(nodeNotReady(facts({ appliedRevision: 10, controlPlane: true }), 12, now)).toBe(
      'joining: control-plane member still initialising (applied revision 10 of 12)',
    );
    expect(
      nodeNotReady(
        facts({ controlPlane: true, lastReportSteps: [{ layer: 'control-plane', status: 'failed' }] }),
        12,
        now,
      ),
    ).toBe('joining: control-plane role failed to apply');
  });

  it('never holds a node that joined long ago (no permanent hold on a stuck or lagging node)', () => {
    const old = facts({ joinedAt: new Date(now - JOINING_WINDOW_MS - 1), connected: false, appliedRevision: 0 });

    expect(nodeNotReady(old, 12, now)).toBeNull();
    expect(nodeNotReady(facts({ joinedAt: null }), undefined, now)).toBeNull();
  });

  it('feeds the scheduler and the plan: the volume gets no copy on the joining member, with a note', () => {
    const GiB = 1024 ** 3;
    const node = (name: string, extra: Partial<NodeEntity> = {}) =>
      ({
        name,
        site: 'lab',
        labels: {},
        lifecycle: 'active',
        witness: false,
        controlPlane: true,
        capacity: { cpuMillis: 8000, memoryBytes: 16 * GiB, diskBytes: 100 * GiB },
        capabilities: { runtimes: ['runc'], drbd9: true },
        lastSeenAt: new Date(now - 1000),
        joinedAt: new Date(now - 3_600_000),
        connected: true,
        appliedRevision: 20,
        lastReportSteps: null,
        ...extra,
      }) as unknown as NodeEntity;
    const nodes = [node('n1'), node('n2', { joinedAt: new Date(now - 120_000), appliedRevision: 18 })];
    const revisions = new Map([
      ['n1', 20],
      ['n2', 20],
    ]);
    const planned = plannerNodes(nodes, now, revisions);

    expect(planned.map((n) => n.notReady)).toEqual([
      undefined,
      'joining: control-plane member still initialising (applied revision 18 of 20)',
    ]);
    // Without revisions (autoscaler, capacity checks) nobody is held.
    expect(plannerNodes(nodes, now).some((n) => n.notReady)).toBe(false);

    const result = schedule({
      nodes: toSchedulerNodes(planned),
      services: [
        {
          id: 'shop/store/db',
          project: 'shop',
          replicas: 1,
          requests: { cpuMillis: 500, memoryBytes: GiB },
          runtime: 'runc',
          spread: 'node',
          volumes: [{ id: 'shop/store/data', sizeBytes: GiB, replicas: 2, crossSite: 'none' }],
        },
      ],
    });

    expect(result.volumes[0]).toMatchObject({ primary: 'n1', syncReplicas: [] });
    expect(heldVolumeIssues(result.held)).toEqual([
      {
        level: 'warning',
        project: 'shop',
        deployment: 'store',
        path: 'volumes.data',
        message:
          'volume data gets no copy on n2 (joining: control-plane member still initialising (applied revision 18 of 20)) while it is joining; plan again once the node is ready to add the copy',
      },
    ]);
    expect(heldVolumeIssues(undefined)).toEqual([]);
  });
});

describe('samePlacements (DR replan persists only on change)', () => {
  const current = {
    replicas: [
      { service: 's/d/a', replica: 's/d/a/0', node: 'n1' },
      { service: 's/d/b', replica: 's/d/b/0', node: 'n2' },
    ],
    volumes: [{ volume: 's/d/v', primary: 'n1', syncReplicas: ['n2', 'n3'], remoteReplicas: [] }],
  };

  it('ignores order, sees moved replicas and changed volume holders', () => {
    expect(
      samePlacements(current, {
        replicas: [...current.replicas].reverse(),
        volumes: [{ volume: 's/d/v', primary: 'n1', syncReplicas: ['n3', 'n2'], remoteReplicas: [] }],
      }),
    ).toBe(true);
    expect(
      samePlacements(current, {
        replicas: [current.replicas[0], { ...current.replicas[1], node: 'n3' }],
        volumes: current.volumes,
      }),
    ).toBe(false);
    expect(
      samePlacements(current, {
        replicas: current.replicas,
        volumes: [{ volume: 's/d/v', primary: 'n1', syncReplicas: ['n2'], remoteReplicas: [] }],
      }),
    ).toBe(false);
    expect(samePlacements(current, { replicas: current.replicas.slice(0, 1), volumes: current.volumes })).toBe(false);
  });
});

describe('volumeHoldersChanged (the next plan adds copies held back while a node was joining)', () => {
  const placed = [{ volume: 's/d/v', primary: 'n1', syncReplicas: [] as string[], remoteReplicas: [] as string[] }];

  it('sees an added copy, ignores holder order and replicas', () => {
    expect(volumeHoldersChanged(placed, [{ ...placed[0], syncReplicas: ['n2'] }])).toBe(true);
    expect(
      volumeHoldersChanged(
        placed,
        placed.map((v) => ({ ...v })),
      ),
    ).toBe(false);
    expect(
      volumeHoldersChanged(
        [{ ...placed[0], syncReplicas: ['n2', 'n3'] }],
        [{ ...placed[0], syncReplicas: ['n3', 'n2'] }],
      ),
    ).toBe(false);
  });
});

describe('volumeCopyChanges (the plan preview lists the copies a re-plan adds)', () => {
  const placed = [
    { volume: 's/d/v', primary: 'n1', syncReplicas: [] as string[], remoteReplicas: [] as string[] },
    { volume: 's/d/w', primary: 'n1', syncReplicas: ['n2'], remoteReplicas: [] as string[] },
  ];

  it('lists added holders of existing volumes as "copy added on <node>"', () => {
    expect(
      volumeCopyChanges(placed, [
        { ...placed[0], syncReplicas: ['n2'], remoteReplicas: ['m1'] },
        { ...placed[1], syncReplicas: ['n2'] },
      ]),
    ).toEqual([
      { action: 'copy', volume: 's/d/v', to: 'm1', copy: 'remote' },
      { action: 'copy', volume: 's/d/v', to: 'n2', copy: 'sync' },
    ]);
  });

  it('ignores new volumes, unchanged and dropped holders', () => {
    expect(
      volumeCopyChanges(placed, [
        placed[0],
        { ...placed[1], syncReplicas: [] },
        { volume: 's/d/new', primary: 'n3', syncReplicas: ['n4'], remoteReplicas: [] },
      ]),
    ).toEqual([]);
  });

  it('counts a primary moved to a node without a copy as an added copy', () => {
    expect(volumeCopyChanges([placed[0]], [{ ...placed[0], primary: 'n3' }])).toEqual([
      { action: 'copy', volume: 's/d/v', to: 'n3', copy: 'sync' },
    ]);
  });
});
