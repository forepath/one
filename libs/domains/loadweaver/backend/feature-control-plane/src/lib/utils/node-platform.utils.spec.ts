import type { DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';

import { layerState, nodePlatformComponents, patroniRole, type PlatformReportFacts } from './node-platform.utils';

type Desired = Parameters<typeof nodePlatformComponents>[0];

const controlPlane = (extra: Partial<DesiredState['controlPlane']> = {}): DesiredState['controlPlane'] => ({
  role: 'member',
  members: [
    { name: 'n1', address: '10.0.0.1', witness: false },
    { name: 'n2', address: '10.0.0.2', witness: false },
    { name: 'w1', address: '10.0.0.3', witness: true },
  ],
  automaticFailover: true,
  scope: 'cluster-1',
  environment: { LOADWEAVER_DB_PASSWORD: 'do-not-leak' },
  logStore: { clusterName: 'lw-logs', heapMb: 512, httpPort: 9200, transportPort: 9300 },
  ...extra,
});

const applied: PlatformReportFacts = {
  connected: true,
  lastReportSteps: [
    { layer: 'control-plane', status: 'unchanged' },
    { layer: 'object-store', status: 'applied' },
    { layer: 'registry', status: 'failed', message: 'mirror docker.io: pull-through cache unreachable' },
  ],
};

describe('node platform components (console node page, 2026-10-30)', () => {
  it('lists a member: etcd, Postgres with its Patroni role, queue, API replica, log store', () => {
    const rows = nodePlatformComponents({ controlPlane: controlPlane() } as Desired, applied, 'leader');

    expect(rows.map((r) => [r.id, r.role, r.state])).toEqual([
      ['etcd', 'member', 'running'],
      ['postgres', 'leader', 'running'],
      ['queue', undefined, 'running'],
      ['control-plane-api', 'replica', 'running'],
      ['log-store', 'member', 'running'],
    ]);
    expect(rows.find((r) => r.id === 'postgres')?.detail).toBe('scope cluster-1 · 2 members');
    expect(rows.find((r) => r.id === 'etcd')?.detail).toBe('3 members');
  });

  it('never returns secrets of the desired state', () => {
    const rows = nodePlatformComponents({ controlPlane: controlPlane() } as Desired, applied);

    expect(JSON.stringify(rows)).not.toContain('do-not-leak');
  });

  it('marks the API replica pending while the database handover is outstanding', () => {
    const rows = nodePlatformComponents({ controlPlane: controlPlane({ database: 'pending' }) } as Desired, applied);
    const api = rows.find((r) => r.id === 'control-plane-api');

    expect(api).toMatchObject({ role: 'pending', state: 'unknown', detail: 'waits for the database handover' });
    expect(rows.find((r) => r.id === 'postgres')?.role).toBe('member');
  });

  it('runs only etcd on a witness and nothing for role none', () => {
    expect(
      nodePlatformComponents(
        { controlPlane: controlPlane({ role: 'witness', logStore: undefined }) } as Desired,
        applied,
      ),
    ).toEqual([{ id: 'etcd', component: 'etcd', label: 'etcd', role: 'witness', state: 'running' }]);
    expect(nodePlatformComponents({ controlPlane: controlPlane({ role: 'none' }) } as Desired, applied)).toEqual([]);
  });

  it('lists object-store generations, registry with mirrors and the failed layer error', () => {
    const rows = nodePlatformComponents(
      {
        controlPlane: controlPlane({ role: 'none' }),
        objectStore: {
          generations: [
            { generation: 2, replicationFactor: 3, ports: { s3: 3900, rpc: 3901, admin: 3903 }, zone: 'fra1' },
            { generation: 1, replicationFactor: 1, ports: { s3: 3910, rpc: 3911, admin: 3913 }, zone: 'fra1' },
          ],
        },
        registry: { generation: 2, readOnly: true, mirrors: [{ host: 'docker.io' }] },
      } as unknown as Desired,
      applied,
    );

    expect(rows.map((r) => r.id)).toEqual([
      'object-store:1',
      'object-store:2',
      'registry',
      'registry-mirror:docker.io',
    ]);
    expect(rows[1]).toMatchObject({ state: 'running', detail: 'generation 2 · replication 3 · zone fra1' });
    expect(rows[2]).toMatchObject({ state: 'failed', detail: 'mirror docker.io: pull-through cache unreachable' });
  });

  it('lists edge roles: ingress, DNS, VPN gateway (active / standby), BGP, rate limiter, backup servers', () => {
    const rows = nodePlatformComponents(
      {
        controlPlane: controlPlane({ role: 'none' }),
        ingress: { addresses: ['203.0.113.1'], sites: [{}, {}] },
        authoritativeDns: { zones: [{}] },
        network: { remoteAccess: { active: false, peers: [{}, {}, {}] } },
        externalBgp: { asn: 64512, peers: [{}] },
        rateLimiter: { config: '', port: 8081 },
        backupServer: { repositories: [{}] },
      } as unknown as Desired,
      { connected: true, lastReportSteps: [] },
    );

    expect(rows.map((r) => [r.component, r.role, r.detail, r.state])).toEqual([
      ['ingress', undefined, '2 sites · 1 address', 'unknown'],
      ['dns', undefined, '1 zone', 'unknown'],
      ['vpn-gateway', 'standby', '3 clients', 'unknown'],
      ['bgp', undefined, 'AS64512 · 1 peer', 'unknown'],
      ['rate-limiter', undefined, undefined, 'unknown'],
      ['backup-server', undefined, '1 repository', 'unknown'],
    ]);
  });

  it('has no components without a desired state', () => {
    expect(nodePlatformComponents(null, applied)).toEqual([]);
  });

  it('derives a layer state from the last report (disconnected / missing / skipped = unknown)', () => {
    expect(layerState(applied, 'control-plane')).toEqual({ state: 'running' });
    expect(layerState(applied, 'registry').state).toBe('failed');
    expect(layerState(applied, 'ingress')).toEqual({ state: 'unknown' });
    expect(layerState({ ...applied, connected: false }, 'control-plane')).toEqual({ state: 'unknown' });
    expect(layerState({ connected: true, lastReportSteps: null }, 'control-plane')).toEqual({ state: 'unknown' });
    expect(
      layerState({ connected: true, lastReportSteps: [{ layer: 'backups', status: 'skipped' }] }, 'backups'),
    ).toEqual({ state: 'unknown' });
    expect(
      layerState(
        { connected: true, lastReportSteps: [{ layer: 'x', status: 'failed', message: 'e'.repeat(500) }] },
        'x',
      ).error?.length,
    ).toBe(240);
  });

  it('maps Patroni roles', () => {
    expect(patroniRole({ role: 'primary' })).toBe('leader');
    expect(patroniRole({ role: 'master' })).toBe('leader');
    expect(patroniRole({ role: 'replica' })).toBe('replica');
    expect(patroniRole({ role: 'uninitialized' })).toBeNull();
    expect(patroniRole(null)).toBeNull();
  });
});
