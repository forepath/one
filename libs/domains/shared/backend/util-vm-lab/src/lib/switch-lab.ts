import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hostImageId, imageArchive, loadedImageMarker } from './cache';
import { onLabExit } from './exit';
import { contentHash } from './images';
import { containersRunning, forgetKeptLab, keepDecision, labKeepEnabled, readKeptLab, writeKeptLab } from './keep';
import { ensureLabLocks } from './locks';
import { assertHostMemory, DEFAULT_VM_OVERHEAD_MB, planLabMemory } from './memory';
import { GUEST_NESTED_SCRIPT } from './nested';
import { switchVmAddress, switchVmQemuArgs } from './qemu-args';
import { docker, hostDockerEnv, run, type RunResult, sleep, tarFiles } from './process';
import { openDockerSocketTunnel, openTcpTunnel, type Tunnel } from './tunnel';

/**
 * Multi-VM lab ("switch" topology, from Loadweaver's M6 vm-lab): real VMs (QEMU/KVM inside containers) cloned from a
 * cached golden image.
 *
 * One small switch container owns a network namespace with one Linux bridge per site (gateway `.1`) and one
 * persistent tap per VM; it routes between the sites (optionally with netem delay) and NATs to the internet. Each VM
 * runs in its own container (own memory cgroup, `--network container:<switch>`), so it can be crashed / restarted
 * alone. The test process reaches the guests through ssh from inside the switch container. Every name carries a
 * per-run id, nothing is published on the host, and the subnets live inside the switch's own namespace, so nothing
 * clashes with the user's containers.
 */

export interface SwitchVmSpec {
  name: string;
  site: string;
  /** Guest RAM (explicit per VM; default `config.defaultMemoryMb`); the container gets this + the QEMU overhead. */
  memoryMb?: number;
  cpus?: number;
  /** Extra empty disk (e.g. for an LVM volume group), visible as `vm.dataDisk`. */
  dataDiskGb?: number;
  /** Root disk virtual size (the golden image is 12 GB). */
  rootDiskGb?: number;
  /** Expose vmx / svm (`-cpu host`, default) so microVMs / VMs run inside; false: an ordinary cloud VM. */
  nested?: boolean;
  /** Extra QEMU CPU flags (`-avx2`): a node whose CPU differs (CPU checks of live migration). */
  cpuFlags?: string[];
}

export interface SwitchLabOptions {
  vms: SwitchVmSpec[];
  /** Packages to install at first boot (needs internet through the switch's NAT). */
  packages?: string[];
  /** One-way delay added between sites (netem on the routed link). */
  interSiteDelayMs?: number;
  /** Guard for this machine (whole lab ≤ 7 GiB by default). */
  maxMemoryMb?: number;
  bootTimeoutMs?: number;
  log?: (line: string) => void;
  /**
   * Keep-alive key (development only, see keep.ts): with `LW_LAB_KEEP=1` the lab stays up after the run and the next
   * run with the same key and VM specs re-attaches to it. Without the env a kept lab of this key is removed first.
   */
  keep?: string;
}

export interface SwitchLabConfig {
  /** Name prefix of containers / volumes (`<prefix>-<run>-…`). */
  prefix: string;
  /** Label on everything (value `run`), cleanup by label. */
  label: string;
  /** Label carrying the run id. */
  runLabel: string;
  qemuImage: string;
  /** Golden volume (with `golden.qcow2`). */
  goldenVolume: string;
  defaultMemoryMb: number;
  overheadMb?: number;
  switchMemoryMb?: number;
  /** First two octets of the site subnets (`10.77` → `10.77.<site>.0/24`). */
  subnetPrefix?: string;
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
  readonly memoryMb: number;
  /** Whether the VM's CPU exposes vmx / svm (see `nestedKvm()` for the definitive check). */
  readonly nested: boolean;
  /** Block device of the data disk (`/dev/vdb`) if `dataDiskGb` was set. */
  readonly dataDisk?: string;
  /** Seconds from container start to ssh (last boot). */
  bootSeconds: number;
  /** Runs a bash script as root (`set -euo pipefail`); returns stdout, throws on failure. */
  exec(script: string, options?: ExecOptions): Promise<string>;
  execResult(script: string, options?: ExecOptions): Promise<RunResult>;
  copyIn(localPath: string, remotePath: string, mode?: string): Promise<void>;
  copyOut(remotePath: string, localPath: string): Promise<void>;
  /**
   * Loads a local Docker image into the guest: the archive from the lab cache (`imageArchive`, by image ID) streamed
   * straight into `docker load` over ssh (one pass, no copies on the switch or the guest disk).
   */
  loadImage(image: string): Promise<void>;
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
  /** `/dev/kvm` usable inside the VM (nested virtualization), with the reason when not. */
  nestedKvm(): Promise<{ ok: boolean; detail: string }>;
  /** Local unix socket bridged to the guest's Docker API (closed by `lab.stop()`). */
  dockerSocket(): Promise<string>;
  /** Local TCP port (127.0.0.1) forwarded to `host:port` inside the guest (closed by `lab.stop()`). */
  forward(port: number, host?: string): Promise<Tunnel>;
}

export interface SwitchLab {
  readonly run: string;
  readonly golden: string;
  readonly switchName: string;
  readonly vms: Record<string, Vm>;
  readonly sites: Record<string, { subnet: string; gateway: string }>;
  /** Total memory (MiB) the lab's containers may use. */
  readonly memoryMb: number;
  /** Re-attached to a kept lab (`LW_LAB_KEEP=1`): the VMs carry the state of the earlier run. */
  readonly attached: boolean;
  /** Stays up after `stop()` (`LW_LAB_KEEP=1` with a keep key). */
  readonly kept: boolean;
  /** Removes every container and volume of this run (the golden volume stays); a kept lab only closes its tunnels. */
  stop(): Promise<void>;
}

interface KeptVm {
  name: string;
  site: string;
  ip: string;
  container: string;
  memoryMb: number;
  nested: boolean;
  dataDisk?: string;
  bootTimeoutMs: number;
  disks: { image: string; volume: string; golden: string; labels: string[]; rootDiskGb: number; dataDiskGb?: number };
}

interface KeptSwitchLab {
  runId: string;
  switchName: string;
  sites: Record<string, { subnet: string; gateway: string }>;
  memoryMb: number;
  vms: KeptVm[];
}

/** What identifies a lab for re-attaching: the VM specs, packages, delay, golden and QEMU image. */
export function switchLabFingerprint(config: SwitchLabConfig, options: SwitchLabOptions): string {
  return contentHash(
    JSON.stringify({
      prefix: config.prefix,
      golden: config.goldenVolume,
      image: config.qemuImage,
      subnet: config.subnetPrefix ?? '10.77',
      vms: options.vms,
      packages: options.packages ?? [],
      delay: options.interSiteDelayMs ?? 0,
    }),
  );
}

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

/** Synchronous removal of a run's containers (VMs before the switch) and volumes: exit hook and `stop()`. */
export function removeRunSync(runLabel: string, runId: string): void {
  const env = hostDockerEnv();
  const ids = (filter: string[]) =>
    spawnSync('docker', filter, { encoding: 'utf8', env }).stdout?.split('\n').filter(Boolean) ?? [];
  const containers = ids(['ps', '-aq', '--filter', `label=${runLabel}=${runId}`]);
  const shared = containers.filter(
    (c) =>
      spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', c], { encoding: 'utf8', env })
        .stdout?.trim()
        .startsWith('container:') ?? false,
  );

  if (shared.length) spawnSync('docker', ['rm', '-f', ...shared], { env });

  const rest = ids(['ps', '-aq', '--filter', `label=${runLabel}=${runId}`]);

  if (rest.length) spawnSync('docker', ['rm', '-f', ...rest], { env });

  const volumes = ids(['volume', 'ls', '-q', '--filter', `label=${runLabel}=${runId}`]);

  if (volumes.length) spawnSync('docker', ['volume', 'rm', '-f', ...volumes], { env });
}

/** Boots the VMs of one lab run; call `stop()` in `afterAll` (the process exit removes them too). */
export async function startSwitchLab(config: SwitchLabConfig, options: SwitchLabOptions): Promise<SwitchLab> {
  const log = options.log ?? (() => undefined);
  const image = config.qemuImage;
  const golden = config.goldenVolume;
  const overheadMb = config.overheadMb ?? DEFAULT_VM_OVERHEAD_MB;
  const switchMemoryMb = config.switchMemoryMb ?? 128;
  const subnetPrefix = config.subnetPrefix ?? '10.77';
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const prefix = `${config.prefix}-${runId}`;
  const labels = ['--label', `${config.label}=run`, '--label', `${config.runLabel}=${runId}`];
  const switchName = `${prefix}-switch`;
  const siteNames = [...new Set(options.vms.map((v) => v.site))];
  const sites = Object.fromEntries(
    siteNames.map((s, i) => [s, { subnet: `${subnetPrefix}.${i + 1}.0/24`, gateway: `${subnetPrefix}.${i + 1}.1` }]),
  );

  for (const v of options.vms) if (!NAME.test(v.name)) throw new Error(`invalid VM name ${v.name}`);

  for (const s of siteNames) if (!NAME.test(s)) throw new Error(`invalid site name ${s}`);

  if (new Set(options.vms.map((v) => v.name)).size !== options.vms.length) throw new Error('duplicate VM names');

  const plan = planLabMemory(
    options.vms.map((v) => ({ name: v.name, memoryMb: v.memoryMb ?? config.defaultMemoryMb, overheadMb })),
    { maxMemoryMb: options.maxMemoryMb, switchMb: switchMemoryMb },
  );
  const keepKey = options.keep;
  const keep = Boolean(keepKey) && labKeepEnabled();
  const fingerprint = switchLabFingerprint(config, options);

  if (keepKey) {
    const state = readKeptLab<KeptSwitchLab>(keepKey);
    const running = state
      ? await containersRunning([state.data.switchName, ...state.data.vms.map((v) => v.container)])
      : false;
    const decision = keepDecision({ keep, state, fingerprint, running });

    if (decision === 'attach' && state) {
      await ensureLabLocks({ label: config.label, log });

      return await attachSwitchLab(state.data, log);
    }

    if (decision === 'replace' && state) {
      log(`removing the kept lab ${state.data.runId} (${keep ? 'changed or not running' : 'LW_LAB_KEEP is not set'})`);
      removeRunSync(config.runLabel, state.data.runId);
      forgetKeptLab(keepKey);
    }
  }

  assertHostMemory(plan.totalMb);
  await ensureLabLocks({ label: config.label, log });

  const workDir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const tunnels: Tunnel[] = [];
  let booted = false;
  const kept = () => keep && booted;
  const removeHook = onLabExit(() => {
    for (const t of tunnels.splice(0)) t.close();

    if (!kept()) removeRunSync(config.runLabel, runId);

    rmSync(workDir, { recursive: true, force: true });
  });

  const stop = async () => {
    for (const t of tunnels.splice(0)) t.close();

    if (kept()) {
      rmSync(workDir, { recursive: true, force: true });
      removeHook();
      log(`VM lab ${runId} kept (LW_LAB_KEEP=1, key ${keepKey}); the next run with this key re-attaches`);

      return;
    }

    const containers = (await docker(['ps', '-aq', '--filter', `label=${config.runLabel}=${runId}`]))
      .split('\n')
      .filter(Boolean);
    const vmContainers = options.vms.map((v) => `${prefix}-${v.name}`);

    // VM containers share the switch's network namespace: remove them first.
    await run('docker', ['rm', '-f', ...vmContainers], { env: hostDockerEnv() });

    if (containers.length) await run('docker', ['rm', '-f', ...containers], { env: hostDockerEnv() });

    const volumes = (await docker(['volume', 'ls', '-q', '--filter', `label=${config.runLabel}=${runId}`]))
      .split('\n')
      .filter(Boolean);

    if (volumes.length) await docker(['volume', 'rm', '-f', ...volumes]);

    rmSync(workDir, { recursive: true, force: true });
    removeHook();
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
      `${switchMemoryMb}m`,
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
    const keptVms: KeptVm[] = [];
    const starts = new Map<string, number>();

    for (const [k, spec] of options.vms.entries()) {
      const siteIndex = siteNames.indexOf(spec.site);
      const hostIndex = options.vms.filter((v, j) => j < k && v.site === spec.site).length;
      const { ip, mac } = switchVmAddress(subnetPrefix, siteIndex, hostIndex, k);
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

      const memoryMb = spec.memoryMb ?? config.defaultMemoryMb;
      const nested = spec.nested ?? true;
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
        `${memoryMb + overheadMb}m`,
        '-v',
        `${volume}:/d`,
        '-v',
        `${golden}:/golden:ro`,
        '-w',
        '/d',
        image,
        ...switchVmQemuArgs({
          memoryMb,
          cpus: spec.cpus ?? 2,
          nested,
          cpuFlags: spec.cpuFlags,
          tapIndex: k,
          mac,
          dataDisk: Boolean(spec.dataDiskGb),
        }),
      ]);

      const keptVm: KeptVm = {
        name: spec.name,
        site: spec.site,
        ip,
        container,
        memoryMb,
        nested,
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
      };

      keptVms.push(keptVm);
      vms[spec.name] = createVm({ ...keptVm, switchName, workDir, tunnels });
      starts.set(spec.name, startedAt);
    }

    await Promise.all(Object.values(vms).map((vm) => waitForSsh(vm as LabVm, starts.get(vm.name) ?? start)));
    // First boot: users, network and packages are in place once cloud-init is done.
    await Promise.all(Object.values(vms).map((vm) => vm.exec('cloud-init status --wait >/dev/null || true')));
    log(
      `VM lab ${runId} up in ${Math.round((Date.now() - start) / 1000)}s (${plan.totalMb} MiB): ${Object.values(vms)
        .map((vm) => `${vm.name}@${vm.ip} (${vm.bootSeconds}s${vm.nested ? ', nested' : ''})`)
        .join(', ')}`,
    );

    booted = true;

    if (keepKey && keep)
      writeKeptLab<KeptSwitchLab>(keepKey, fingerprint, {
        runId,
        switchName,
        sites,
        memoryMb: plan.totalMb,
        vms: keptVms,
      });

    return { run: runId, golden, switchName, vms, sites, memoryMb: plan.totalMb, attached: false, kept: keep, stop };
  } catch (error) {
    booted = false;
    await stop().catch(() => undefined);
    throw error;
  }
}

/** Re-attaches to a kept lab: the same containers, a fresh tunnel dir; `stop()` only closes the tunnels. */
async function attachSwitchLab(state: KeptSwitchLab, log: (line: string) => void): Promise<SwitchLab> {
  const workDir = mkdtempSync(join(tmpdir(), `vm-lab-attach-${state.runId}-`));
  const tunnels: Tunnel[] = [];
  const close = () => {
    for (const t of tunnels.splice(0)) t.close();

    rmSync(workDir, { recursive: true, force: true });
  };
  const removeHook = onLabExit(close);
  const vms: Record<string, Vm> = {};

  for (const kept of state.vms) vms[kept.name] = createVm({ ...kept, switchName: state.switchName, workDir, tunnels });

  await Promise.all(Object.values(vms).map((vm) => waitForSsh(vm as LabVm, Date.now())));
  log(
    `VM lab ${state.runId} re-attached (kept, LW_LAB_KEEP=1): ${Object.values(vms)
      .map((vm) => `${vm.name}@${vm.ip}`)
      .join(', ')}`,
  );

  return {
    run: state.runId,
    golden: state.vms[0]?.disks.golden ?? '',
    switchName: state.switchName,
    vms,
    sites: state.sites,
    memoryMb: state.memoryMb,
    attached: true,
    kept: true,
    stop: async () => {
      close();
      removeHook();
    },
  };
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
  memoryMb: number;
  nested: boolean;
  workDir: string;
  tunnels: Tunnel[];
  dataDisk?: string;
  bootTimeoutMs: number;
  disks: { image: string; volume: string; golden: string; labels: string[]; rootDiskGb: number; dataDiskGb?: number };
}): LabVm {
  const sshArgs = (remote: string[], interactive = true) => [
    'exec',
    ...(interactive ? ['-i'] : []),
    init.switchName,
    'ssh',
    ...SSH_OPTIONS,
    `lab@${init.ip}`,
    ...remote,
  ];
  const ssh = (args: string[], options: ExecOptions & { input?: string } = {}) =>
    run('docker', sshArgs(args), {
      input: options.input,
      timeoutMs: options.timeoutMs ?? 600_000,
      env: hostDockerEnv(),
    });
  const scp = async (from: string, to: string) => {
    const result = await run('docker', ['exec', init.switchName, 'scp', '-q', ...SSH_OPTIONS, from, to], {
      env: hostDockerEnv(),
    });

    if (result.code !== 0) throw new Error(`scp ${from} ${to} failed: ${result.stderr.trim()}`);
  };
  const { workDir, tunnels, disks, ...rest } = init;

  const vm: LabVm = {
    ...rest,
    disks,
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
        await run('docker', ['exec', init.switchName, 'rm', '-f', `/xfer/${id}`], { env: hostDockerEnv() });
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
        await run('docker', ['exec', init.switchName, 'rm', '-f', `/xfer/${id}`], { env: hostDockerEnv() });
      }
    },
    async loadImage(image) {
      const archive = await imageArchive(image);
      const result = await run('docker', sshArgs(['sudo', 'docker', 'load', '-q']), {
        inputFile: archive,
        timeoutMs: 15 * 60_000,
        env: hostDockerEnv(),
      });

      if (result.code !== 0) throw new Error(`${init.name}: docker load of ${image} failed: ${result.stderr.trim()}`);

      // The host's image ID, for "is the loaded image current?" checks (hot-swap of a kept lab).
      await vm.exec(
        `install -D -m 0644 /dev/null ${loadedImageMarker(image)} && echo ${await hostImageId(image)} > ${loadedImageMarker(image)}`,
      );
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
      await run('docker', ['kill', init.container], { env: hostDockerEnv() });
      await docker([
        'run',
        '--rm',
        ...disks.labels,
        '-v',
        `${disks.volume}:/d`,
        '-v',
        `${disks.golden}:/golden:ro`,
        disks.image,
        'sh',
        '-c',
        [
          'set -eu',
          'cd /d',
          'rm -f disk.qcow2 data.qcow2',
          `qemu-img create -q -f qcow2 -F qcow2 -b /golden/golden.qcow2 disk.qcow2 ${disks.rootDiskGb}G`,
          ...(disks.dataDiskGb ? [`qemu-img create -q -f qcow2 data.qcow2 ${disks.dataDiskGb}G`] : []),
        ].join('\n'),
      ]);

      const start = Date.now();

      await docker(['start', init.container]);
      await waitForSsh(vm, start);
      await vm.exec('cloud-init status --wait >/dev/null || true');
    },
    async nestedKvm() {
      const result = await vm.execResult(GUEST_NESTED_SCRIPT, { timeoutMs: 60_000 });

      return { ok: result.code === 0, detail: (result.stdout || result.stderr).trim() };
    },
    async dockerSocket() {
      const tunnel = await openDockerSocketTunnel(
        (remote) => sshArgs([remote]),
        join(workDir, `${init.name}-docker-${tunnels.length}.sock`),
      );

      tunnels.push(tunnel);

      return tunnel.address.slice('unix:'.length);
    },
    async forward(port, host = '127.0.0.1') {
      const tunnel = await openTcpTunnel((remote) => sshArgs([remote]), host, port);

      tunnels.push(tunnel);

      return tunnel;
    },
  } as LabVm;

  return vm;
}

async function waitForSsh(vm: LabVm, start: number): Promise<void> {
  for (;;) {
    if ((await vm.execResult('true', { timeoutMs: 10_000 })).code === 0) {
      vm.bootSeconds = Math.round((Date.now() - start) / 1000);

      return;
    }

    const state = await run('docker', ['inspect', '-f', '{{.State.Running}} {{.State.OOMKilled}}', vm.container], {
      env: hostDockerEnv(),
    });

    if (!state.stdout.startsWith('true')) {
      const logs = await run('docker', ['logs', '--tail', '40', vm.container], { env: hostDockerEnv() });

      throw new Error(`${vm.name}: QEMU container stopped (${state.stdout.trim()})\n${logs.stdout}${logs.stderr}`);
    }

    if (Date.now() - start > vm.bootTimeoutMs) throw new Error(`${vm.name}: no ssh after ${vm.bootTimeoutMs} ms`);

    await sleep(1500);
  }
}
