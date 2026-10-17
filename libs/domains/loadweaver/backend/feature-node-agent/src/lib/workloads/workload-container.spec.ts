import { desiredState } from '../test-fixtures';
import { containerName, containerOptions, secretDir, volumeName, workloadState } from './workload-container';
import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

const spec: WorkloadSpec = {
  id: 'shop/store/db/0',
  project: 'shop',
  deployment: 'store',
  service: 'db',
  kind: 'service',
  image: 'postgres@sha256:' + 'a'.repeat(64),
  environment: { PGDATA: '/data' },
  labels: { 'loadweaver.com/service': 'db' },
  addresses: ['10.88.0.5', 'fd00:88::5'],
  dnsSearch: ['store.shop.lw', 'shop.lw'],
  runtime: 'sandboxed',
  resources: { cpuMillis: 500, memoryBytes: 1024 ** 3, memoryLimitBytes: 2 * 1024 ** 3, cpuLimitMillis: 2000 },
  healthcheck: { test: ['CMD', 'pg_isready'], intervalMs: 5000, timeoutMs: 1000, retries: 3, startPeriodMs: 0 },
  restart: 'always',
  stopGracePeriodMs: 30_000,
  init: false,
  readOnly: false,
  privileged: false,
  capAdd: [],
  capDrop: ['NET_RAW'],
  ulimits: { nofile: { soft: 1024, hard: 4096 } },
  extraHosts: [],
  volumes: [
    { type: 'volume', volume: 'shop/store/data', target: '/data', readOnly: false },
    { type: 'tmpfs', target: '/tmp', sizeBytes: 64 * 1024 ** 2 },
  ],
  secrets: [{ ref: 'secret://shop/pw', target: '/run/secrets/pw' }],
  specHash: 'b'.repeat(32),
};

describe('workload containers', () => {
  it('names containers and volumes deterministically', () => {
    expect(containerName('shop/store/db/0')).toMatch(/^lw-shop-store-db-0-[0-9a-f]{8}$/);
    expect(volumeName('shop/store/data')).toBe('lw-vol-shop.store.data');
    expect(secretDir('/run/loadweaver', 'a')).not.toBe(secretDir('/run/loadweaver', 'b'));
  });

  it('drops NET_RAW unless the workload asks for it', () => {
    expect(containerOptions({ ...spec, capDrop: [] }, { dnsServers: [], secretFiles: [] }).HostConfig?.CapDrop).toEqual(
      ['NET_RAW'],
    );
    expect(
      containerOptions({ ...spec, capAdd: ['NET_RAW'], capDrop: [] }, { dnsServers: [], secretFiles: [] }).HostConfig
        ?.CapDrop,
    ).toEqual([]);
  });

  it('translates a workload into Docker create options', () => {
    const opts = containerOptions(spec, {
      dnsServers: ['10.88.0.1'],
      secretFiles: [{ source: '/run/loadweaver/secrets/x/0', target: '/run/secrets/pw' }],
    });

    expect(opts.Labels).toMatchObject({
      'loadweaver.com/managed': 'true',
      'loadweaver.com/workload': 'shop/store/db/0',
      'loadweaver.com/spec-hash': 'b'.repeat(32),
    });
    expect(opts.HostConfig).toMatchObject({
      NetworkMode: 'loadweaver',
      Runtime: 'runsc-systrap',
      NanoCpus: 2_000_000_000,
      Memory: 2 * 1024 ** 3,
      MemoryReservation: 1024 ** 3,
      Dns: ['10.88.0.1'],
      DnsSearch: ['store.shop.lw', 'shop.lw'],
      CapDrop: ['NET_RAW'],
      Ulimits: [{ Name: 'nofile', Soft: 1024, Hard: 4096 }],
    });
    expect(opts.HostConfig?.Mounts).toEqual([
      expect.objectContaining({
        Type: 'volume',
        Source: 'lw-vol-shop.store.data',
        Target: '/data',
        VolumeOptions: expect.objectContaining({ DriverConfig: { Name: 'loadweaver', Options: {} } }),
      }),
      expect.objectContaining({
        Type: 'tmpfs',
        Target: '/tmp',
        TmpfsOptions: { SizeBytes: 64 * 1024 ** 2, Mode: 0o1777 },
      }),
      { Type: 'bind', Source: '/run/loadweaver/secrets/x/0', Target: '/run/secrets/pw', ReadOnly: true },
    ]);
    expect(opts.NetworkingConfig?.EndpointsConfig?.['loadweaver']).toEqual({
      IPAMConfig: { IPv4Address: '10.88.0.5', IPv6Address: 'fd00:88::5' },
      Aliases: ['db'],
    });
    expect(opts.Healthcheck).toEqual({
      Test: ['CMD', 'pg_isready'],
      Interval: 5e9,
      Timeout: 1e9,
      Retries: 3,
      StartPeriod: 0,
    });
    expect(opts.StopTimeout).toBe(30);
    expect(opts.Env).toEqual(['PGDATA=/data']);
  });

  it('maps container states', () => {
    expect(workloadState({ State: { Running: true, Health: { Status: 'healthy' } } } as never)).toEqual({
      state: 'healthy',
    });
    expect(workloadState({ State: { Running: false, Status: 'exited', ExitCode: 0 } } as never)).toEqual({
      state: 'exited',
      exitCode: 0,
    });
    expect(workloadState({ State: { Running: false, Status: 'exited', ExitCode: 137 } } as never)).toEqual({
      state: 'failed',
      exitCode: 137,
    });
  });

  it('is part of the desired state the agent validates', () => {
    expect(desiredState(1, { workloads: [spec] }).workloads).toHaveLength(1);
  });
});
