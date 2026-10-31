import type { SchedulerNode, SchedulerService } from '@forepath/loadweaver/shared/util-scheduler';

import { cronRunOutcome, pickCronNode } from './cron-planning.utils';

const node = (name: string, extra: Partial<SchedulerNode> = {}): SchedulerNode => ({
  name,
  site: 'fra1',
  labels: {},
  lifecycle: 'active',
  witness: false,
  capacity: { cpuMillis: 4000, memoryBytes: 8 * 1024 ** 3 },
  diskBytes: 100 * 1024 ** 3,
  runtimes: ['runc'],
  reachable: true,
  ...extra,
});

const service = (extra: Partial<SchedulerService> = {}): SchedulerService => ({
  id: 'shop/web/report',
  project: 'shop',
  replicas: 1,
  requests: { cpuMillis: 100, memoryBytes: 64 * 1024 ** 2 },
  runtime: 'runc',
  spread: 'node',
  volumes: [],
  ...extra,
});

describe('pickCronNode', () => {
  it('prefers the least loaded eligible node, stable by name', () => {
    const nodes = [node('n1'), node('n2'), node('n3', { lifecycle: 'draining' }), node('n4', { reachable: false })];

    expect(
      pickCronNode(
        service(),
        nodes,
        new Map([
          ['n1', 3],
          ['n2', 1],
        ]),
        new Map(),
      ),
    ).toEqual({ node: 'n2' });
    expect(pickCronNode(service(), nodes, new Map(), new Map())).toEqual({ node: 'n1' });
  });

  it('runs next to the primary of its volumes', () => {
    const volumes = [{ id: 'shop/web/data', sizeBytes: 1, replicas: 2, crossSite: 'async' as const }];

    expect(
      pickCronNode(
        service({ volumes }),
        [node('n1'), node('n2')],
        new Map([['n2', 9]]),
        new Map([['shop/web/data', 'n2']]),
      ),
    ).toEqual({ node: 'n2' });
    expect(pickCronNode(service({ volumes }), [node('n1')], new Map(), new Map())).toEqual({
      error: expect.stringContaining('no placement'),
    });
    expect(pickCronNode(service({ volumes }), [node('n1')], new Map(), new Map([['shop/web/data', 'n2']]))).toEqual({
      error: 'no eligible node can run the job',
    });
  });
});

describe('cronRunOutcome', () => {
  const startedAt = new Date('2026-07-01T00:00:00Z');
  const base = { startedAt, node: 'n1', timeoutSeconds: 60, nodeReachable: true };
  const now = startedAt.getTime() + 10_000;

  it('maps the agent status of the run', () => {
    expect(
      cronRunOutcome({ ...base, status: { state: 'exited', exitCode: 0, at: '2026-07-01T00:00:05Z' } }, now),
    ).toEqual({ state: 'succeeded', exitCode: 0 });
    expect(
      cronRunOutcome({ ...base, status: { state: 'failed', exitCode: 2, at: '2026-07-01T00:00:05Z' } }, now),
    ).toEqual({ state: 'failed', exitCode: 2 });
    expect(cronRunOutcome({ ...base, status: { state: 'running', at: '2026-07-01T00:00:05Z' } }, now)).toBeNull();
  });

  it('takes reports from a node with a skewed clock', () => {
    expect(
      cronRunOutcome({ ...base, status: { state: 'exited', exitCode: 0, at: '2026-06-30T23:59:00Z' } }, now),
    ).toEqual({ state: 'succeeded', exitCode: 0 });
  });

  it('times out and notices lost nodes', () => {
    expect(cronRunOutcome(base, startedAt.getTime() + 61_000)?.state).toBe('timed-out');
    expect(cronRunOutcome({ ...base, nodeReachable: false }, now)?.state).toBe('node-lost');
  });
});
