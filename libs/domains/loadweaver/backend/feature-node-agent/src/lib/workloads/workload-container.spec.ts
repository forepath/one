import { desiredState } from '../test-fixtures';
import {
  bootProcess,
  containerName,
  containerOptions,
  guestVolumeList,
  guestVolumesCmdline,
  launcherKindOf,
  microvmKind,
  microvmRunDir,
  microvmVolumesDir,
  secretDir,
  volumeName,
  workloadDockerRuntime,
  workloadState,
} from './workload-container';
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

  it('runs every workload at its exact isolation level (3.1: never up- or downgraded)', () => {
    expect(workloadDockerRuntime({ runtime: 'runc' })).toBe('runc');
    expect(workloadDockerRuntime({ runtime: 'sandboxed' })).toBe('runsc-systrap');
    expect(workloadDockerRuntime({ runtime: 'sandboxed', isolation: 'sandboxed-kvm' })).toBe('runsc-kvm');
    // microVMs: the launcher runs on runc (QEMU needs the host's KVM, never gVisor).
    expect(workloadDockerRuntime({ runtime: 'runc', isolation: 'microvm' })).toBe('runc');
  });

  it('passes allow-listed host devices through (3.1)', () => {
    const opts = containerOptions(
      { ...spec, runtime: 'runc', devices: [{ path: '/dev/kvm', permissions: 'rw' }] },
      { dnsServers: [], secretFiles: [] },
    );

    expect(opts.HostConfig?.Devices).toEqual([
      { PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm', CgroupPermissions: 'rw' },
    ]);
    expect(containerOptions(spec, { dnsServers: [], secretFiles: [] }).HostConfig?.Devices).toBeUndefined();
  });

  describe('microVM launchers (3.35)', () => {
    const microvm = {
      ...spec,
      id: 'shop/store/web/0',
      service: 'web',
      runtime: 'runc' as const,
      isolation: 'microvm' as const,
      image: 'ghcr.io/forepath/microvm-launcher@sha256:' + 'c'.repeat(64),
      user: 'postgres',
      stopSignal: 'SIGINT',
      microvm: {
        mode: 'generic' as const,
        guestImage: 'postgres@sha256:' + 'a'.repeat(64),
        layers: [
          {
            digest: 'sha256:' + 'd'.repeat(64),
            diffId: 'sha256:' + 'e'.repeat(64),
            size: 10,
            mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          },
        ],
        process: {
          entrypoint: ['docker-entrypoint.sh'],
          cmd: ['postgres'],
          env: ['PGDATA=/data'],
          user: 'postgres',
          workingDir: '/',
          stopSignal: 'SIGINT',
        },
        vcpus: 2,
        memoryMiB: 1024,
        rootfsBytes: 10 * 1024 ** 3,
      },
    };
    const host = {
      runDir: '/run/loadweaver/vm/k',
      merged: '/run/loadweaver/vmroot/k/merged',
      volumesDir: '/run/loadweaver/vmvol/k',
    };

    it('knows how a workload runs in the launcher', () => {
      expect(microvmKind(spec)).toBeNull();
      expect(microvmKind(microvm)).toBe('generic');
      expect(microvmKind({ ...microvm, microvm: { ...microvm.microvm, mode: 'bundled' } })).toBe('bundled');
      expect(microvmKind({ ...microvm, vm: {} as never })).toBe('vm');
      expect(() => microvmKind({ ...microvm, microvm: undefined })).toThrow(/microvm or vm settings/);
      expect(microvmRunDir('/run/loadweaver', 'a')).toMatch(/^\/run\/loadweaver\/vm\/[0-9a-f]{24}$/);
      expect(bootProcess(microvm)).toEqual(microvm.microvm.process);
      expect(bootProcess({ ...microvm, microvm: { ...microvm.microvm, process: undefined } })).toEqual({
        entrypoint: [],
        cmd: [],
        env: ['PGDATA=/data'],
        user: 'postgres',
        workingDir: '/',
        stopSignal: 'SIGINT',
      });
    });

    it('lists filesystem volumes for the guest binds (parents first) and encodes them for the kernel', () => {
      const volumes = guestVolumeList({
        volumes: [
          { type: 'volume', volume: 'p/d/b', target: '/data/sub', readOnly: true },
          { type: 'tmpfs', target: '/tmp' },
          { type: 'volume', volume: 'p/d/a', target: '/data', readOnly: false },
        ] as never,
      });

      expect(volumes).toEqual([
        { index: 0, volume: 'p/d/a', target: '/data', readOnly: false },
        { index: 1, volume: 'p/d/b', target: '/data/sub', readOnly: true },
      ]);
      expect(guestVolumesCmdline(volumes)).toBe('lw.vol=0:2f64617461:rw lw.vol=1:2f646174612f737562:ro');
      expect(microvmVolumesDir('/run/loadweaver', 'a')).toMatch(/^\/run\/loadweaver\/vmvol\/[0-9a-f]{24}$/);
    });

    it('runs a generic microVM in the hardened launcher with the guest root at /guest', () => {
      const opts = containerOptions(microvm, {
        dnsServers: ['10.88.0.1'],
        secretFiles: [{ source: '/run/loadweaver/secrets/x/0', target: '/run/secrets/pw' }],
        microvm: host,
      });

      expect(opts.Entrypoint).toEqual(['/usr/bin/tini', '--', '/usr/lib/agenstra-microvm/launch-generic']);
      expect(opts.Cmd).toEqual([]);
      expect(opts.User).toBeUndefined();
      expect(opts.Env).toEqual([
        'AGENSTRA_MICROVM_MEMORY_MB=1024',
        'AGENSTRA_MICROVM_VCPUS=2',
        'AGENSTRA_MICROVM_STOP_GRACE=30',
        'AGENSTRA_MICROVM_FORWARD_PORTS=',
        'LW_MODE=generic',
      ]);
      expect(opts.Labels).toMatchObject({ 'loadweaver.com/microvm': 'generic', 'loadweaver.com/workload': microvm.id });
      expect(opts.StopSignal).toBe('SIGTERM');
      expect(opts.StopTimeout).toBe(40);
      expect(opts.HostConfig).toMatchObject({
        Runtime: 'runc',
        Init: false,
        Privileged: false,
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=16m' },
        ShmSize: 64 * 1024 ** 2,
        CapDrop: ['ALL'],
        CapAdd: [
          'CHOWN',
          'DAC_OVERRIDE',
          'FOWNER',
          'FSETID',
          'SETUID',
          'SETGID',
          'MKNOD',
          'KILL',
          'SETPCAP',
          'SYS_CHROOT',
        ],
        SecurityOpt: ['no-new-privileges'],
        Devices: [
          { PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm', CgroupPermissions: 'rwm' },
          { PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun', CgroupPermissions: 'rwm' },
        ],
        PidsLimit: 1024,
        Memory: (1024 + 384) * 1024 ** 2,
        NanoCpus: 2_250_000_000,
        Dns: ['10.88.0.1'],
      });
      expect(opts.HostConfig?.Ulimits).toBeUndefined();
      expect(opts.HostConfig?.Mounts).toEqual([
        {
          Type: 'bind',
          Source: host.merged,
          Target: '/guest',
          ReadOnly: false,
          BindOptions: { Propagation: 'rprivate' },
        },
        // Filesystem volumes: the agent's shared directory (rslave: mounts arriving later show up), not below /guest.
        {
          Type: 'bind',
          Source: host.volumesDir,
          Target: '/lwvol',
          ReadOnly: false,
          BindOptions: { Propagation: 'rslave' },
        },
        { Type: 'bind', Source: host.runDir, Target: '/run/loadweaver/vm', ReadOnly: true },
        { Type: 'bind', Source: `${host.runDir}/stats`, Target: '/run/loadweaver/vm/stats', ReadOnly: false },
        // Live migration (M7 W10b): incoming marker and relay socket.
        { Type: 'bind', Source: `${host.runDir}/migration`, Target: '/run/loadweaver/vm/migration', ReadOnly: false },
        expect.objectContaining({ Type: 'tmpfs', Target: '/guest/tmp' }),
        { Type: 'bind', Source: '/run/loadweaver/secrets/x/0', Target: '/guest/run/secrets/pw', ReadOnly: true },
      ]);
      // The container keeps the workload's address on its endpoint; the guest takes it over through the tap.
      expect(opts.NetworkingConfig?.EndpointsConfig?.['loadweaver']?.IPAMConfig).toEqual({
        IPv4Address: '10.88.0.5',
        IPv6Address: 'fd00:88::5',
      });
      expect(() => containerOptions(microvm, { dnsServers: [], secretFiles: [] })).toThrow(/run directory/);
      expect(() =>
        containerOptions(microvm, { dnsServers: [], secretFiles: [], microvm: { runDir: host.runDir } }),
      ).toThrow(/guest root/);
      expect(() =>
        containerOptions(microvm, {
          dnsServers: [],
          secretFiles: [],
          microvm: { runDir: host.runDir, merged: host.merged },
        }),
      ).toThrow(/volume directory/);
    });

    it('runs Agenstra-labelled images as they are (bundled mode)', () => {
      const bundled = {
        ...microvm,
        image: 'ghcr.io/forepath/agenstra-worker-microvm@sha256:' + 'f'.repeat(64),
        microvm: { mode: 'bundled' as const, vcpus: 1, memoryMiB: 512, rootfsBytes: 1 },
      };
      const opts = containerOptions(bundled, { dnsServers: [], secretFiles: [] });

      expect(opts.Entrypoint).toBeUndefined();
      expect(opts.Env).toEqual([
        'PGDATA=/data',
        'AGENSTRA_MICROVM_MEMORY_MB=512',
        'AGENSTRA_MICROVM_VCPUS=1',
        'AGENSTRA_MICROVM_STOP_GRACE=30',
      ]);
      expect(opts.Labels?.['loadweaver.com/microvm']).toBe('bundled');
      expect(opts.HostConfig?.ReadonlyRootfs).toBe(false);
      expect(opts.HostConfig?.Devices).toEqual([
        { PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm', CgroupPermissions: 'rwm' },
      ]);
      expect(opts.HostConfig?.Mounts?.[0]).toMatchObject({ Target: '/guest/data' });
    });

    it('runs bundled images whose launcher migrates in migration mode, volumes from the agent (M7 F5)', () => {
      const bundled = {
        ...microvm,
        image: 'ghcr.io/forepath/agenstra-worker-microvm@sha256:' + 'f'.repeat(64),
        volumes: [
          { type: 'volume' as const, volume: 'shop/store/workspace', target: '/app', readOnly: false },
          { type: 'volume' as const, volume: 'shop/store/data', target: '/data', readOnly: true },
          { type: 'tmpfs' as const, target: '/run/cache', sizeBytes: 1024 * 1024 },
        ],
        microvm: { mode: 'bundled' as const, vcpus: 1, memoryMiB: 512, rootfsBytes: 1 },
      };
      const runDir = microvmRunDir('/run/loadweaver', bundled.id);
      const volumesDir = microvmVolumesDir('/run/loadweaver', bundled.id);
      const opts = containerOptions(bundled, {
        dnsServers: [],
        secretFiles: [{ source: '/run/loadweaver/secrets/x/pw', target: '/run/secrets/pw' }],
        microvm: { runDir, volumesDir, bundledMigration: true },
      });
      const mounts = opts.HostConfig?.Mounts ?? [];

      // The image's own launcher (entrypoint kept), told to start migratable.
      expect(opts.Entrypoint).toBeUndefined();
      expect(opts.Env).toContain('AGENSTRA_MICROVM_MIGRATION=1');
      // Only the migration directory of the run directory (relay socket, incoming marker).
      expect(mounts).toContainEqual({
        Type: 'bind',
        Source: `${runDir}/migration`,
        Target: '/run/loadweaver/vm/migration',
        ReadOnly: false,
      });
      expect(mounts.some((m) => m.Target === '/run/loadweaver/vm')).toBe(false);
      // Filesystem volumes: each directory of the agent's volume directory at its target, rslave; no Docker volumes.
      expect(mounts).toContainEqual({
        Type: 'bind',
        Source: `${volumesDir}/0`,
        Target: '/guest/app',
        ReadOnly: false,
        BindOptions: { Propagation: 'rslave' },
      });
      expect(mounts).toContainEqual({
        Type: 'bind',
        Source: `${volumesDir}/1`,
        Target: '/guest/data',
        ReadOnly: true,
        BindOptions: { Propagation: 'rslave' },
      });
      expect(mounts.some((m) => m.Type === 'volume')).toBe(false);
      // tmpfs and secrets below /guest as before.
      expect(mounts).toContainEqual(expect.objectContaining({ Type: 'tmpfs', Target: '/guest/run/cache' }));
      expect(mounts).toContainEqual(expect.objectContaining({ Target: '/guest/run/secrets/pw', ReadOnly: true }));
      expect(opts.HostConfig?.Devices).toHaveLength(1);

      // Without the volume directory / run directory it refuses; older images (no flag) run exactly as before.
      expect(() =>
        containerOptions(bundled, { dnsServers: [], secretFiles: [], microvm: { runDir, bundledMigration: true } }),
      ).toThrow(/volume directory/);
      expect(() =>
        containerOptions(bundled, { dnsServers: [], secretFiles: [], microvm: { bundledMigration: true } }),
      ).toThrow(/run directory/);

      const plain = containerOptions(bundled, { dnsServers: [], secretFiles: [] });

      expect(plain.Env).not.toContain('AGENSTRA_MICROVM_MIGRATION=1');
      expect(plain.HostConfig?.Mounts).toContainEqual(
        expect.objectContaining({ Type: 'volume', Target: '/guest/app' }),
      );
    });

    it('starts full VMs with launch-vm and their block devices (rw, no mknod)', () => {
      const vmSpec = {
        ...microvm,
        microvm: undefined,
        vm: { vcpus: 4, memoryMiB: 4096 } as never,
      };
      const opts = containerOptions(vmSpec, {
        dnsServers: [],
        secretFiles: [],
        microvm: { runDir: host.runDir, blockDevices: ['/dev/drbd1000'] },
      });

      expect(opts.Entrypoint).toEqual(['/usr/bin/tini', '--', '/usr/lib/agenstra-microvm/launch-vm']);
      // Full VMs: consoles only in live sessions (no vm-exec), routed by the VM label.
      expect(opts.Labels?.['loadweaver.com/vm']).toBe('web');
      expect(opts.Labels?.['loadweaver.com/microvm']).toBeUndefined();
      expect(launcherKindOf(opts.Labels)).toBe('vm');
      expect(launcherKindOf({ 'loadweaver.com/microvm': 'generic' })).toBe('generic');
      expect(launcherKindOf({ 'loadweaver.com/microvm': 'other' })).toBeNull();
      expect(opts.Env).toEqual(['AGENSTRA_MICROVM_STOP_GRACE=30', 'LW_MODE=vm']);
      expect(opts.HostConfig?.Memory).toBe((4096 + 384) * 1024 ** 2);
      expect(opts.HostConfig?.Devices).toContainEqual({
        PathOnHost: '/dev/drbd1000',
        PathInContainer: '/dev/drbd1000',
        CgroupPermissions: 'rw',
      });
      // QEMU live migration (M7.4): the incoming marker and the relay socket in a writable subdirectory.
      expect(opts.HostConfig?.Mounts?.map((m) => [m.Target, m.ReadOnly])).toEqual([
        ['/run/loadweaver/vm', true],
        ['/run/loadweaver/vm/stats', false],
        ['/run/loadweaver/vm/migration', false],
      ]);
    });
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
