import { randomBytes } from 'node:crypto';

import { docker, LAB_LABEL, run, RUN_LABEL, type RunResult, tarFiles } from './docker';
import { ensureGolden, ensureQemuImage, type GoldenVariant } from './golden';

/**
 * VM lab (M6): real Debian 13 VMs (QEMU/KVM inside containers) cloned from the cached golden image.
 *
 * Topology: one small "switch" container owns a network namespace with one Linux bridge per site (gateway `.1`)
 * and one persistent tap per VM; it routes between the sites (optionally with netem delay) and NATs to the
 * internet. Each VM runs in its own container (own memory cgroup, `--network container:<switch>`), so it can be
 * crashed / restarted alone. The test process reaches the guests through ssh from inside the switch container.
 */

export interface VmSpec {
  name: string;
  site: string;
  /** Guest RAM; the container gets this + `CONTAINER_OVERHEAD_MB` (QEMU itself). */
  memoryMb?: number;
  cpus?: number;
  /** Extra empty disk (e.g. for an LVM volume group), visible as `vm.dataDisk`. */
  dataDiskGb?: number;
  /** Root disk virtual size (the golden image is 12 GB). */
  rootDiskGb?: number;
}

export interface VmLabOptions {
  vms: VmSpec[];
  /** Debian packages to install at first boot (needs internet through the switch's NAT). */
  packages?: string[];
  /** One-way delay added between sites (netem on the routed link). */
  interSiteDelayMs?: number;
  /** Guard for this machine (M6: whole lab ≤ 7 GB). */
  maxMemoryMb?: number;
  bootTimeoutMs?: number;
  log?: (line: string) => void;
  /** Golden image the VMs are cloned from (default: the current pins; `older-kernel`: see golden.ts). */
  golden?: GoldenVariant;
}

export interface ExecOptions {
  timeoutMs?: number;
  /** Don't throw on a non-zero exit (inspect `code`). */
  allowFailure?: boolean;
}

export interface Vm {
  readonly name: string;
  readonly site: string;
  readonly ip: string;
  readonly container: string;
  /** Block device of the data disk (`/dev/vdb`) if `dataDiskGb` was set. */
  readonly dataDisk?: string;
  /** Seconds from container start to ssh (last boot). */
  bootSeconds: number;
  /** Runs a bash script as root (`set -euo pipefail`); returns stdout, throws on failure. */
  exec(script: string, options?: ExecOptions): Promise<string>;
  execResult(script: string, options?: ExecOptions): Promise<RunResult>;
  copyIn(localPath: string, remotePath: string, mode?: string): Promise<void>;
  copyOut(remotePath: string, localPath: string): Promise<void>;
  /** Clean guest reboot; resolves when the guest is back with a new boot id. */
  reboot(): Promise<void>;
  /** Power cut: kills QEMU (the disks keep whatever reached them). */
  crash(): Promise<void>;
  /** Starts a crashed / stopped VM again and waits for ssh. */
  start(): Promise<void>;
  /**
   * Wipes the VM: power cut, then a fresh root disk from the golden image (and an empty data disk), boot, cloud-init
   * again. Same name, address and ssh key: a replacement machine for disaster-recovery drills.
   */
  wipe(): Promise<void>;
}

export interface VmLab {
  readonly run: string;
  readonly golden: string;
  readonly vms: Record<string, Vm>;
  readonly sites: Record<string, { subnet: string; gateway: string }>;
  /** Removes every container and volume of this run (the golden volume stays). */
  stop(): Promise<void>;
}

export const DEFAULT_MEMORY_MB = 1536;
export const CONTAINER_OVERHEAD_MB = 700;
const SWITCH_MEMORY_MB = 128;
const SSH_OPTIONS = [
  '-i',
  '/lab/id_lab',
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'UserKnownHostsFile=/dev/null',
  '-o',
  'LogLevel=ERROR',
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=3',
  '-o',
  'ServerAliveInterval=5',
  '-o',
  'ServerAliveCountMax=3',
];

const NAME = /^[a-z][a-z0-9-]{0,14}$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Boots the VMs of one lab run; call `stop()` in `afterAll`. */
export async function startVmLab(options: VmLabOptions): Promise<VmLab> {
  const log = options.log ?? (() => undefined);
  const image = await ensureQemuImage();
  const golden = (await ensureGolden(log, options.golden)).volume;
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const prefix = `lw-vmlab-${runId}`;
  const labels = ['--label', `${LAB_LABEL}=run`, '--label', `${RUN_LABEL}=${runId}`];
  const switchName = `${prefix}-switch`;
  const siteNames = [...new Set(options.vms.map((v) => v.site))];
  const sites = Object.fromEntries(
    siteNames.map((s, i) => [s, { subnet: `10.77.${i + 1}.0/24`, gateway: `10.77.${i + 1}.1` }]),
  );
  const memory = options.vms.reduce((sum, v) => sum + (v.memoryMb ?? DEFAULT_MEMORY_MB) + CONTAINER_OVERHEAD_MB, 0);

  for (const v of options.vms) if (!NAME.test(v.name)) throw new Error(`invalid VM name ${v.name}`);

  for (const s of siteNames) if (!NAME.test(s)) throw new Error(`invalid site name ${s}`);

  if (new Set(options.vms.map((v) => v.name)).size !== options.vms.length) throw new Error('duplicate VM names');

  if (memory + SWITCH_MEMORY_MB > (options.maxMemoryMb ?? 7168))
    throw new Error(
      `lab needs ${memory + SWITCH_MEMORY_MB} MiB, more than the ${options.maxMemoryMb ?? 7168} MiB guard`,
    );

  const stop = async () => {
    const containers = (await docker(['ps', '-aq', '--filter', `label=${RUN_LABEL}=${runId}`]))
      .split('\n')
      .filter(Boolean);
    const vmContainers = options.vms.map((v) => `${prefix}-${v.name}`);

    // VM containers share the switch's network namespace: remove them first.
    await run('docker', ['rm', '-f', ...vmContainers]);

    if (containers.length) await run('docker', ['rm', '-f', ...containers]);

    const volumes = (await docker(['volume', 'ls', '-q', '--filter', `label=${RUN_LABEL}=${runId}`]))
      .split('\n')
      .filter(Boolean);

    if (volumes.length) await docker(['volume', 'rm', '-f', ...volumes]);
  };

  try {
    const start = Date.now();

    await docker([
      'run',
      '-d',
      '--name',
      switchName,
      ...labels,
      '--cap-add',
      'NET_ADMIN',
      '--device',
      '/dev/net/tun',
      '--sysctl',
      'net.ipv4.ip_forward=1',
      '--memory',
      `${SWITCH_MEMORY_MB}m`,
      image,
      'sleep',
      'infinity',
    ]);

    const switchScript = [
      'set -eu',
      'mkdir -p /lab /xfer',
      "ssh-keygen -q -t ed25519 -N '' -C vm-lab -f /lab/id_lab",
      ...siteNames.flatMap((s, i) => [
        `ip link add br-${i + 1} type bridge`,
        `ip addr add ${sites[s].gateway}/24 dev br-${i + 1}`,
        `ip link set br-${i + 1} up`,
        ...(options.interSiteDelayMs
          ? [`tc qdisc add dev br-${i + 1} root netem delay ${options.interSiteDelayMs}ms`]
          : []),
      ]),
      ...options.vms.flatMap((v, k) => [
        `ip tuntap add dev tap-${k} mode tap`,
        `ip link set tap-${k} master br-${siteNames.indexOf(v.site) + 1} up`,
      ]),
      'printf \'table ip lab {\\n chain post { type nat hook postrouting priority 100; oifname "eth0" masquerade; }\\n}\\n\' | nft -f -',
    ].join('\n');

    await docker(['exec', switchName, 'sh', '-c', switchScript]);

    const publicKey = await docker(['exec', switchName, 'cat', '/lab/id_lab.pub']);
    const dns = (
      await docker(['exec', switchName, 'sh', '-c', "awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf"])
    ).trim();
    const nameservers = dns && !dns.startsWith('127.') ? [dns] : [];
    const vms: Record<string, Vm> = {};
    const starts = new Map<string, number>();

    for (const [k, spec] of options.vms.entries()) {
      const siteIndex = siteNames.indexOf(spec.site);
      const hostIndex = options.vms.filter((v, j) => j < k && v.site === spec.site).length;
      const ip = `10.77.${siteIndex + 1}.${11 + hostIndex}`;
      const mac = `52:54:00:77:${(siteIndex + 1).toString(16).padStart(2, '0')}:${(k + 1).toString(16).padStart(2, '0')}`;
      const volume = `${prefix}-${spec.name}`;
      const userData = {
        hostname: spec.name,
        manage_etc_hosts: true,
        ssh_pwauth: false,
        users: [
          {
            name: 'lab',
            sudo: 'ALL=(ALL) NOPASSWD:ALL',
            shell: '/bin/bash',
            lock_passwd: true,
            ssh_authorized_keys: [publicKey],
          },
        ],
        ...(options.packages?.length ? { package_update: true, packages: options.packages } : {}),
      };
      const networkConfig = {
        version: 2,
        ethernets: {
          lan0: {
            match: { macaddress: mac },
            'set-name': 'lan0',
            addresses: [`${ip}/24`],
            routes: [{ to: 'default', via: sites[spec.site].gateway }],
            ...(nameservers.length ? { nameservers: { addresses: nameservers } } : {}),
          },
        },
      };

      await docker(['volume', 'create', ...labels, volume]);
      await docker(
        [
          'run',
          '-i',
          '--rm',
          ...labels,
          '-v',
          `${volume}:/d`,
          '-v',
          `${golden}:/golden:ro`,
          image,
          'sh',
          '-c',
          [
            'set -eu',
            'tar -C /d -xf -',
            'cd /d',
            'cloud-localds -N network-config seed.img user-data meta-data',
            `qemu-img create -q -f qcow2 -F qcow2 -b /golden/golden.qcow2 disk.qcow2 ${spec.rootDiskGb ?? 12}G`,
            ...(spec.dataDiskGb ? [`qemu-img create -q -f qcow2 data.qcow2 ${spec.dataDiskGb}G`] : []),
          ].join('\n'),
        ],
        {
          input: await tarFiles({
            'user-data': `#cloud-config\n${JSON.stringify(userData)}\n`,
            'meta-data': `instance-id: ${prefix}-${spec.name}\nlocal-hostname: ${spec.name}\n`,
            'network-config': `${JSON.stringify(networkConfig)}\n`,
          }),
        },
      );

      const memoryMb = spec.memoryMb ?? DEFAULT_MEMORY_MB;
      const container = `${prefix}-${spec.name}`;
      const startedAt = Date.now();

      await docker([
        'run',
        '-d',
        '--name',
        container,
        ...labels,
        '--network',
        `container:${switchName}`,
        '--cap-add',
        'NET_ADMIN',
        '--device',
        '/dev/kvm',
        '--device',
        '/dev/net/tun',
        '--memory',
        `${memoryMb + CONTAINER_OVERHEAD_MB}m`,
        '-v',
        `${volume}:/d`,
        '-v',
        `${golden}:/golden:ro`,
        '-w',
        '/d',
        image,
        'qemu-system-x86_64',
        '-enable-kvm',
        '-cpu',
        'host',
        '-smp',
        String(spec.cpus ?? 2),
        '-m',
        String(memoryMb),
        '-nographic',
        '-drive',
        'file=disk.qcow2,if=virtio,cache=none,aio=native,discard=unmap',
        ...(spec.dataDiskGb ? ['-drive', 'file=data.qcow2,if=virtio,cache=none,aio=native,discard=unmap'] : []),
        '-drive',
        'file=seed.img,if=virtio,format=raw,readonly=on',
        '-netdev',
        `tap,id=n0,ifname=tap-${k},script=no,downscript=no`,
        '-device',
        `virtio-net-pci,netdev=n0,mac=${mac}`,
        '-device',
        'virtio-rng-pci',
      ]);

      vms[spec.name] = createVm({
        name: spec.name,
        site: spec.site,
        ip,
        container,
        switchName,
        dataDisk: spec.dataDiskGb ? '/dev/vdb' : undefined,
        bootTimeoutMs: options.bootTimeoutMs ?? 180_000,
        disks: {
          image,
          volume,
          golden,
          labels,
          rootDiskGb: spec.rootDiskGb ?? 12,
          dataDiskGb: spec.dataDiskGb,
        },
      });
      starts.set(spec.name, startedAt);
    }

    await Promise.all(Object.values(vms).map((vm) => waitForSsh(vm as LabVm, starts.get(vm.name) ?? start)));
    // First boot: users, network and packages are in place once cloud-init is done.
    await Promise.all(Object.values(vms).map((vm) => vm.exec('cloud-init status --wait >/dev/null || true')));
    log(
      `VM lab ${runId} up in ${Math.round((Date.now() - start) / 1000)}s: ${Object.values(vms)
        .map((vm) => `${vm.name}@${vm.ip} (${vm.bootSeconds}s)`)
        .join(', ')}`,
    );

    return { run: runId, golden, vms, sites, stop };
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
}

interface LabVm extends Vm {
  readonly switchName: string;
  readonly bootTimeoutMs: number;
}

function createVm(init: {
  name: string;
  site: string;
  ip: string;
  container: string;
  switchName: string;
  dataDisk?: string;
  bootTimeoutMs: number;
  disks: { image: string; volume: string; golden: string; labels: string[]; rootDiskGb: number; dataDiskGb?: number };
}): LabVm {
  const ssh = (args: string[], options: ExecOptions & { input?: string } = {}) =>
    run('docker', ['exec', '-i', init.switchName, 'ssh', ...SSH_OPTIONS, `lab@${init.ip}`, ...args], {
      input: options.input,
      timeoutMs: options.timeoutMs ?? 600_000,
    });
  const scp = async (from: string, to: string) => {
    const result = await run('docker', ['exec', init.switchName, 'scp', '-q', ...SSH_OPTIONS, from, to]);

    if (result.code !== 0) throw new Error(`scp ${from} ${to} failed: ${result.stderr.trim()}`);
  };

  const vm: LabVm = {
    ...init,
    bootSeconds: 0,
    async execResult(script, options = {}) {
      return await ssh(['sudo', 'bash', '-s'], { ...options, input: `set -euo pipefail\n${script}\n` });
    },
    async exec(script, options = {}) {
      const result = await vm.execResult(script, options);

      if (result.code !== 0 && !options.allowFailure)
        throw new Error(
          `${init.name}: exit ${result.code}\n--- script\n${script}\n--- stderr\n${result.stderr.trim()}\n--- stdout\n${result.stdout.trim().slice(-2000)}`,
        );

      return result.stdout;
    },
    async copyIn(localPath, remotePath, mode = '0644') {
      const id = randomBytes(6).toString('hex');

      await docker(['cp', localPath, `${init.switchName}:/xfer/${id}`]);

      try {
        await scp(`/xfer/${id}`, `lab@${init.ip}:/tmp/${id}`);
        await vm.exec(`install -D -m ${mode} /tmp/${id} '${remotePath}' && rm -f /tmp/${id}`);
      } finally {
        await run('docker', ['exec', init.switchName, 'rm', '-f', `/xfer/${id}`]);
      }
    },
    async copyOut(remotePath, localPath) {
      const id = randomBytes(6).toString('hex');

      await vm.exec(`install -m 0600 -o lab '${remotePath}' /tmp/${id}`);

      try {
        await scp(`lab@${init.ip}:/tmp/${id}`, `/xfer/${id}`);
        await docker(['cp', `${init.switchName}:/xfer/${id}`, localPath]);
      } finally {
        await vm.exec(`rm -f /tmp/${id}`, { allowFailure: true });
        await run('docker', ['exec', init.switchName, 'rm', '-f', `/xfer/${id}`]);
      }
    },
    async reboot() {
      const bootId = (await vm.exec('cat /proc/sys/kernel/random/boot_id')).trim();
      const start = Date.now();

      await vm.exec('systemd-run --on-active=1s --timer-property=AccuracySec=100ms systemctl reboot >/dev/null');

      for (;;) {
        if (Date.now() - start > init.bootTimeoutMs) throw new Error(`${init.name} did not come back after reboot`);

        const result = await vm.execResult('cat /proc/sys/kernel/random/boot_id', { timeoutMs: 10_000 });

        if (result.code === 0 && result.stdout.trim() !== bootId) break;

        await sleep(1000);
      }

      vm.bootSeconds = Math.round((Date.now() - start) / 1000);
    },
    async crash() {
      await docker(['kill', init.container]);
    },
    async start() {
      const start = Date.now();

      await docker(['start', init.container]);
      await waitForSsh(vm, start);
    },
    async wipe() {
      await run('docker', ['kill', init.container]);
      await docker([
        'run',
        '--rm',
        ...init.disks.labels,
        '-v',
        `${init.disks.volume}:/d`,
        '-v',
        `${init.disks.golden}:/golden:ro`,
        init.disks.image,
        'sh',
        '-c',
        [
          'set -eu',
          'cd /d',
          'rm -f disk.qcow2 data.qcow2',
          `qemu-img create -q -f qcow2 -F qcow2 -b /golden/golden.qcow2 disk.qcow2 ${init.disks.rootDiskGb}G`,
          ...(init.disks.dataDiskGb ? [`qemu-img create -q -f qcow2 data.qcow2 ${init.disks.dataDiskGb}G`] : []),
        ].join('\n'),
      ]);

      const start = Date.now();

      await docker(['start', init.container]);
      await waitForSsh(vm, start);
      await vm.exec('cloud-init status --wait >/dev/null || true');
    },
  };

  return vm;
}

async function waitForSsh(vm: LabVm, start: number): Promise<void> {
  for (;;) {
    if ((await vm.execResult('true', { timeoutMs: 10_000 })).code === 0) {
      vm.bootSeconds = Math.round((Date.now() - start) / 1000);

      return;
    }

    const state = await run('docker', ['inspect', '-f', '{{.State.Running}} {{.State.OOMKilled}}', vm.container]);

    if (!state.stdout.startsWith('true')) {
      const logs = await run('docker', ['logs', '--tail', '40', vm.container]);

      throw new Error(`${vm.name}: QEMU container stopped (${state.stdout.trim()})\n${logs.stdout}${logs.stderr}`);
    }

    if (Date.now() - start > vm.bootTimeoutMs) throw new Error(`${vm.name}: no ssh after ${vm.bootTimeoutMs} ms`);

    await sleep(1500);
  }
}
