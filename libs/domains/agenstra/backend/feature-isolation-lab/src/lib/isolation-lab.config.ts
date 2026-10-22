/**
 * Pure configuration of the Agenstra E2E isolation lab: real QEMU/KVM virtual machines (running inside
 * Docker containers, nothing is installed on the developer host) prepared exactly like provisioned agent
 * manager hosts, so persistent gVisor, gVisor on KVM, the real egress guard and the real host scripts can
 * be exercised end to end. Everything here is side-effect free; the harness and the specs live under
 * `src/integration` and only run through the explicit `isolation-lab` target.
 */

/** Docker label marking every lab container / volume / image (`run`, `golden` or `image`). */
export const ISOLATION_LAB_LABEL = 'io.agenstra.isolation-lab';
/** Name prefix of lab containers and volumes. */
export const ISOLATION_LAB_PREFIX = 'agenstra-isolation-lab';

/** Pinned Ubuntu 22.04 cloud image (the image the Agenstra providers provision agent manager hosts with). */
export const ISOLATION_LAB_UBUNTU_IMAGE = {
  release: '20261020',
  url: 'https://cloud-images.ubuntu.com/releases/jammy/release-20261020/ubuntu-22.04-server-cloudimg-amd64.img',
  sha256: '2099e63da0b822ef8e05e3d596c1b402eaaae658fc08ab919cb8495bfcdc488b',
} as const;

/** Pinned base image of the QEMU container (Debian 13 slim). */
export const ISOLATION_LAB_QEMU_BASE_IMAGE =
  'debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad';

/** Docker network the lab creates inside the VM as the agent network (`AGENT_DOCKER_NETWORK`). */
export const ISOLATION_LAB_AGENT_NETWORK = 'agenstra-lab-net';

/** Isolation levels exercised by the lab, weakest first. */
export const ISOLATION_LAB_LEVELS = ['standard', 'sandboxed', 'sandboxed-kvm'] as const;
export type IsolationLabLevel = (typeof ISOLATION_LAB_LEVELS)[number];

/** Network topology of a worker: default bridge, user-defined agent network, or behind an egress guard. */
export type IsolationLabTopology = 'bridge' | 'agent-network' | 'guard';

/** Egress guard modes exercised behind a guard. */
export const ISOLATION_LAB_GUARD_MODES = ['off', 'monitor', 'enforce', 'offline'] as const;
export type IsolationLabGuardMode = (typeof ISOLATION_LAB_GUARD_MODES)[number];

export interface IsolationLabScenario {
  level: IsolationLabLevel;
  topology: IsolationLabTopology;
  /** Guard mode (only for the `guard` topology). */
  mode?: IsolationLabGuardMode;
  /** Docker runtime the worker must end up on (after the manager's network mapping). */
  expectedRuntime: string;
}

const NETSTACK_RUNTIME: Readonly<Record<IsolationLabLevel, string>> = {
  standard: 'runc',
  sandboxed: 'runsc-systrap',
  'sandboxed-kvm': 'runsc-kvm',
};

const KERNEL_STACK_RUNTIME: Readonly<Record<IsolationLabLevel, string>> = {
  standard: 'runc',
  sandboxed: 'runsc-systrap-hostnet',
  'sandboxed-kvm': 'runsc-kvm-hostnet',
};

/**
 * Runtime a worker of a level must run on in a topology: gVisor workers in a guard namespace or on a
 * user-defined network need the kernel network stack variant (Netstack would bypass the guard and
 * Docker's embedded DNS); only the default bridge keeps Netstack.
 */
export function expectedLabRuntime(level: IsolationLabLevel, topology: IsolationLabTopology): string {
  return topology === 'bridge' ? NETSTACK_RUNTIME[level] : KERNEL_STACK_RUNTIME[level];
}

/** Every networking scenario of the lab (level x topology x guard mode). */
export function buildIsolationLabScenarios(
  levels: readonly IsolationLabLevel[] = ISOLATION_LAB_LEVELS,
): IsolationLabScenario[] {
  return levels.flatMap((level) => [
    { level, topology: 'bridge' as const, expectedRuntime: expectedLabRuntime(level, 'bridge') },
    { level, topology: 'agent-network' as const, expectedRuntime: expectedLabRuntime(level, 'agent-network') },
    ...ISOLATION_LAB_GUARD_MODES.map((mode) => ({
      level,
      topology: 'guard' as const,
      mode,
      expectedRuntime: expectedLabRuntime(level, 'guard'),
    })),
  ]);
}

export interface IsolationLabVmOptions {
  /** Guest memory (default 3072 MiB). */
  memoryMb?: number;
  /** Guest vCPUs (default 2). */
  cpus?: number;
  /**
   * Expose hardware virtualization (vmx / svm) to the guest (nested KVM). `false` simulates an ordinary
   * cloud VM without nested virtualization (the sandboxed-kvm level must then be unsupported).
   */
  exposeVirtualization?: boolean;
}

/** QEMU arguments of a lab VM (disk, seed and SSH forwarding inside the VM's container). */
export function buildIsolationLabQemuArgs(
  options: IsolationLabVmOptions & { diskPath: string; seedPath: string; serialPath: string; sshPort: number },
): string[] {
  const memoryMb = options.memoryMb ?? 3072;
  const cpus = options.cpus ?? 2;

  if (!Number.isInteger(memoryMb) || memoryMb < 1024 || memoryMb > 16384) {
    throw new Error(`Invalid lab VM memory: ${memoryMb}`);
  }

  if (!Number.isInteger(cpus) || cpus < 1 || cpus > 8) {
    throw new Error(`Invalid lab VM cpus: ${cpus}`);
  }

  if (!Number.isInteger(options.sshPort) || options.sshPort < 1024 || options.sshPort > 65535) {
    throw new Error(`Invalid lab VM ssh port: ${options.sshPort}`);
  }

  return [
    '-machine',
    'q35,accel=kvm',
    '-cpu',
    options.exposeVirtualization === false ? 'host,-vmx,-svm' : 'host',
    '-m',
    String(memoryMb),
    '-smp',
    String(cpus),
    '-display',
    'none',
    '-monitor',
    'none',
    '-serial',
    `file:${options.serialPath}`,
    '-drive',
    // writeback / threads: no O_DIRECT requirement on the Docker volume's filesystem.
    `file=${options.diskPath},if=virtio,format=qcow2,cache=writeback,aio=threads`,
    '-drive',
    `file=${options.seedPath},if=virtio,format=raw,readonly=on`,
    '-netdev',
    `user,id=net0,hostfwd=tcp:127.0.0.1:${options.sshPort}-:22`,
    '-device',
    'virtio-net-pci,netdev=net0',
  ];
}

/** Serial console marker the golden provisioning prints once Docker works (checked by the build). */
export const ISOLATION_LAB_GOLDEN_MARKER = 'AGENSTRA_ISOLATION_LAB_GOLDEN_OK';

/** cloud-init of the golden image: Docker installed exactly like the Agenstra providers do, no gVisor. */
export function buildIsolationLabGoldenUserData(): string {
  return `#cloud-config
package_update: true
packages:
  - ca-certificates
  - curl
  - jq
runcmd:
  - [bash, -c, "curl -fsSL https://get.docker.com | sh"]
  - [systemctl, enable, docker]
  - [systemctl, start, docker]
  - [bash, -c, "docker pull -q hello-world && docker pull -q python:3.12-alpine && docker pull -q alpine:3.20"]
  - [bash, -c, "docker version --format '{{.Server.Version}}' > /etc/agenstra-isolation-lab-golden.docker-version"]
  - [bash, -c, "docker run --rm --network=none hello-world >/dev/null && printf '%s_%s\\n' ${ISOLATION_LAB_GOLDEN_MARKER.replace(/_OK$/, '')} OK > /dev/ttyS0"]
  - [cloud-init, clean, --logs]
power_state:
  mode: poweroff
  timeout: 60
  condition: true
`;
}

/** Per-run cloud-init (instance) of a lab VM: SSH access with a per-run key for the test process. */
export function buildIsolationLabRunUserData(options: { hostname: string; sshPublicKey: string }): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.hostname)) {
    throw new Error(`Invalid lab VM hostname: ${options.hostname}`);
  }

  if (!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+( [^\n]*)?$/.test(options.sshPublicKey.trim())) {
    throw new Error('Invalid lab SSH public key');
  }

  return `#cloud-config
hostname: ${options.hostname}
users:
  - name: lab
    groups: [docker, sudo]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    lock_passwd: true
    ssh_authorized_keys:
      - ${options.sshPublicKey.trim()}
ssh_pwauth: false
`;
}
