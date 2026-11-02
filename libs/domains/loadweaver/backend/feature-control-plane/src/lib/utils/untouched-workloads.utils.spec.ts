import type { ScheduleResult } from '@forepath/loadweaver/shared/util-scheduler';

import {
  holdUntouched,
  NOTHING_TOUCHED,
  stuckReplicas,
  touchedWorkloads,
  waitingIssues,
} from './untouched-workloads.utils';

/** Only touched workloads block a plan (user decision 2026-11-01). */
describe('untouched workloads', () => {
  describe('touchedWorkloads', () => {
    it('covers created / updated deployments and VMs, and re-pinned deployments', () => {
      const touched = touchedWorkloads(
        [
          { action: 'create', kind: 'Deployment', name: 'store', project: 'shop' },
          { action: 'update', kind: 'VirtualMachine', name: 'db', project: 'shop' },
          { action: 'unchanged', kind: 'Deployment', name: 'blog', project: 'shop' },
          { action: 'delete', kind: 'Deployment', name: 'old', project: 'shop' },
          { action: 'create', kind: 'Project', name: 'new', project: null },
          { action: 'update', kind: 'Node', name: 'n1', project: null },
        ],
        ['ops/api', 'shop/lw-vm', 'shop/lw-vm/cache'],
      );

      expect(touched('shop/store/web')).toBe(true);
      expect(touched('shop/lw-vm/db')).toBe(true);
      expect(touched('ops/api/app')).toBe(true);
      expect(touched('shop/blog/web')).toBe(false);
      expect(touched('shop/old/web')).toBe(false);
      // A project's VM state isn't a change of its other VMs.
      expect(touched('shop/lw-vm/cache')).toBe(false);
      expect(touched('test/test-nginx/web')).toBe(false);
    });

    it('touches nothing for a project-only plan', () => {
      const touched = touchedWorkloads([{ action: 'create', kind: 'Project', name: 'zz', project: null }]);

      expect(touched('test/test-nginx/web')).toBe(false);
    });
  });

  describe('holdUntouched', () => {
    const current = {
      replicas: [
        { service: 'test/test-nginx/web', replica: 'test/test-nginx/web/0', node: 'n1' },
        { service: 'test/test-nginx/web', replica: 'test/test-nginx/web/1', node: 'n2' },
        { service: 'shop/db/pg', replica: 'shop/db/pg/0', node: 'n1' },
      ],
      volumes: [{ volume: 'shop/db/data', primary: 'n1', syncReplicas: ['n2'], remoteReplicas: [] }],
    };
    const owners = new Map([['shop/db/data', 'shop/db/pg']]);
    const empty: ScheduleResult = { replicas: [], volumes: [], unschedulable: [], allocated: {} };

    it('keeps untouched replicas and volume holders where they are and reports them as waiting', () => {
      const { schedule, waiting } = holdUntouched(
        {
          ...empty,
          unschedulable: [
            { service: 'test/test-nginx/web', reason: 'no eligible node (no active node can run workloads)' },
            { service: 'shop/db/pg', replica: 'shop/db/pg/0', reason: 'no eligible node' },
          ],
        },
        current,
        NOTHING_TOUCHED,
        owners,
      );

      expect(schedule.unschedulable).toEqual([]);
      expect(schedule.replicas).toEqual(current.replicas);
      expect(schedule.volumes).toEqual(current.volumes);
      expect(waiting).toEqual([
        {
          service: 'test/test-nginx/web',
          reason: 'no eligible node (no active node can run workloads)',
          nodes: ['n1', 'n2'],
        },
        { service: 'shop/db/pg', replica: 'shop/db/pg/0', reason: 'no eligible node', nodes: ['n1'] },
      ]);
    });

    it('holds only the replica that failed, next to the placed ones', () => {
      const { schedule, waiting } = holdUntouched(
        {
          ...empty,
          replicas: [{ service: 'test/test-nginx/web', replica: 'test/test-nginx/web/0', node: 'n1' }],
          unschedulable: [
            { service: 'test/test-nginx/web', replica: 'test/test-nginx/web/1', reason: 'not enough free capacity' },
            // Never ran (e.g. autoscaled): nothing to keep.
            { service: 'test/test-nginx/web', replica: 'test/test-nginx/web/2', reason: 'not enough free capacity' },
          ],
        },
        current,
        NOTHING_TOUCHED,
        owners,
      );

      expect(schedule.replicas.map((r) => [r.replica, r.node])).toEqual([
        ['test/test-nginx/web/0', 'n1'],
        ['test/test-nginx/web/1', 'n2'],
      ]);
      expect(waiting.map((w) => [w.replica, w.nodes])).toEqual([
        ['test/test-nginx/web/1', ['n2']],
        ['test/test-nginx/web/2', []],
      ]);
    });

    it('keeps nothing on nodes outside the given set (left the cluster)', () => {
      const { schedule, waiting } = holdUntouched(
        { ...empty, unschedulable: [{ service: 'test/test-nginx/web', reason: 'no eligible node' }] },
        current,
        NOTHING_TOUCHED,
        owners,
        new Set(['n2']),
      );

      expect(schedule.replicas.map((r) => r.replica)).toEqual(['test/test-nginx/web/1']);
      expect(waiting[0].nodes).toEqual(['n2']);
    });

    it('leaves touched workloads unschedulable', () => {
      const result = { ...empty, unschedulable: [{ service: 'test/test-nginx/web', reason: 'no eligible node' }] };
      const { schedule, waiting } = holdUntouched(
        result,
        current,
        touchedWorkloads([{ action: 'update', kind: 'Deployment', name: 'test-nginx', project: 'test' }]),
        owners,
      );

      expect(schedule).toBe(result);
      expect(waiting).toEqual([]);
    });
  });

  it('notes waiting workloads as warnings on the failing path', () => {
    expect(
      waitingIssues([
        { service: 'test/test-nginx/web', reason: 'no eligible node', nodes: ['n1'] },
        { service: 'test/test-nginx/web', replica: 'test/test-nginx/web/2', reason: 'no capacity', nodes: [] },
      ]),
    ).toEqual([
      {
        level: 'warning',
        project: 'test',
        deployment: 'test-nginx',
        path: 'test/test-nginx/web',
        message: "waiting for a node (no eligible node); this plan doesn't change it, it keeps its placement on n1",
      },
      {
        level: 'warning',
        project: 'test',
        deployment: 'test-nginx',
        path: 'test/test-nginx/web/2',
        message: "waiting for a node (no capacity); this plan doesn't change it, it is placed once a node can run it",
      },
    ]);
  });

  it('names the real reason for extra replicas of a single-writer service', () => {
    expect(
      waitingIssues([
        {
          service: 'shop/db/pg',
          replica: 'shop/db/pg/1',
          reason: 'services with read-write volumes run a single replica',
          cause: 'single-writer',
          nodes: [],
        },
      ])[0].message,
    ).toBe(
      "services with read-write volumes run a single replica; this plan doesn't change it, the extra replica is not placed",
    );
  });

  it('finds the replicas a failover / drain must move but can not place', () => {
    const waiting = [
      { service: 'shop/web/b', reason: 'no eligible node', nodes: ['n1'] },
      { service: 'shop/web/c', replica: 'shop/web/c/1', reason: 'not enough free capacity', nodes: ['n1'] },
      { service: 'shop/db/pg', replica: 'shop/db/pg/1', reason: 'single', cause: 'single-writer' as const, nodes: [] },
    ];

    expect(
      stuckReplicas(waiting, new Set(['shop/web/a/0', 'shop/web/b/1', 'shop/web/b/0', 'shop/web/c/0', 'shop/web/c/1'])),
    ).toEqual([
      { replica: 'shop/web/b/0', reason: 'no eligible node' },
      { replica: 'shop/web/b/1', reason: 'no eligible node' },
      { replica: 'shop/web/c/1', reason: 'not enough free capacity' },
    ]);
  });
});
