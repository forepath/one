import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

import { microvmMac } from '../microvm/guest-network';
import { microvmRunDir, microvmVolumesDir } from './workload-container';
import { WorkloadDeferred, WorkloadManager, type VmDiskJobs } from './workload.manager';

describe('WorkloadManager drift report (3.8)', () => {
  it('lists containers Loadweaver does not manage, with their published ports', async () => {
    const docker = {
      listContainers: jest.fn(async () => [
        {
          Id: 'a'.repeat(64),
          Names: ['/legacy-web'],
          Image: 'nginx:1.27',
          State: 'running',
          Labels: {},
          Ports: [
            { IP: '0.0.0.0', PublicPort: 8088, PrivatePort: 80, Type: 'tcp' },
            { PrivatePort: 443, Type: 'tcp' },
          ],
        },
        {
          Id: 'b'.repeat(64),
          Names: ['/lw-shop-site-web-0'],
          Image: 'x',
          State: 'running',
          Labels: { 'loadweaver.com/managed': 'true' },
          Ports: [],
        },
      ]),
    };
    const manager = new WorkloadManager(docker as never, {} as never, {} as never);

    expect(await manager.foreign()).toEqual([
      {
        id: 'a'.repeat(64),
        name: 'legacy-web',
        image: 'nginx:1.27',
        state: 'running',
        ports: ['0.0.0.0:8088->80/tcp'],
      },
    ]);
    expect(docker.listContainers).toHaveBeenCalledWith({ all: true });
  });
});

describe('WorkloadManager microVM launchers (3.35)', () => {
  const launcher = 'ghcr.io/forepath/microvm-launcher@sha256:' + 'c'.repeat(64);
  const base = {
    project: 'shop',
    deployment: 'store',
    kind: 'service' as const,
    image: launcher,
    environment: {},
    labels: {},
    dnsSearch: [],
    runtime: 'runc' as const,
    isolation: 'microvm' as const,
    resources: { cpuMillis: 1000, memoryBytes: 1024 ** 3 },
    restart: 'always' as const,
    stopGracePeriodMs: 10_000,
    init: false,
    readOnly: false,
    privileged: false,
    capAdd: [],
    capDrop: [],
    ulimits: {},
    extraHosts: [],
    volumes: [],
    secrets: [],
    specHash: 'b'.repeat(32),
  };
  const layers = [
    {
      digest: 'sha256:' + 'd'.repeat(64),
      diffId: 'sha256:' + 'e'.repeat(64),
      size: 10,
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
    },
  ];
  const generic: WorkloadSpec = {
    ...base,
    id: 'shop/store/web/0',
    service: 'web',
    addresses: ['10.88.0.5'],
    microvm: {
      mode: 'generic',
      guestImage: 'ghcr.io/acme/web@sha256:' + 'a'.repeat(64),
      layers,
      vcpus: 1,
      memoryMiB: 512,
      rootfsBytes: 1024 ** 3,
    },
  };
  const vm: WorkloadSpec = {
    ...base,
    id: 'shop/lw-vm/db1/0',
    deployment: 'lw-vm',
    service: 'db1',
    addresses: ['10.88.0.10'],
    vm: {
      uid: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      firmware: 'uefi',
      cpuModel: 'host-model',
      vcpus: 2,
      memoryMiB: 2048,
      disks: [{ name: 'root', volume: 'shop/lw-vm/db1.root', bus: 'virtio', cache: 'none', boot: true }],
      nics: [
        { name: 'eth0', mac: '52:54:00:aa:bb:01', addresses: ['10.88.0.10'] },
        { name: 'eth1', mac: '52:54:00:aa:bb:02', addresses: ['10.70.0.4'] },
      ],
      image: { ref: 'registry.lw.internal/shop/debian', digest: 'sha256:' + 'f'.repeat(64), format: 'qcow2' },
      graphics: false,
      power: 'running',
    } as never,
  };

  let dir: string;
  const env = process.env['LOADWEAVER_RUNTIME_DIR'];
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- the module object itself is spied (CommonJS under jest)
  const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-wm-'));
    process.env['LOADWEAVER_RUNTIME_DIR'] = dir;
    // The stats dir belongs to the VMM user (uid 10930): only root can chown, the tests don't run as root.
    jest.spyOn(fsPromises, 'chown').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();

    if (env === undefined) delete process.env['LOADWEAVER_RUNTIME_DIR'];
    else process.env['LOADWEAVER_RUNTIME_DIR'] = env;

    await rm(dir, { recursive: true, force: true });
  });

  function setup(existing: unknown[] = [], vmDiskJobs?: VmDiskJobs, guestVolumes?: unknown) {
    const order: string[] = [];
    const container = {
      id: 'new-container',
      start: jest.fn(async () => order.push('start')),
    };
    const events = new PassThrough();
    const docker = {
      listContainers: jest.fn(async () => existing),
      listNetworks: jest.fn(async () => [{ Name: 'loadweaver', IPAM: { Config: [{ Subnet: '10.88.0.0/24' }] } }]),
      getNetwork: jest.fn((name: string) => ({
        inspect: async () => ({ Options: { 'com.docker.network.driver.mtu': '1420' } }),
        connect: jest.fn(async (opts: unknown) => order.push(`connect ${name} ${JSON.stringify(opts)}`)),
      })),
      getImage: jest.fn(() => ({ inspect: async () => ({}) })),
      createContainer: jest.fn(async () => {
        order.push('create');

        return container;
      }),
      getContainer: jest.fn(() => ({
        inspect: async () => ({ Config: { Labels: { 'loadweaver.com/microvm': 'generic' } } }),
        stop: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
        start: jest.fn(async () => order.push('start-existing')),
      })),
      getEvents: jest.fn(async () => events),
    };
    const scanner = { scan: jest.fn(async () => null), track: jest.fn() };
    const rootfs = {
      ensureLayers: jest.fn(async () => undefined),
      mountReplica: jest.fn(async () => '/run/loadweaver/vmroot/k/merged'),
      release: jest.fn(async () => undefined),
      setDesired: jest.fn(),
      gc: jest.fn(async () => []),
    };
    const guestNetwork = { attach: jest.fn(async () => order.push('attach')) };
    const kept = { ensureNetwork: jest.fn(async (_a: string[], slot: number) => `loadweaver-kept-4-nic${slot}`) };
    const vmBlockDevices = jest.fn(async () => ['/dev/drbd1000']);
    const vmLaunchFiles = jest.fn(async () => undefined);
    const isolation = { recordStartFailure: jest.fn(), recordStartSuccess: jest.fn() };
    const manager = new WorkloadManager(
      docker as never,
      {} as never,
      scanner as never,
      undefined,
      undefined,
      kept as never,
      rootfs as never,
      guestNetwork as never,
      vmBlockDevices,
      vmLaunchFiles,
      isolation as never,
      vmDiskJobs,
      guestVolumes as never,
    );

    return { manager, docker, rootfs, guestNetwork, kept, order, events, vmBlockDevices, vmLaunchFiles, isolation };
  }

  it('unpacks and mounts the guest root and writes the launcher run directory before the start', async () => {
    const { manager, docker, rootfs, guestNetwork, order } = setup();

    await manager.createReplica(generic);

    expect(rootfs.ensureLayers).toHaveBeenCalledWith(generic.microvm?.guestImage, layers, undefined);
    expect(rootfs.mountReplica).toHaveBeenCalledWith(generic.id, layers, 1024 ** 3);

    const runDir = microvmRunDir(dir, generic.id);

    expect(JSON.parse(await readFile(join(runDir, 'net.json'), 'utf8'))).toEqual({
      mac: microvmMac(generic.id),
      mtu: 1420,
      ipv4: '10.88.0.5',
    });
    expect(JSON.parse(await readFile(join(runDir, 'boot-process.json'), 'utf8'))).toMatchObject({ workingDir: '/' });
    expect((await stat(join(runDir, 'boot-process.json'))).mode & 0o777).toBe(0o600);
    expect(fsPromises.chown).toHaveBeenCalledWith(join(runDir, 'stats'), 10930, 10930);

    const options = (docker.createContainer.mock.calls[0] as unknown[])[0] as { HostConfig: { Mounts: unknown[] } };

    expect(options.HostConfig.Mounts[0]).toMatchObject({ Source: '/run/loadweaver/vmroot/k/merged', Target: '/guest' });
    expect(order).toEqual(['create', 'start', 'attach']);
    expect(guestNetwork.attach).toHaveBeenCalledWith('new-container', generic);
    // The guest image is what policies judge: pulled (and scanned) next to the launcher.
    expect(docker.getImage.mock.calls.map((c) => (c as unknown[])[0])).toContain(generic.microvm?.guestImage);
    manager.onModuleDestroy();
  });

  it('mounts the filesystem volumes of a generic microVM below the shared directory (M7 W10b)', async () => {
    const guestVolumes = {
      prepareDir: jest.fn(async () => undefined),
      attach: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
    };
    const withVolume: WorkloadSpec = {
      ...generic,
      volumes: [{ type: 'volume', volume: 'shop/store/data', target: '/var/lib/data', readOnly: false }],
    };
    const { manager, docker } = setup([], undefined, guestVolumes);
    const volume = { index: 0, volume: 'shop/store/data', target: '/var/lib/data', readOnly: false };
    const volumesDir = microvmVolumesDir(dir, generic.id);

    await manager.createReplica(withVolume);

    const runDir = microvmRunDir(dir, generic.id);

    expect(guestVolumes.prepareDir).toHaveBeenCalledWith(volumesDir, [volume]);
    expect(guestVolumes.attach).toHaveBeenCalledWith(volumesDir, volume);
    expect(await readFile(join(runDir, 'volumes.cmdline'), 'utf8')).toBe(
      `lw.vol=0:${Buffer.from('/var/lib/data').toString('hex')}:rw`,
    );

    const options = (docker.createContainer.mock.calls[0] as unknown[])[0] as { HostConfig: { Mounts: unknown[] } };

    expect(options.HostConfig.Mounts).toContainEqual(
      expect.objectContaining({ Source: volumesDir, Target: '/lwvol', BindOptions: { Propagation: 'rslave' } }),
    );
    expect(options.HostConfig.Mounts).not.toContainEqual(expect.objectContaining({ Type: 'volume' }));

    // A live migration's target: the directory is prepared, the volumes come with the hand-over.
    guestVolumes.attach.mockClear();
    manager.expectIncoming(generic.id);
    await manager.prepareMicrovm(withVolume, 'loadweaver');
    expect(guestVolumes.attach).not.toHaveBeenCalled();
    manager.incomingDone(generic.id);

    // Removed with the replica: the volumes are unmounted and demoted.
    await manager.removeContainer('new-container', generic.id);
    expect(guestVolumes.release).toHaveBeenCalledWith(volumesDir, [volume]);
    manager.onModuleDestroy();
  });

  it('connects further VM NICs on networks of their own before the start', async () => {
    const { manager, order, kept, vmBlockDevices, vmLaunchFiles, isolation } = setup();

    await manager.createReplica(vm);

    expect(isolation.recordStartSuccess).toHaveBeenCalledWith('microvm');

    expect(vmBlockDevices).toHaveBeenCalledWith(vm);
    expect(vmLaunchFiles).toHaveBeenCalledWith(vm, microvmRunDir(dir, vm.id), ['/dev/drbd1000']);
    expect(kept.ensureNetwork).toHaveBeenCalledWith(['10.70.0.4'], 1);
    expect(order).toEqual([
      'create',
      // The container side carries a link-local placeholder, the real address goes to the plugin (G5).
      'connect loadweaver-kept-4-nic1 {"Container":"new-container","EndpointConfig":{"IPAMConfig":{"IPv4Address":"169.254.2.1"},"DriverOpts":{"loadweaver.com/nic-addresses":"10.70.0.4"}}}',
      'start',
      'attach',
    ]);
    manager.onModuleDestroy();
  });

  it('runs bundled images whose launcher migrates in migration mode, with agent-mounted volumes (M7 F5)', async () => {
    const guestVolumes = {
      prepareDir: jest.fn(async () => undefined),
      attach: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
    };
    const bundled: WorkloadSpec = {
      ...generic,
      image: 'ghcr.io/forepath/agenstra-worker-microvm@sha256:' + 'f'.repeat(64),
      volumes: [{ type: 'volume', volume: 'shop/store/workspace', target: '/app', readOnly: false }],
      microvm: { mode: 'bundled', vcpus: 1, memoryMiB: 512, rootfsBytes: 1 },
    };
    const labels = {
      'io.agenstra.microvm.protocol': '1',
      'io.forepath.microvm.migration': 'generic,vm,bundled',
      'io.forepath.microvm.qemu-version': '1:10.0.13+ds-0+deb13u1',
      'io.forepath.microvm.virtiofsd-version': '1.13.2-1+deb13u1',
    };
    const { manager, docker, rootfs } = setup([], undefined, guestVolumes);
    const volume = { index: 0, volume: 'shop/store/workspace', target: '/app', readOnly: false };
    const volumesDir = microvmVolumesDir(dir, bundled.id);
    const runDir = microvmRunDir(dir, bundled.id);

    docker.getImage.mockImplementation((() => ({ inspect: async () => ({ Config: { Labels: labels } }) })) as never);
    await manager.createReplica(bundled);

    expect(rootfs.ensureLayers).not.toHaveBeenCalled();
    expect(guestVolumes.prepareDir).toHaveBeenCalledWith(volumesDir, [volume]);
    expect(guestVolumes.attach).toHaveBeenCalledWith(volumesDir, volume);
    expect((await stat(join(runDir, 'migration'))).isDirectory()).toBe(true);
    expect(JSON.parse(await readFile(join(runDir, 'volumes.json'), 'utf8'))).toEqual([volume]);

    const options = (docker.createContainer.mock.calls[0] as unknown[])[0] as {
      Env: string[];
      HostConfig: { Mounts: unknown[] };
    };

    expect(options.Env).toContain('AGENSTRA_MICROVM_MIGRATION=1');
    expect(options.HostConfig.Mounts).toContainEqual(
      expect.objectContaining({
        Source: `${volumesDir}/0`,
        Target: '/guest/app',
        BindOptions: { Propagation: 'rslave' },
      }),
    );

    // A migration target: the volumes come with the hand-over.
    guestVolumes.attach.mockClear();
    manager.expectIncoming(bundled.id);
    expect(await manager.prepareMicrovm(bundled, 'loadweaver', undefined, bundled.image)).toEqual({
      runDir,
      volumesDir,
      bundledMigration: true,
    });
    expect(guestVolumes.attach).not.toHaveBeenCalled();

    // An older bundled image (launcher label without `bundled`): as before, and never a migration target.
    docker.getImage.mockImplementation((() => ({
      inspect: async () => ({ Config: { Labels: { ...labels, 'io.forepath.microvm.migration': 'generic,vm' } } }),
    })) as never);
    await expect(manager.prepareMicrovm(bundled, 'loadweaver')).rejects.toThrow(/no incoming mode/);
    manager.incomingDone(bundled.id);
    expect(await manager.prepareMicrovm(bundled, 'loadweaver')).toEqual({});

    // Removed with the replica: its agent-mounted volumes are released (no guest root to release).
    docker.getContainer.mockImplementation((() => ({
      inspect: async () => ({ Config: { Labels: { 'loadweaver.com/microvm': 'bundled' } } }),
      stop: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    })) as never);
    await manager.removeContainer('new-container', bundled.id);
    expect(guestVolumes.release).toHaveBeenCalledWith(volumesDir, [volume]);
    expect(rootfs.release).not.toHaveBeenCalled();
    manager.onModuleDestroy();
  });

  it('refuses full VMs without the node VM support', async () => {
    const docker = {
      listNetworks: jest.fn(async () => []),
      getImage: jest.fn(() => ({ inspect: async () => ({}) })),
    };
    const manager = new WorkloadManager(docker as never, {} as never, { scan: jest.fn(async () => null) } as never);

    await expect(manager.prepareMicrovm(vm, 'loadweaver')).rejects.toThrow(/full VMs are not supported/);
    await expect(manager.prepareMicrovm(generic, 'loadweaver')).rejects.toThrow(/unpack cache/);
    expect(
      await manager.prepareMicrovm(
        { ...generic, microvm: { ...(generic.microvm as NonNullable<WorkloadSpec['microvm']>), mode: 'bundled' } },
        'x',
      ),
    ).toEqual({});
  });

  it('removes only the replicas that go away and cancels their disk jobs before the volumes step (G5)', async () => {
    const labels = (id: string) => ({
      'loadweaver.com/managed': 'true',
      'loadweaver.com/workload': id,
      'loadweaver.com/spec-hash': generic.specHash,
    });
    const jobs = { desired: jest.fn(), onSettled: jest.fn() };
    const { manager, docker } = setup(
      [
        { Id: 'kept', State: 'running', Labels: labels(generic.id) },
        { Id: 'gone', State: 'running', Labels: labels(vm.id) },
      ],
      jobs,
    );
    const removed: string[] = [];

    (docker.getContainer as jest.Mock).mockImplementation((id: string) => ({
      inspect: async () => ({ Config: { Labels: {} } }),
      stop: jest.fn(async () => undefined),
      remove: jest.fn(async () => void removed.push(id)),
      start: jest.fn(async () => undefined),
    }));

    expect(await manager.removeUndesired([generic])).toBe(true);
    expect(removed).toEqual(['gone']);
    expect(jobs.desired).toHaveBeenCalledWith([generic]);
    expect(docker.createContainer).not.toHaveBeenCalled();
    manager.onModuleDestroy();
  });

  it("treats Docker's 304 for a container its restart policy started meanwhile as started (G5)", async () => {
    const stopped = {
      Id: 'restarting-launcher',
      State: 'exited',
      Labels: {
        'loadweaver.com/managed': 'true',
        'loadweaver.com/workload': generic.id,
        'loadweaver.com/spec-hash': generic.specHash,
        'loadweaver.com/microvm': 'generic',
      },
    };
    const { manager, docker, guestNetwork } = setup([stopped]);
    const already = Object.assign(new Error('(HTTP code 304) container already started'), { statusCode: 304 });

    docker.getContainer.mockImplementation(() => ({
      inspect: async () => ({ Config: { Labels: stopped.Labels } }),
      stop: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
      start: jest.fn(async () => Promise.reject(already)),
    }));
    await expect(manager.apply([generic], [])).resolves.toBe(true);
    expect(guestNetwork.attach).toHaveBeenCalledWith('restarting-launcher', generic);

    // Any other start failure still fails the apply.
    docker.getContainer.mockImplementation(() => ({
      inspect: async () => ({ Config: { Labels: stopped.Labels } }),
      stop: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
      start: jest.fn(async () => Promise.reject(Object.assign(new Error('boom'), { statusCode: 500 }))),
    }));
    await expect(manager.apply([generic], [])).rejects.toThrow('boom');
    manager.onModuleDestroy();
  });

  it('reconnects the guest network on Docker start events and discards the guest root with the replica', async () => {
    const running = {
      Id: 'running-launcher',
      State: 'running',
      Labels: {
        'loadweaver.com/managed': 'true',
        'loadweaver.com/workload': generic.id,
        'loadweaver.com/spec-hash': generic.specHash,
        'loadweaver.com/microvm': 'generic',
      },
    };
    const { manager, guestNetwork, events, rootfs, docker } = setup([running]);

    await manager.apply([generic], []);

    // Running launcher: the (idempotent) attach covers starts the event stream missed.
    expect(guestNetwork.attach).toHaveBeenCalledWith('running-launcher', generic);
    expect(rootfs.setDesired).toHaveBeenCalledWith(layers);
    expect(docker.getEvents).toHaveBeenCalledWith({
      filters: { type: ['container'], event: ['start'] },
    });

    guestNetwork.attach.mockClear();
    events.write(
      `${JSON.stringify({ Actor: { ID: 'restarted', Attributes: { 'loadweaver.com/workload': generic.id } } })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(guestNetwork.attach).toHaveBeenCalledWith('restarted', generic);

    await mkdir(microvmRunDir(dir, generic.id), { recursive: true });
    await manager.apply([], []);
    expect(rootfs.release).toHaveBeenCalledWith(generic.id);
    await expect(stat(microvmRunDir(dir, generic.id))).rejects.toThrow();
    manager.onModuleDestroy();
  });

  it('defers a VM whose boot disk is being imported without holding up the other replicas (F3b)', async () => {
    let settled: (() => void) | undefined;
    const jobs = { desired: jest.fn(), onSettled: jest.fn((listener: () => void) => (settled = listener)) };
    const { manager, docker, vmBlockDevices, isolation } = setup([], jobs);

    vmBlockDevices.mockRejectedValueOnce(new WorkloadDeferred('shop/lw-vm/db1/0: writing the boot disk'));
    // The VM comes first: its deferral must not stop the generic microVM after it.
    expect(await manager.apply([vm, generic], [])).toBe(true);
    expect(jobs.desired).toHaveBeenCalledWith([vm, generic]);
    expect(docker.createContainer).toHaveBeenCalledTimes(1);
    expect(isolation.recordStartFailure).not.toHaveBeenCalled();

    // The import settled: the workloads are re-applied and the VM starts.
    settled?.();
    // The re-apply runs in the background: wait for it instead of a fixed delay (flaky under load).
    for (let i = 0; i < 200 && docker.createContainer.mock.calls.length < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(vmBlockDevices).toHaveBeenCalledTimes(2);
    expect(docker.createContainer).toHaveBeenCalledTimes(3);

    // Any other failure still fails the apply.
    vmBlockDevices.mockRejectedValueOnce(new Error('disk root has no replica on this node'));
    await expect(manager.apply([vm], [])).rejects.toThrow('no replica');
    manager.onModuleDestroy();
  });

  it('reports a microVM whose guest image cannot be prepared and applies the replicas after it (G5)', async () => {
    const { manager, docker } = setup();
    const other = process.arch === 'arm64' ? 'amd64' : 'arm64';
    const foreign = {
      ...generic,
      id: 'shop/store/arm/0',
      microvm: {
        ...(generic.microvm as NonNullable<WorkloadSpec['microvm']>),
        layers: undefined,
        platformLayers: { [other]: layers },
      },
    } as WorkloadSpec;
    const next = { ...generic, id: 'shop/store/web2/0' } as WorkloadSpec;

    // The unsupported image comes first: it must not stop the replica after it.
    expect(await manager.apply([foreign, next], [])).toBe(true);
    expect(docker.createContainer).toHaveBeenCalledTimes(1);
    expect((await manager.status()).workloads).toContainEqual(
      expect.objectContaining({
        id: foreign.id,
        state: 'failed',
        message: expect.stringMatching(/E_MICROVM_IMAGE_UNSUPPORTED: the guest image has no/),
      }),
    );

    // Gone from the desired state: its report goes too.
    await manager.apply([next], []);
    expect((await manager.status()).workloads.find((w) => w.id === foreign.id)).toBeUndefined();
    manager.onModuleDestroy();
  });

  it('counts start failures per isolation level (three in a row re-probe the level)', async () => {
    const { manager, docker, isolation } = setup();

    docker.createContainer.mockRejectedValueOnce(new Error('kvm: permission denied'));
    await expect(manager.createReplica(generic)).rejects.toThrow(/permission denied/);
    expect(isolation.recordStartFailure).toHaveBeenCalledWith('microvm');
    expect(isolation.recordStartSuccess).not.toHaveBeenCalled();
    manager.onModuleDestroy();
  });

  it("unpacks the node architecture's layers of a multi-arch guest image", async () => {
    const { manager, rootfs } = setup();
    const own = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const other = own === 'arm64' ? 'amd64' : 'arm64';
    const ownLayers = [{ ...layers[0], diffId: 'sha256:' + '1'.repeat(64) }];
    const multi = {
      ...generic,
      microvm: {
        ...(generic.microvm as NonNullable<WorkloadSpec['microvm']>),
        layers: undefined,
        platformLayers: { [own]: ownLayers, [other]: layers },
      },
    };

    await manager.createReplica(multi);
    expect(rootfs.ensureLayers).toHaveBeenCalledWith(multi.microvm.guestImage, ownLayers, undefined);
    await expect(
      manager.prepareMicrovm(
        { ...multi, microvm: { ...multi.microvm, platformLayers: { [other]: layers } } },
        'loadweaver',
      ),
    ).rejects.toThrow(/E_MICROVM_IMAGE_UNSUPPORTED/);
    manager.onModuleDestroy();
  });
});
