import { failoverCandidates, restrictSchedule } from './workload-controller.service';
import type { WorkloadPlan } from './workload-planner.service';

describe('failoverCandidates', () => {
  const placements = [
    { id: 'p/d/web/0', node: 'n2' },
    { id: 'p/d/db/0', node: 'n2' },
    { id: 'p/d/web/1', node: 'n1' },
  ];
  const stateful = new Set(['p/d/db']);

  it('moves stateless replicas of lost nodes right away', () => {
    expect(failoverCandidates(placements, new Set(['n2']), stateful, false, new Set())).toEqual({
      moving: new Set(['p/d/web/0']),
      waiting: ['p/d/db/0'],
    });
  });

  it('moves stateful replicas with quorum or an operator confirmation', () => {
    expect(failoverCandidates(placements, new Set(['n2']), stateful, true, new Set()).moving).toEqual(
      new Set(['p/d/web/0', 'p/d/db/0']),
    );
    expect(failoverCandidates(placements, new Set(['n2']), stateful, false, new Set(['n2'])).moving).toEqual(
      new Set(['p/d/web/0', 'p/d/db/0']),
    );
  });
});

describe('restrictSchedule', () => {
  const plan = {
    parsed: [
      {
        project: 'p',
        name: 'd',
        compose: {
          name: 'd',
          networks: [],
          secrets: [],
          configs: [],
          volumes: [{ name: 'data', external: false, sizeBytes: 1, replicas: 2, crossSite: 'async', pins: [] }],
          services: [
            {
              name: 'db',
              kind: 'service',
              replicas: 1,
              resources: { requests: { cpuMillis: 1, memoryBytes: 1 }, limits: {}, source: 'compose' },
              runtime: 'runc',
              spread: 'node',
              volumes: [{ type: 'volume', source: 'data', target: '/d', readOnly: false }],
            },
            {
              name: 'web',
              kind: 'service',
              replicas: 2,
              resources: { requests: { cpuMillis: 1, memoryBytes: 1 }, limits: {}, source: 'compose' },
              runtime: 'runc',
              spread: 'node',
              volumes: [],
            },
          ],
        },
      },
    ],
    schedule: {
      replicas: [
        { service: 'p/d/db', replica: 'p/d/db/0', node: 'n3' },
        { service: 'p/d/web', replica: 'p/d/web/0', node: 'n3' },
        { service: 'p/d/web', replica: 'p/d/web/1', node: 'n3' },
      ],
      volumes: [{ volume: 'p/d/data', primary: 'n3', syncReplicas: [], remoteReplicas: [] }],
      unschedulable: [],
      allocated: {},
    },
  } as unknown as WorkloadPlan;
  const current = {
    replicas: [
      { replica: 'p/d/db/0', node: 'n1' },
      { replica: 'p/d/web/0', node: 'n2' },
      { replica: 'p/d/web/1', node: 'n1' },
    ],
    volumes: [{ volume: 'p/d/data', primary: 'n1', syncReplicas: ['n2'], remoteReplicas: [] }],
  };

  it('only moves the given replicas and the volumes of moving services', () => {
    const restricted = restrictSchedule(plan, current, new Set(['p/d/web/0']));

    expect(restricted.schedule.replicas.map((r) => `${r.replica}@${r.node}`)).toEqual([
      'p/d/db/0@n1',
      'p/d/web/0@n3',
      'p/d/web/1@n1',
    ]);
    expect(restricted.schedule.volumes).toEqual([
      { volume: 'p/d/data', primary: 'n1', syncReplicas: ['n2'], remoteReplicas: [] },
    ]);

    expect(restrictSchedule(plan, current, new Set(['p/d/db/0'])).schedule.volumes[0].primary).toBe('n3');
  });
});
