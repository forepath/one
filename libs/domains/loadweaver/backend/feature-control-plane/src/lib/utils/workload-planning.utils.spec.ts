import { workloadSpecSchema } from '@forepath/loadweaver/shared/util-agent-protocol';
import { clusterNetworkSchema, projectSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { schedule } from '@forepath/loadweaver/shared/util-scheduler';

import {
  allocateServiceAddresses,
  allocateWorkloadAddresses,
  buildWorkloadSpec,
  diffPlacements,
  toSchedulerNodes,
  toSchedulerServices,
  translateDeployments,
} from './workload-planning.utils';

const COMPOSE = `
services:
  web:
    image: nginx:1.27
    x-loadweaver: { replicas: 2 }
  db:
    image: postgres:16
    volumes: [data:/var/lib/postgresql/data]
    secrets: [pw]
    deploy: { resources: { reservations: { cpus: '1', memory: 1g } } }
  nightly:
    image: alpine:3
    x-loadweaver: { cron: { schedule: '@daily' } }
volumes:
  data: { x-loadweaver: { size: 5g } }
secrets:
  pw: { external: true }
`;

const GiB = 1024 ** 3;
const projects = new Map([['shop', projectSpecSchema.parse({})]]);

describe('workload planning', () => {
  const { parsed, issues } = translateDeployments(
    [
      { project: 'shop', name: 'store', spec: { compose: COMPOSE } },
      { project: 'nope', name: 'x', spec: { compose: COMPOSE } },
    ],
    projects,
  );

  it('parses deployments with project defaults and rejects unknown projects', () => {
    expect(parsed).toHaveLength(1);
    expect(issues).toContainEqual(
      expect.objectContaining({ project: 'nope', level: 'error', message: 'project nope does not exist' }),
    );
    expect(parsed[0].compose.services.find((s) => s.name === 'web')?.resources.requests).toEqual({
      cpuMillis: 250,
      memoryBytes: 256 * 1024 ** 2,
    });
  });

  it('translates services for the scheduler (cron jobs are placed per run)', () => {
    const services = toSchedulerServices(parsed);

    expect(services.map((s) => s.id).sort()).toEqual(['shop/store/db', 'shop/store/web']);
    expect(services.find((s) => s.id === 'shop/store/db')?.volumes).toEqual([
      { id: 'shop/store/data', sizeBytes: 5 * GiB, replicas: 2, crossSite: 'async' },
    ]);
  });

  it('subtracts platform and control-plane reserves from node capacity', () => {
    const [worker, member] = toSchedulerNodes([
      {
        name: 'n1',
        site: 's',
        labels: {},
        lifecycle: 'active',
        witness: false,
        controlPlane: false,
        capacity: { cpuMillis: 4000, memoryBytes: 8 * GiB, diskBytes: 100 * GiB },
        runtimes: ['runc'],
        reachable: true,
      },
      {
        name: 'n2',
        site: 's',
        labels: {},
        lifecycle: 'active',
        witness: false,
        controlPlane: true,
        capacity: { cpuMillis: 4000, memoryBytes: 8 * GiB, diskBytes: 100 * GiB },
        runtimes: ['runc'],
        reachable: true,
      },
    ]);

    expect(worker.capacity).toEqual({ cpuMillis: 3750, memoryBytes: 7.5 * GiB });
    expect(member.capacity).toEqual({ cpuMillis: 2750, memoryBytes: 5 * GiB });
    expect(worker.labels['loadweaver.com/node']).toBe('n1');
  });

  it('describes moves with their migration method', () => {
    const changes = diffPlacements(
      [
        { service: 'p/d/web', replica: 'p/d/web/0', node: 'n1' },
        { service: 'p/d/db', replica: 'p/d/db/0', node: 'n1' },
        { service: 'p/d/old', replica: 'p/d/old/0', node: 'n1' },
      ],
      [
        { service: 'p/d/web', replica: 'p/d/web/0', node: 'n2' },
        { service: 'p/d/db', replica: 'p/d/db/0', node: 'n3' },
        { service: 'p/d/new', replica: 'p/d/new/0', node: 'n1' },
      ],
      new Set(['p/d/db']),
    );

    expect(changes).toEqual([
      { action: 'move', replica: 'p/d/db/0', from: 'n1', to: 'n3', method: 'short-stop' },
      { action: 'start', replica: 'p/d/new/0', to: 'n1' },
      { action: 'stop', replica: 'p/d/old/0', from: 'n1' },
      { action: 'move', replica: 'p/d/web/0', from: 'n1', to: 'n2', method: 'blue-green' },
    ]);
  });

  it('shows the chosen method with its reason per move (3.10)', () => {
    const changes = diffPlacements(
      [
        { service: 'p/d/web', replica: 'p/d/web/0', node: 'n1' },
        { service: 'p/d/db', replica: 'p/d/db/0', node: 'n1' },
      ],
      [
        { service: 'p/d/web', replica: 'p/d/web/0', node: 'n2' },
        { service: 'p/d/db', replica: 'p/d/db/0', node: 'n2' },
      ],
      new Set(['p/d/db']),
      new Map([
        ['p/d/web/0', { method: 'live' as const, runtime: 'runc' as const, label: 'live' }],
        [
          'p/d/db/0',
          { method: 'short-stop' as const, reason: 'privileged container', label: 'short-stop (privileged container)' },
        ],
      ]),
    );

    expect(changes).toEqual([
      {
        action: 'move',
        replica: 'p/d/db/0',
        from: 'n1',
        to: 'n2',
        method: 'short-stop',
        methodLabel: 'short-stop (privileged container)',
      },
      { action: 'move', replica: 'p/d/web/0', from: 'n1', to: 'n2', method: 'live', methodLabel: 'live' },
    ]);
  });

  it('keeps addresses on the same node and allocates fresh ones after a move', () => {
    const subnets = new Map([
      ['n1', ['10.88.0.0/24', 'fd00:88::/80']],
      ['n2', ['10.88.1.0/24']],
    ]);
    const result = allocateWorkloadAddresses(
      [
        { service: 's', replica: 'a', node: 'n1' },
        { service: 's', replica: 'b', node: 'n1' },
        { service: 's', replica: 'c', node: 'n2' },
      ],
      subnets,
      new Map([
        ['a', { node: 'n1', addresses: ['10.88.0.2', 'fd00:88::2'] }],
        ['c', { node: 'n1', addresses: ['10.88.0.3'] }],
      ]),
    );

    expect(result.get('a')).toEqual(['10.88.0.2', 'fd00:88::2']);
    expect(result.get('b')).toEqual(['10.88.0.3', 'fd00:88::3']);
    expect(result.get('c')).toEqual(['10.88.1.2']);
  });

  it('allocates stable service addresses per family', () => {
    const network = clusterNetworkSchema.parse({
      podPoolV4: '10.88.0.0/16',
      servicePoolV4: '10.92.0.0/24',
      servicePoolV6: 'fd00:92::/120',
    });
    const first = allocateServiceAddresses(['s1', 's2'], network, new Map());
    const again = allocateServiceAddresses(['s1', 's2', 's3'], network, first);

    expect(first.get('s1')).toEqual({ v4: '10.92.0.1', v6: 'fd00:92::1' });
    expect(again.get('s2')).toEqual(first.get('s2'));
    expect(again.get('s3')).toEqual({ v4: '10.92.0.3', v6: 'fd00:92::3' });
  });

  it('builds a valid, hashed workload spec with secret references and DNS search domains', () => {
    const db = parsed[0].compose.services.find((s) => s.name === 'db')!;
    const spec = buildWorkloadSpec(parsed[0], db, 0, ['10.88.0.5'], 'lw');

    expect(workloadSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec).toMatchObject({
      id: 'shop/store/db/0',
      dnsSearch: ['store.shop.lw', 'shop.lw'],
      volumes: [{ type: 'volume', volume: 'shop/store/data', target: '/var/lib/postgresql/data', readOnly: false }],
      secrets: [{ ref: 'secret://shop/pw', target: '/run/secrets/pw' }],
      labels: expect.objectContaining({ 'loadweaver.com/service': 'db', 'loadweaver.com/replica': '0' }),
    });
    expect(buildWorkloadSpec(parsed[0], db, 0, ['10.88.0.6'], 'lw').specHash).not.toBe(spec.specHash);
  });

  it('works end to end with the scheduler', () => {
    const nodes = toSchedulerNodes(
      ['n1', 'n2'].map((name) => ({
        name,
        site: 's',
        labels: {},
        lifecycle: 'active' as const,
        witness: false,
        controlPlane: false,
        capacity: { cpuMillis: 4000, memoryBytes: 8 * GiB, diskBytes: 100 * GiB },
        runtimes: ['runc'],
        reachable: true,
      })),
    );
    const result = schedule({ nodes, services: toSchedulerServices(parsed) });

    expect(result.unschedulable).toEqual([]);
    expect(
      result.replicas
        .filter((r) => r.service === 'shop/store/web')
        .map((r) => r.node)
        .sort(),
    ).toEqual(['n1', 'n2']);
  });
});
