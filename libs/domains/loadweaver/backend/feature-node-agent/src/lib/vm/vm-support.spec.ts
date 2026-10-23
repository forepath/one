import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import {
  decodeAgentMessage,
  type AgentEvent,
  type Envelope,
  type VolumeAssignment,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { MigrationSessions } from '../migration/migration-sessions';
import { WorkloadDeferred } from '../workloads/workload.manager';
import type { VmImportOptions } from './vm-image-import';
import { vmLaunchConfig, VmSupport } from './vm-support.service';

const UID = '7f1c5d2e-3a4b-5c6d-8e9f-0a1b2c3d4e5f';
const LAYER = `sha256:${'c'.repeat(64)}`;

const spec = {
  id: 'shop/lw-vm/db1/0',
  specHash: 'h1',
  image: 'ghcr.io/forepath/microvm-launcher:1.0.0',
  addresses: ['10.42.0.7', 'fd42::7'],
  isolation: 'microvm',
  vm: {
    uid: UID,
    firmware: 'uefi',
    cpuModel: 'host-model',
    vcpus: 2,
    memoryMiB: 4096,
    disks: [
      { name: 'root', volume: 'shop/lw-vm/db1.root', bus: 'virtio', cache: 'none', boot: true },
      { name: 'data', volume: 'shop/lw-vm/db1.data', bus: 'virtio', cache: 'writeback', boot: false },
    ],
    nics: [
      { name: 'eth0', mac: '52:54:00:aa:bb:cc', addresses: ['10.42.0.7', 'fd42::7'] },
      { name: 'eth1', mac: '52:54:00:dd:ee:ff', addresses: ['10.43.0.9'] },
    ],
    image: {
      ref: `registry.lw.internal/shop/debian@sha256:${'1'.repeat(64)}`,
      digest: `sha256:${'1'.repeat(64)}`,
      format: 'qcow2',
      layerDigest: LAYER,
    },
    cloudInit: { metaData: '{"instance-id":"x-1"}', secretRefs: [] },
    graphics: true,
    power: 'running',
  },
} as unknown as WorkloadSpec;

const block = (id: string, minor: number): VolumeAssignment => ({
  id,
  dockerName: `lw-vol-${id.replace(/\//g, '.')}`,
  minor,
  port: 7800 + minor,
  sizeBytes: 1024 ** 3,
  replicas: [{ node: 'n1', nodeId: 0, address: '10.93.0.1' }],
  connections: [],
  primary: 'n1',
  keyRef: 'secret://shop/lw-volume-x',
  mode: 'block',
  ...(id.endsWith('.root') ? { initializeFrom: { digest: LAYER, format: 'qcow2' as const } } : {}),
});

describe('VM support (M7.3)', () => {
  it('renders vm.json with the disks in order and one tap per NIC', () => {
    expect(vmLaunchConfig(spec, ['/dev/drbd1003', '/dev/drbd1004'])).toEqual({
      uid: UID,
      firmware: 'uefi',
      cpuModel: 'host-model',
      vcpus: 2,
      memoryMiB: 4096,
      graphics: true,
      guestAgent: true,
      disks: [
        { name: 'root', device: '/dev/drbd1003', cache: 'none', boot: true },
        { name: 'data', device: '/dev/drbd1004', cache: 'writeback', boot: false },
      ],
      nics: [
        { name: 'eth0', mac: '52:54:00:aa:bb:cc', tap: 'lwtap0' },
        { name: 'eth1', mac: '52:54:00:dd:ee:ff', tap: 'lwtap1' },
      ],
    });
    expect(() => vmLaunchConfig(spec, ['/dev/drbd1003'])).toThrow('1 block devices for 2 disks');
    // The launcher's own validation applies.
    expect(() => vmLaunchConfig(spec, ['/dev/sda', '/dev/drbd1004'])).toThrow('invalid device of disk root');
  });

  function setup(
    options: {
      volumes?: VolumeAssignment[];
      running?: { Id: string; Labels: Record<string, string> }[];
      sessions?: MigrationSessions;
    } = {},
  ) {
    const assignments = new Map(
      (options.volumes ?? [block('shop/lw-vm/db1.root', 1003), block('shop/lw-vm/db1.data', 1004)]).map((v) => [
        v.id,
        v,
      ]),
    );
    const calls: string[] = [];
    const events = new PassThrough();
    const docker = {
      listContainers: jest.fn(async (opts: { all?: boolean; filters: { label: string[] } }) => {
        if (opts.all) return [];

        return options.running ?? [];
      }),
      getNetwork: jest.fn(() => ({
        inspect: async () => ({
          IPAM: {
            Config: [
              { Subnet: '10.42.0.0/24', Gateway: '10.42.0.1' },
              { Subnet: 'fd42::/64', Gateway: 'fd42::1' },
            ],
          },
          Options: { 'com.docker.network.driver.mtu': '1420' },
        }),
      })),
      getEvents: jest.fn(async () => events),
    };
    const volumes = {
      assignment: jest.fn((id: string) => assignments.get(id)),
      blockAssignments: jest.fn(() => [...assignments.values()].filter((v) => v.mode === 'block')),
      promoteBlock: jest.fn(async (id: string) => {
        calls.push(`promote ${id}`);

        return { device: `/dev/drbd${assignments.get(id)?.minor}`, fresh: false };
      }),
      demoteBlock: jest.fn(async (id: string) => void calls.push(`demote ${id}`)),
    };
    const gate: { release: () => void; fail: (error: Error) => void } = {
      release: () => undefined,
      fail: () => undefined,
    };
    const flags = { busy: false };
    const importer = {
      flags,
      prepareBootDisk: jest.fn(async (id: string) => {
        calls.push(`prepare ${id}`);

        return {
          device: `/dev/drbd${assignments.get(id)?.minor}`,
          ...(flags.busy ? { import: { digest: LAYER, format: 'qcow2' } } : {}),
        };
      }),
      importBootDisk: jest.fn(
        async (id: string, _device: string, _layer: unknown, launcher: string, options: VmImportOptions) => {
          calls.push(`import ${id} with ${launcher}`);
          options.progress?.({ phase: 'writing', bytes: 512 * 1024 ** 2, totalBytes: 2048 * 1024 ** 2 });
          await new Promise<void>((resolve, reject) => {
            gate.release = resolve;
            gate.fail = reject;
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
          });
          flags.busy = false;
        },
      ),
      reimage: jest.fn(async (id: string) => void calls.push(`reimage ${id}`)),
    };
    const seed = { write: jest.fn(async () => true) };
    const power = {
      launcherOf: jest.fn(async () => undefined as { Id: string } | undefined),
      state: jest.fn(async () => 'running'),
      power: jest.fn(async () => undefined),
    };
    const router = { registryClient: null };
    const vms = new VmSupport(
      docker as never,
      volumes as never,
      importer as never,
      seed as never,
      power as never,
      router as never,
      options.sessions,
    );
    const sent: AgentEvent[] = [];

    vms.attach((envelope: Envelope) => {
      const decoded = decodeAgentMessage(envelope);

      if (!decoded.ok) throw new Error(decoded.error);

      sent.push(decoded.message.payload as AgentEvent);
    });

    return { vms, docker, volumes, importer, seed, power, calls, events, sent, gate };
  }

  it('promotes every disk for a start, the boot disk through the image import, in vm.disks order', async () => {
    const { vms, calls } = setup();

    expect(await vms.blockDevices(spec)).toEqual(['/dev/drbd1003', '/dev/drbd1004']);
    expect(calls).toEqual(['prepare shop/lw-vm/db1.root', 'promote shop/lw-vm/db1.data']);

    // The boot disk first, whatever its position; the devices still in vm.disks order.
    const reordered = { ...spec, vm: { ...spec.vm, disks: [...(spec.vm?.disks ?? [])].reverse() } } as WorkloadSpec;

    calls.length = 0;
    expect(await vms.blockDevices(reordered)).toEqual(['/dev/drbd1004', '/dev/drbd1003']);
    expect(calls).toEqual(['prepare shop/lw-vm/db1.root', 'promote shop/lw-vm/db1.data']);
  });

  it('refuses disks this node holds no block replica of', async () => {
    const missing = setup({ volumes: [block('shop/lw-vm/db1.root', 1003)] });

    await expect(missing.vms.blockDevices(spec)).rejects.toThrow('disk data (shop/lw-vm/db1.data) has no replica');

    const formatted = setup({
      volumes: [block('shop/lw-vm/db1.root', 1003), { ...block('shop/lw-vm/db1.data', 1004), mode: undefined }],
    });

    await expect(formatted.vms.blockDevices(spec)).rejects.toThrow('is no block volume');
    expect(formatted.calls).toEqual([]);
  });

  it("writes vm.json and the seed with the node's resolvers and the pod MTU", async () => {
    const { vms, seed } = setup();
    const dir = await mkdtemp(join(tmpdir(), 'lw-vmrun-'));

    try {
      await vms.launchFiles(spec, dir, ['/dev/drbd1003', '/dev/drbd1004']);

      const written = JSON.parse(await readFile(join(dir, 'vm.json'), 'utf8'));

      expect(written.nics.map((n: { tap: string }) => n.tap)).toEqual(['lwtap0', 'lwtap1']);
      expect((await stat(join(dir, 'vm.json'))).mode & 0o777).toBe(0o600);
      expect(seed.write).toHaveBeenCalledWith(spec, dir, { dnsServers: ['10.42.0.1', 'fd42::1'], mtu: 1420 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a boot disk in the background: the start is deferred, the status shows the progress (F3b)', async () => {
    const { vms, importer, gate, calls, sent } = setup({
      running: [{ Id: 'c-db2', Labels: { 'loadweaver.com/workload': 'shop/lw-vm/db2/0' } }],
    });
    const settled = jest.fn();

    vms.onSettled(settled);
    importer.flags.busy = true;

    // The reconcile isn't held: deferred right away while the import runs.
    await expect(vms.blockDevices(spec)).rejects.toBeInstanceOf(WorkloadDeferred);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual([
      'prepare shop/lw-vm/db1.root',
      'import shop/lw-vm/db1.root with ghcr.io/forepath/microvm-launcher:1.0.0',
    ]);
    // Nothing else promoted while the boot disk is written; a second reconcile observes the same job.
    await expect(vms.blockDevices(spec)).rejects.toThrow(
      'writing the boot disk from the VM image (512 MiB of 2048 MiB)',
    );
    expect(importer.prepareBootDisk).toHaveBeenCalledTimes(1);
    expect(sent.pop()).toMatchObject({
      labels: { kind: 'virtual-machine', replica: spec.id, operation: 'boot-disk-import', result: 'running' },
    });

    const status = await vms.annotate({
      workloads: [
        { id: 'shop/lw-vm/db2/0', state: 'running', specHash: 'h2' },
        { id: 'shop/store/web/0', state: 'healthy', specHash: 'h3' },
      ],
    });

    expect(status.workloads).toEqual([
      { id: 'shop/lw-vm/db2/0', state: 'running', specHash: 'h2', vm: { power: 'running' } },
      { id: 'shop/store/web/0', state: 'healthy', specHash: 'h3' },
      {
        id: 'shop/lw-vm/db1/0',
        state: 'pending',
        specHash: 'h1',
        message: 'writing the boot disk from the VM image (512 MiB of 2048 MiB)',
        vm: {
          importing: true,
          importProgress: { phase: 'writing', bytes: 512 * 1024 ** 2, totalBytes: 2048 * 1024 ** 2 },
        },
      },
    ]);
    // The import holds the disk: a stray destroy event doesn't demote it.
    await vms.released(spec.id);
    expect(calls.some((c) => c.startsWith('demote'))).toBe(false);

    gate.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toHaveBeenCalledTimes(1);
    expect(sent.pop()).toMatchObject({ level: 'info', labels: { result: 'done', operation: 'boot-disk-import' } });
    expect((await vms.annotate({ workloads: [] })).workloads).toEqual([]);
    // Written: the next reconcile gets the devices.
    expect(await vms.blockDevices(spec)).toEqual(['/dev/drbd1003', '/dev/drbd1004']);
  });

  it('reports a failed boot disk import in the status (instead of a stopped launcher) and as an event', async () => {
    const { vms, importer, gate, sent } = setup();

    importer.flags.busy = true;
    await expect(vms.blockDevices(spec)).rejects.toBeInstanceOf(WorkloadDeferred);
    await new Promise((resolve) => setImmediate(resolve));
    gate.fail(new Error('qemu-img convert failed (exit 1): write error'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(sent.pop()).toMatchObject({
      level: 'error',
      message: 'boot disk import of shop/lw-vm/db1.root failed: qemu-img convert failed (exit 1): write error',
      labels: { replica: spec.id, volume: 'shop/lw-vm/db1.root', result: 'failed' },
    });
    expect(
      (await vms.annotate({ workloads: [{ id: spec.id, state: 'exited', specHash: 'h1', exitCode: 0 }] })).workloads,
    ).toEqual([
      {
        id: spec.id,
        state: 'failed',
        specHash: 'h1',
        message: 'boot disk import failed: qemu-img convert failed (exit 1): write error',
        vm: {
          importing: false,
          importProgress: { phase: 'failed', bytes: 512 * 1024 ** 2, totalBytes: 2048 * 1024 ** 2 },
        },
      },
    ]);
    // Until the retry the reconcile is told why.
    await expect(vms.blockDevices(spec)).rejects.toThrow('boot disk import failed: qemu-img convert failed');
    expect(importer.prepareBootDisk).toHaveBeenCalledTimes(1);
  });

  it('cancels the import when the VM leaves the node and demotes the disk once the write stopped', async () => {
    const { vms, importer, calls, sent } = setup();

    importer.flags.busy = true;
    await expect(vms.blockDevices(spec)).rejects.toBeInstanceOf(WorkloadDeferred);
    await new Promise((resolve) => setImmediate(resolve));

    const signal = (importer.importBootDisk.mock.calls[0] as unknown[])[4] as VmImportOptions;

    // Still desired: kept.
    vms.desired([spec]);
    expect(signal.signal?.aborted).toBe(false);

    // Re-imaging is refused while the first import runs.
    const isolation = await import('../host/isolation-probe.service');
    const pinned = jest.spyOn(isolation, 'launcherImage').mockReturnValue('ghcr.io/forepath/microvm-launcher:1.0.0');

    await vms.handle('vmImageImport', {
      import: '2d4e6f80-1a2b-4c3d-8e5f-6a7b8c9d0e1f',
      replica: spec.id,
      volume: 'shop/lw-vm/db1.root',
      image: { ref: 'registry.lw.internal/shop/debian:13', digest: LAYER, format: 'qcow2', layerDigest: LAYER },
    });
    pinned.mockRestore();
    expect(sent.pop()?.message).toContain('the first import of shop/lw-vm/db1.root is still running');

    vms.desired([]);
    expect(signal.signal?.aborted).toBe(true);
    expect(sent.pop()).toMatchObject({ labels: { result: 'cancelled', volume: 'shop/lw-vm/db1.root' } });
    expect(calls.some((c) => c.startsWith('demote'))).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toContain('demote shop/lw-vm/db1.root');
    expect((await vms.annotate({ workloads: [] })).workloads).toEqual([]);
  });

  it('demotes the disks of removed launchers, but not right after a (re)start promoted them', async () => {
    const { vms, calls, events, docker } = setup();

    await vms.watch();
    expect(docker.getEvents).toHaveBeenCalledWith({
      filters: { type: ['container'], event: ['destroy'], label: ['loadweaver.com/managed=true', 'loadweaver.com/vm'] },
    });

    events.write(
      `${JSON.stringify({ Action: 'destroy', Actor: { Attributes: { 'loadweaver.com/workload': 'shop/lw-vm/db1/0' } } })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual(['demote shop/lw-vm/db1.root', 'demote shop/lw-vm/db1.data']);

    calls.length = 0;
    await vms.blockDevices(spec);
    calls.length = 0;
    await vms.released('shop/lw-vm/db1/0');
    expect(calls).toEqual([]);

    // A container of the replica exists (created, not started yet): nothing is demoted either.
    const other = setup();

    other.docker.listContainers.mockImplementation(async () => [{ Id: 'c-new', Labels: {} }] as never);
    await other.vms.released('shop/lw-vm/db1/0');
    expect(other.calls).toEqual([]);
  });

  it('leaves the disks of a migrating VM to the migration and starts an incoming one on its disks as they are', async () => {
    const sessions = new MigrationSessions();
    const { vms, calls } = setup({ sessions });

    // Source or target of a QEMU live migration (M7.4): commit / abort decide about the disks.
    sessions.begin('shop/lw-vm/db1/0');
    await vms.released('shop/lw-vm/db1/0');
    expect(calls).toEqual([]);
    sessions.end('shop/lw-vm/db1/0');
    await vms.released('shop/lw-vm/db1/0');
    expect(calls).toEqual(['demote shop/lw-vm/db1.root', 'demote shop/lw-vm/db1.data']);

    // Incoming: neither promoted (the migration does, dual-primary) nor initialized from the image.
    calls.length = 0;
    vms.expectIncoming('shop/lw-vm/db1/0');
    expect(await vms.blockDevices(spec)).toEqual(['/dev/drbd1003', '/dev/drbd1004']);
    expect(calls).toEqual([]);
    vms.incomingDone('shop/lw-vm/db1/0');
    await vms.blockDevices(spec);
    expect(calls).toHaveLength(2);
  });

  it('carries out vmPower and vmImageImport and reports the outcome as events', async () => {
    const { vms, power, importer, sent } = setup();
    const job = '2d4e6f80-1a2b-4c3d-8e5f-6a7b8c9d0e1f';
    const image = {
      ref: 'registry.lw.internal/shop/debian:13',
      digest: `sha256:${'1'.repeat(64)}`,
      format: 'qcow2',
      layerDigest: LAYER,
    };

    await vms.handle('vmPower', { replica: 'shop/lw-vm/db1/0', action: 'reboot' });
    expect(power.power).toHaveBeenCalledWith({ replica: 'shop/lw-vm/db1/0', action: 'reboot' });
    expect(sent.pop()).toMatchObject({
      level: 'info',
      labels: { kind: 'virtual-machine', action: 'reboot', result: 'done' },
      vmCommand: { type: 'vmPower', action: 'reboot' },
    });

    // No launcher image pinned by the release: refused, reported.
    const isolation = await import('../host/isolation-probe.service');
    const unpinned = jest.spyOn(isolation, 'launcherImage').mockReturnValue(null);

    await vms.handle('vmImageImport', {
      import: job,
      replica: 'shop/lw-vm/db1/0',
      volume: 'shop/lw-vm/db1.root',
      image,
    });
    unpinned.mockRestore();
    expect(sent.pop()).toMatchObject({
      level: 'error',
      labels: { import: job, result: 'failed' },
      vmCommand: { type: 'vmImageImport', importId: job },
    });

    // A running VM is never re-imaged.
    power.launcherOf.mockResolvedValueOnce({ Id: 'c-db1' });
    await vms.handle('vmImageImport', {
      import: job,
      replica: 'shop/lw-vm/db1/0',
      volume: 'shop/lw-vm/db1.root',
      image,
    });
    expect(sent.pop()?.message).toContain('stop virtual machine shop/lw-vm/db1/0 before re-imaging it');

    // Disks of another VM are refused.
    await vms.handle('vmImageImport', {
      import: job,
      replica: 'shop/lw-vm/db1/0',
      volume: 'shop/lw-vm/db2.root',
      image,
    });
    expect(sent.pop()?.message).toContain('is no disk of shop/lw-vm/db1/0');
    expect(importer.reimage).not.toHaveBeenCalled();

    power.power.mockRejectedValueOnce(new Error("virtual machine shop/lw-vm/db1/0 doesn't run on this node"));
    await vms.handle('vmPower', { replica: 'shop/lw-vm/db1/0', action: 'reset' });
    // Failures name the action explicitly (label + vmCommand), not only through the message prefix.
    expect(sent.pop()).toMatchObject({
      level: 'error',
      labels: { replica: 'shop/lw-vm/db1/0', action: 'reset', result: 'failed' },
      vmCommand: { type: 'vmPower', action: 'reset' },
    });

    await vms.handle('vmPower', { replica: 'shop/lw-vm/db1/0', action: 'poweroff' });

    const invalid = sent.pop();

    expect(invalid?.level).toBe('error');
    // An unknown action is the reason, never echoed as the action.
    expect(invalid?.labels?.['action']).toBeUndefined();
    expect(invalid?.vmCommand).toEqual({ type: 'vmPower' });
  });

  it('re-images with the release launcher image when it is pinned', async () => {
    const isolation = await import('../host/isolation-probe.service');
    const spy = jest
      .spyOn(isolation, 'launcherImage')
      .mockReturnValue('ghcr.io/forepath/microvm-launcher@sha256:' + 'e'.repeat(64));
    const { vms, importer, sent } = setup();

    try {
      await vms.handle('vmImageImport', {
        import: '2d4e6f80-1a2b-4c3d-8e5f-6a7b8c9d0e1f',
        replica: 'shop/lw-vm/db1/0',
        volume: 'shop/lw-vm/db1.root',
        image: {
          ref: 'registry.lw.internal/shop/debian:13',
          digest: `sha256:${'1'.repeat(64)}`,
          format: 'qcow2',
          layerDigest: LAYER,
        },
      });
      expect(importer.reimage).toHaveBeenCalledWith(
        'shop/lw-vm/db1.root',
        expect.objectContaining({ layerDigest: LAYER }),
        'ghcr.io/forepath/microvm-launcher@sha256:' + 'e'.repeat(64),
      );
      expect(sent.map((e) => e.labels?.['result'])).toEqual(['running', 'done']);
      expect(sent.map((e) => e.vmCommand)).toEqual([
        { type: 'vmImageImport', importId: '2d4e6f80-1a2b-4c3d-8e5f-6a7b8c9d0e1f' },
        { type: 'vmImageImport', importId: '2d4e6f80-1a2b-4c3d-8e5f-6a7b8c9d0e1f' },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('ignores event lines that are no JSON', async () => {
    const { vms, events, calls } = setup();

    await vms.watch();
    events.write('not json\n');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toEqual([]);
  });
});
