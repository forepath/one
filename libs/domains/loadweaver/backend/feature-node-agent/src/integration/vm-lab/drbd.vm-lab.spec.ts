import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VolumeAssignment } from '@forepath/loadweaver/shared/util-agent-protocol';

import { VOLUME_DRIVER_BUNDLE } from './vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from './vm-lab';

/**
 * First run of the M2 volume path on real kernels (M6 step 1a): the node agent's `VolumeManager` and Docker volume
 * plugin (bundled, see volume-driver.entry.ts) on Debian 13 VMs with DRBD 9.2.20 — two replicas in site a
 * (protocol C) and one in site b (protocol A), LVM thin → LUKS2 → DRBD. Writes through Docker on the primary, crashes
 * it, promotes the sync replica, lets the old primary rejoin and resync, and fails back. Then the volume follow-ups:
 * the cross-site replica moves to a fourth VM (resync, `forget-peer` of the old slot) and a fresh volume passes
 * `drbdadm verify` (shared LUKS volume key). Node names (`n1`…) differ from the VMs' host names (`vm1`…) on purpose:
 * DRBD must find each host by the host name its agent reports, not by the node name.
 */

const RESOURCE = 'lw-1000';
const CACHE_RESOURCE = 'lw-1001';
const DOCKER_NAME = 'lw-vol-shop.store.data';
const CACHE_DOCKER_NAME = 'lw-vol-shop.store.cache';
const DRIVER = '/opt/loadweaver/volume-driver.js';
const ASSIGNMENTS = '/etc/loadweaver/lab-assignments.json';
const BUSYBOX =
  'docker.io/library/busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';

interface DrbdStatus {
  role: string;
  devices: { 'disk-state': string }[];
  connections: {
    name: string;
    'connection-state': string;
    peer_devices: { 'peer-disk-state': string; 'replication-state': string; 'out-of-sync': number }[];
  }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const start = Date.now();
  let last: unknown;

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }

    if (Date.now() - start > timeoutMs)
      throw new Error(`${what}: not reached in ${timeoutMs} ms${last ? ` (${String(last)})` : ''}`);

    await sleep(1000);
  }
}

describe('replicated volumes on real DRBD 9 (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let vm3: Vm;
  let vm4: Vm;
  const timings: Record<string, number> = {};
  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const start = Date.now();

    try {
      return await fn();
    } finally {
      timings[label] = Math.round((Date.now() - start) / 100) / 10;
    }
  };

  /** Node name of a VM (as the control plane knows it); the VM's host name stays `vm<n>`. */
  const nodeOf = (vm: Vm) => vm.name.replace(/^vm/, 'n');
  /** What the control plane assigns: DRBD node ids are stable per node, a new holder gets a new id (vm4: 3). */
  const NODE_IDS: Record<string, number> = { vm1: 0, vm2: 1, vm3: 2, vm4: 3 };
  const layout = { remote: 'vm3', cache: false };
  const replica = (vm: Vm) => ({ node: nodeOf(vm), nodeId: NODE_IDS[vm.name], address: vm.ip, host: vm.name });
  const connections = (a: Vm, b: Vm, remote: Vm): VolumeAssignment['connections'] => [
    { a: nodeOf(a), b: nodeOf(b), protocol: 'C' },
    { a: nodeOf(a), b: nodeOf(remote), protocol: 'A' },
    { a: nodeOf(b), b: nodeOf(remote), protocol: 'A' },
  ];

  const assignments = (primary: Vm): VolumeAssignment[] => {
    const remote = layout.remote === 'vm3' ? vm3 : vm4;
    const data: VolumeAssignment = {
      id: 'shop/store/data',
      dockerName: DOCKER_NAME,
      minor: 1000,
      port: 7800,
      sizeBytes: 1024 ** 3,
      replicas: [vm1, vm2, remote].map(replica),
      connections: connections(vm1, vm2, remote),
      primary: nodeOf(primary),
      keyRef: 'secret://shop/lw-volume-store.data',
    };
    // Created after the move, on vm1 / vm2 / vm4, always primary on vm1.
    const cache: VolumeAssignment = {
      ...data,
      id: 'shop/store/cache',
      dockerName: CACHE_DOCKER_NAME,
      minor: 1001,
      port: 7801,
      sizeBytes: 256 * 1024 ** 2,
      replicas: [vm1, vm2, vm4].map(replica),
      connections: connections(vm1, vm2, vm4),
      primary: 'n1',
      keyRef: 'secret://shop/lw-volume-store.cache',
    };

    return layout.cache ? [data, cache] : [data];
  };

  /** Runs the bundled volume manager on `vm` with the control plane's view "primary is `primary`". */
  const driver = async (vm: Vm, mode: 'apply' | 'mount' | 'unmount', primary: Vm, dockerName = DOCKER_NAME) => {
    // A VM without a replica gets an empty list (its stale replicas are removed).
    const mine = assignments(primary).filter((v) => v.replicas.some((r) => r.node === nodeOf(vm)));

    const out = await vm.exec(
      `cat > ${ASSIGNMENTS} <<'EOF'\n${JSON.stringify(mine)}\nEOF\nnode ${DRIVER} ${mode} ${nodeOf(vm)} ${ASSIGNMENTS} ${dockerName}`,
    );
    // The manager's log lines go to stdout too; the result is the last line.
    const lines = out.trim().split('\n');

    process.stderr.write(
      lines
        .slice(0, -1)
        .map((l) => `[vm-lab] ${vm.name}: ${l}\n`)
        .join(''),
    );

    return JSON.parse(lines[lines.length - 1] ?? '') as { changed: boolean; mountpoint?: string };
  };

  const status = async (vm: Vm, resource = RESOURCE): Promise<DrbdStatus> =>
    (JSON.parse(await vm.exec(`drbdsetup status ${resource} --json`)) as DrbdStatus[])[0];

  /** LVM / thin_check view of the data disk's thin pool, for failures right after a crash. */
  const thinPoolDiagnostics = async (vm: Vm) =>
    (
      await vm.execResult(
        [
          'lvs -a -o lv_name,lv_active,lv_health_status,lv_attr loadweaver 2>&1',
          "journalctl -b --no-pager 2>&1 | grep -iE 'lvm\\[|thin|check of pool|device-mapper: thin' | tail -30",
          'lvchange -ay -y loadweaver/pool_tmeta 2>&1 && thin_check /dev/loadweaver/pool_tmeta 2>&1',
          'echo "thin_check exit $?"',
          'lvchange -an loadweaver/pool_tmeta 2>&1 || true',
        ].join('\n'),
      )
    ).stdout;

  /** Resolves once `vm`'s disk and all its connections / peer disks are as expected (peers by host name). */
  const settled = (vm: Vm, disk: string, peers: Record<string, string>, resource = RESOURCE) =>
    eventually(`${vm.name} ${resource} ${disk} with ${JSON.stringify(peers)}`, async () => {
      const s = await status(vm, resource);
      const ok =
        s.devices[0]?.['disk-state'] === disk &&
        Object.entries(peers).every(([peer, peerDisk]) => {
          const c = s.connections.find((x) => x.name === peer);

          return c?.['connection-state'] === 'Connected' && c.peer_devices[0]?.['peer-disk-state'] === peerDisk;
        });

      return ok ? s : undefined;
    });

  beforeAll(async () => {
    // Four VMs fit the 7 GiB guard with 1 GiB guests (4 × (1024 + 700) + 128 MiB).
    lab = await timed('lab start (4 VMs)', () =>
      startVmLab({
        vms: [
          { name: 'vm1', site: 'a', dataDiskGb: 4, memoryMb: 1024 },
          { name: 'vm2', site: 'a', dataDiskGb: 4, memoryMb: 1024 },
          { name: 'vm3', site: 'b', dataDiskGb: 4, memoryMb: 1024 },
          { name: 'vm4', site: 'b', dataDiskGb: 4, memoryMb: 1024 },
        ],
        log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
      }),
    );
    ({ vm1, vm2, vm3, vm4 } = lab.vms as Record<'vm1' | 'vm2' | 'vm3' | 'vm4', Vm>);

    await timed('storage + driver prep', () =>
      Promise.all(
        [vm1, vm2, vm3, vm4].map(async (vm) => {
          await vm.copyIn(VOLUME_DRIVER_BUNDLE, DRIVER);
          // Same LUKS key on every replica (one secret per volume, delivered by the control plane in production).
          await vm.exec(
            [
              `pvcreate -q ${vm.dataDisk} && vgcreate -q loadweaver ${vm.dataDisk}`,
              'lvcreate -q -l 90%FREE -T loadweaver/pool',
              'install -d -m 0700 /etc/loadweaver',
              "printf '%s' lab-volume-key-0123456789abcdef > /etc/loadweaver/lab-volume.key",
              'chmod 0600 /etc/loadweaver/lab-volume.key',
              'modprobe drbd',
            ].join('\n'),
          );
        }),
      ),
    );
  });

  afterAll(async () => {
    await lab?.stop();
    process.stderr.write(`[vm-lab] DRBD timings (s): ${JSON.stringify(timings)}\n`);
  });

  it('runs the pinned node stack from the golden image (DRBD 9.2.20 on the guest kernel)', async () => {
    for (const vm of [vm1, vm2, vm3, vm4]) {
      expect(await vm.exec('cat /proc/drbd')).toMatch(/^version: 9\.2\.20 /m);
      expect(await vm.exec('drbdadm --version')).toContain('DRBDADM_VERSION=9.22.0');
    }

    const dir = mkdtempSync(join(tmpdir(), 'lw-vmlab-manifest-'));

    try {
      await vm1.copyOut('/etc/loadweaver-lab-golden.manifest', join(dir, 'manifest'));

      const manifest = readFileSync(join(dir, 'manifest'), 'utf8');

      expect(manifest).toMatch(/^docker 29\.9\.1$/m);
      expect(manifest).toMatch(/^runc version 1\.5\.2$/m);
      expect(manifest).toMatch(/^containerd\.io 2\.4\.2-/m);
      expect(manifest).toMatch(/^criu 4\.1\.1-1$/m);
      // The node installer pins the same storage userland for Debian 13 (STORAGE_PACKAGE_PINS, install-script.utils).
      expect(manifest).toMatch(/^lvm2 2\.03\.31-2$/m);
      expect(manifest).toMatch(/^cryptsetup 2:2\.7\.5-2$/m);
      expect(manifest).toMatch(/^drbd-utils 9\.22\.0-1\.1$/m);
      expect(manifest).toMatch(/^thin-provisioning-tools 1\.1\.0-4\+b1$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('converges LVM thin, LUKS2 and DRBD on every replica and connects them, by host name', async () => {
    await timed('apply on 3 replicas', () => Promise.all([vm1, vm2, vm3].map((vm) => driver(vm, 'apply', vm1))));

    for (const vm of [vm1, vm2, vm3]) {
      expect(await vm.exec('lvs --noheadings -o lv_name,pool_lv loadweaver')).toMatch(/lw-1000\s+pool/);
      await vm.exec('cryptsetup isLuks /dev/loadweaver/lw-1000');

      const res = await vm.exec(`cat /etc/drbd.d/${RESOURCE}.res`);

      expect(res).toContain('disk "/dev/mapper/lw-1000-crypt";');
      // Node n1 lives on host vm1: DRBD finds itself only through the reported host name.
      expect(res).toContain(`on "vm1" { node-id 0; address ipv4 ${vm1.ip}:7800; }`);
      expect((await vm.exec('uname -n')).trim()).toBe(vm.name);
    }

    await timed('replicas connected', () =>
      Promise.all([
        eventually('all connected', async () => {
          const all = await Promise.all([vm1, vm2, vm3].map((vm) => status(vm)));

          return all.every((s) => s.connections.every((c) => c['connection-state'] === 'Connected')) ? all : undefined;
        }),
      ]),
    );

    // A second apply is a no-op (the agent re-applies on every desired-state push).
    expect((await driver(vm2, 'apply', vm1)).changed).toBe(false);
  });

  it('mounts on the chosen primary through the Docker volume plugin and replicates writes', async () => {
    await vm1.exec(
      [
        `systemd-run --unit lw-volume-plugin --collect node ${DRIVER} serve n1 ${ASSIGNMENTS} >/dev/null`,
        'for i in $(seq 1 50); do [ -S /run/docker/plugins/loadweaver.sock ] && exit 0; sleep 0.2; done',
        'journalctl -u lw-volume-plugin --no-pager; exit 1',
      ].join('\n'),
    );
    await timed('first mount + write 32 MiB', () =>
      vm1.exec(
        [
          `docker run -d --name writer -v ${DOCKER_NAME}:/data --volume-driver loadweaver ${BUSYBOX} sh -c \\`,
          "  'dd if=/dev/urandom of=/data/blob bs=1M count=32 2>/dev/null && cd /data && sha256sum blob > blob.sha256 && sync && touch /data/ready && sleep 86400'",
          'for i in $(seq 1 60); do [ -f /var/lib/loadweaver/volumes/lw-vol-shop.store.data/ready ] && exit 0; sleep 0.5; done',
          'docker logs writer; exit 1',
        ].join('\n'),
      ),
    );

    expect((await status(vm1)).role).toBe('Primary');
    // Docker sees the plugin's mountpoint.
    expect(await vm1.exec(`docker volume inspect -f '{{.Driver}} {{.Mountpoint}}' ${DOCKER_NAME}`)).toContain(
      'loadweaver /var/lib/loadweaver/volumes/lw-vol-shop.store.data',
    );
    await timed('sync replicas UpToDate', () =>
      Promise.all([settled(vm1, 'UpToDate', { vm2: 'UpToDate', vm3: 'UpToDate' })]),
    );
    expect((await status(vm2)).role).toBe('Secondary');
  });

  it('fails over to the sync replica after the primary crashes', async () => {
    const checksum = await vm1.exec('cat /var/lib/loadweaver/volumes/lw-vol-shop.store.data/blob.sha256');

    await vm1.crash();
    await timed('failover: promote + mount on vm2', async () => {
      await eventually('vm2 lost vm1', async () =>
        (await status(vm2)).connections.find((c) => c.name === 'vm1')?.['connection-state'] !== 'Connected'
          ? true
          : undefined,
      );

      return await driver(vm2, 'mount', vm2);
    });

    expect(
      await vm2.exec('cd /var/lib/loadweaver/volumes/lw-vol-shop.store.data && sha256sum -c blob.sha256'),
    ).toContain('blob: OK');
    expect(checksum).toMatch(/^[0-9a-f]{64} {2}blob$/m);
    // New writes while the old primary is gone; they have to reach it on rejoin.
    await vm2.exec(
      'cd /var/lib/loadweaver/volumes/lw-vol-shop.store.data && dd if=/dev/urandom of=blob2 bs=1M count=16 2>/dev/null && sha256sum blob2 > blob2.sha256 && sync',
    );
  });

  it('lets the old primary rejoin as a secondary, resync and take over again', async () => {
    await timed('vm1 boot after crash', () => vm1.start());
    await timed('vm1 rejoin + resync', async () => {
      // Seen twice in ~10 runs: after the crash LVM refused the thin pool ("Check of pool loadweaver/pool failed
      // (status:64)"), not reproducible since; keep the evidence if it happens again.
      await driver(vm1, 'apply', vm2).catch(async (error: unknown) => {
        process.stderr.write(`[vm-lab] thin pool diagnostics on vm1:\n${await thinPoolDiagnostics(vm1)}\n`);
        throw error;
      });
      await settled(vm1, 'UpToDate', { vm2: 'UpToDate', vm3: 'UpToDate' });
    });
    expect((await status(vm1)).role).toBe('Secondary');

    await timed('failback to vm1', async () => {
      await driver(vm2, 'unmount', vm1);
      await driver(vm1, 'mount', vm1);
    });
    expect(
      await vm1.exec('cd /var/lib/loadweaver/volumes/lw-vol-shop.store.data && sha256sum -c blob.sha256 blob2.sha256'),
    ).toMatch(/blob: OK[\s\S]*blob2: OK/);
    expect((await status(vm2)).role).toBe('Secondary');
    await settled(vm3, 'UpToDate', { vm1: 'UpToDate', vm2: 'UpToDate' });
  });

  it('brings a cleanly rebooted cross-site replica back on the next apply', async () => {
    await timed('vm3 clean reboot', () => vm3.reboot());
    expect(await vm3.exec(`drbdsetup status ${RESOURCE} 2>&1 || true`)).toContain('No such resource');
    await timed('vm3 rejoin', async () => {
      await driver(vm3, 'apply', vm1);
      await settled(vm3, 'UpToDate', { vm1: 'UpToDate', vm2: 'UpToDate' });
    });
  });

  it('moves the cross-site replica to a new node: resync there, old peer slot forgotten on the others', async () => {
    const checksum = await vm1.exec('cat /var/lib/loadweaver/volumes/lw-vol-shop.store.data/blob.sha256');

    layout.remote = 'vm4';
    await timed('replica move vm3 → vm4 (apply + full resync of 1 GiB)', async () => {
      // The primary keeps writing through the move.
      await Promise.all([vm1, vm2, vm4].map((vm) => driver(vm, 'apply', vm1)));
      await driver(vm3, 'apply', vm1);
      await settled(vm1, 'UpToDate', { vm2: 'UpToDate', vm4: 'UpToDate' });
      await settled(vm4, 'UpToDate', { vm1: 'UpToDate', vm2: 'UpToDate' });
    });

    for (const vm of [vm1, vm2]) {
      const s = await status(vm);

      expect(s.connections.map((c) => c.name).sort()).toEqual([vm === vm1 ? 'vm2' : 'vm1', 'vm4'].sort());
      expect(await vm.exec(`cat /etc/drbd.d/${RESOURCE}.res`)).not.toContain('"vm3"');
    }

    // vm3's copy is gone completely.
    expect(await vm3.exec('lvs --noheadings -o lv_name loadweaver')).not.toContain('lw-1000');
    expect(await vm3.exec(`ls /etc/drbd.d/${RESOURCE}.res 2>&1 || true`)).toContain('No such file');

    // The bitmap slot of node-id 2 (vm3) is free on the remaining replicas: in the metadata (read on the secondary
    // vm2 while its resource is down) only node ids 0 (vm1) and 3 (vm4) still own a slot (max-peers 7).
    // `down` leaves the activity log to be applied on the next attach; dump-md wants it applied.
    await vm2.exec(`drbdadm down ${RESOURCE} && drbdadm apply-al ${RESOURCE}`);

    const dump = await vm2.execResult(`drbdadm dump-md ${RESOURCE}`);

    expect({ code: dump.code, stderr: dump.stderr.trim() }).toEqual({ code: 0, stderr: '' });

    // `peer[<node-id>] { bitmap-index <slot>; … }`: -1 = no bitmap slot (own node, never seen, or forgotten).
    const slots = Object.fromEntries(
      [...dump.stdout.matchAll(/peer\[(\d+)\]\s*\{\s*bitmap-index\s+(-?\d+);/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
      ]),
    );

    expect(slots[2]).toBe(-1);
    expect(
      Object.entries(slots)
        .filter(([, slot]) => slot >= 0)
        .map(([nodeId]) => Number(nodeId))
        .sort(),
    ).toEqual([0, 3]);

    // Forgetting the already-forgotten slot again (an interrupted reconcile retrying it) succeeds: DRBD 9.2.20's
    // forget-peer is idempotent, so a retried marker clears (`VolumeManager.forgetPeer`).
    const again = await vm1.execResult(`drbdsetup forget-peer ${RESOURCE} 2`);

    expect({ code: again.code, stderr: again.stderr.trim() }).toEqual({ code: 0, stderr: '' });
    await driver(vm2, 'apply', vm1);
    await settled(vm2, 'UpToDate', { vm1: 'UpToDate', vm4: 'UpToDate' });

    // The data survived the move, also on the new replica (checked after a switch to vm4 and back).
    await driver(vm1, 'unmount', vm4);
    await driver(vm4, 'mount', vm4);
    expect(
      await vm4.exec('cd /var/lib/loadweaver/volumes/lw-vol-shop.store.data && sha256sum -c blob.sha256 blob2.sha256'),
    ).toMatch(/blob: OK[\s\S]*blob2: OK/);
    expect(checksum).toMatch(/^[0-9a-f]{64} {2}blob$/m);
    await driver(vm4, 'unmount', vm1);
    await driver(vm1, 'mount', vm1);
  });

  it('gives every replica of a volume the same LUKS volume key, so online verify of a fresh volume is clean', async () => {
    layout.cache = true;
    await timed('fresh volume on vm1 / vm2 / vm4 + first mount', async () => {
      await Promise.all([vm1, vm2, vm4].map((vm) => driver(vm, 'apply', vm1)));
      await settled(vm1, 'Inconsistent', { vm2: 'Inconsistent', vm4: 'Inconsistent' }, CACHE_RESOURCE);
      await driver(vm1, 'mount', vm1, CACHE_DOCKER_NAME);
      await settled(vm1, 'UpToDate', { vm2: 'UpToDate', vm4: 'UpToDate' }, CACHE_RESOURCE);
    });

    // Same LUKS volume key and dm-crypt layout on all replicas (the key is derived from the volume's secret; the
    // lab's key file stands in for it). cryptsetup keeps the key in the kernel keyring, so it's read from the header.
    const volumeKeys = await Promise.all(
      [vm1, vm2, vm4].map(async (vm) => {
        const dump = await vm.exec(
          `cryptsetup luksDump --dump-volume-key -q --key-file /etc/loadweaver/lab-volume.key /dev/loadweaver/${CACHE_RESOURCE}`,
        );

        return (/(?:MK dump|Volume key):?\s*([\s\S]*)$/i.exec(dump)?.[1] ?? '').replace(/[^0-9a-f]/gi, '');
      }),
    );

    expect(volumeKeys[0]).toMatch(/^[0-9a-f]{128}$/);
    expect(volumeKeys).toEqual([volumeKeys[0], volumeKeys[0], volumeKeys[0]]);

    for (const vm of [vm1, vm2, vm4])
      expect(await vm.exec(`dmsetup table ${CACHE_RESOURCE}-crypt`)).toMatch(
        / crypt aes-xts-plain64 \S+ 0 \d+:\d+ 32768 1 sector_size:4096/,
      );

    // No key file left behind on the tmpfs.
    expect((await vm1.exec('find /run/loadweaver -type f | wc -l')).trim()).toBe('0');

    await timed('drbdadm verify (256 MiB, mostly never written)', async () => {
      await vm1.exec(`drbdadm verify ${CACHE_RESOURCE}`);
      await eventually('verify started', async () =>
        (await status(vm1, CACHE_RESOURCE)).connections.some((c) =>
          c.peer_devices.some((p) => p['replication-state'].startsWith('Verify')),
        )
          ? true
          : undefined,
      ).catch(() => undefined); // may already be done
      await eventually('verify done', async () => {
        const s = await status(vm1, CACHE_RESOURCE);

        return s.connections.every((c) => c.peer_devices.every((p) => p['replication-state'] === 'Established'))
          ? s
          : undefined;
      });
    });

    const after = await status(vm1, CACHE_RESOURCE);
    const log = await vm1.exec(`journalctl -k --no-pager | grep -E '${CACHE_RESOURCE}.*Online verify' || true`);

    process.stderr.write(`[vm-lab] ${CACHE_RESOURCE} verify log:\n${log}\n`);
    expect(log).toMatch(/Online verify done/);
    expect(log).not.toMatch(/Online verify found \d+ \d+k blocks out of sync/);
    expect(after.connections.map((c) => c.peer_devices[0]['out-of-sync'])).toEqual([0, 0]);
  });
});
