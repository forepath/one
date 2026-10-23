import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  docker,
  dockerOk,
  eventually,
  nestedDecision,
  readNestedReport,
  requireLocalImage,
  type Vm,
} from '@forepath/shared/backend/util-vm-lab';
import {
  volumeAssignmentSchema,
  workloadSpecSchema,
  type VolumeAssignment,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
} from '@forepath/loadweaver/shared/util-pki';

import { GOLDEN_PINS } from '../golden';

/**
 * Helpers of the M7 VM-lab specs (isolation levels, microVMs, full VMs, consoles, QEMU live migration): the
 * prerequisite images (built by the gate, never by a spec), the node driver (`m7-agent.entry.ts`) and protocol
 * fixtures. Nested KVM: lab VMs run with `-cpu host`; specs that need `/dev/kvm` inside them use `nestedDescribe` /
 * `requireNested` (skipped with the reason when the host can't nest; `VM_LAB_REQUIRE_NESTED=1` fails instead).
 */

/** Protocol / API payloads, checked per spec. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

const BUNDLES = join(tmpdir(), 'lw-vmlab');

/** The node driver (real `NodeAgentModule`, control API on a unix socket), see m7-agent.entry.ts. */
export const M7_AGENT_BUNDLE = join(BUNDLES, 'm7-agent.js');
/** The real agent with the cluster specs' lab reconciler, see m7-cluster-agent.entry.ts. */
export const M7_CLUSTER_AGENT_BUNDLE = join(BUNDLES, 'm7-cluster-agent.js');
/** The Loadweaver CLI (apps/loadweaver/cli), bundled for the guests' Node.js (`vm-image push`). */
export const CLI_BUNDLE = join(BUNDLES, 'loadweaver-cli.js');

/** The microVM launcher of this tree (`nx run shared-microvm-launcher:container-image`, test configuration). */
export const LAUNCHER_IMAGE =
  process.env['VM_LAB_LAUNCHER_IMAGE'] ?? 'registry.forenet.internal/forepath/microvm-launcher:test';
/** The control plane of this tree (as for the DR drill: `api-container-image`, tagged `…:dr-lab`). */
export const CP_IMAGE = process.env['VM_LAB_CP_IMAGE'] ?? 'loadweaver-control-plane-api:dr-lab';
/** Agenstra's lab microVM worker (bundled launcher image; built by the isolation lab's `buildLabMicrovmImages`). */
export const AGENSTRA_MICROVM_IMAGE =
  process.env['VM_LAB_AGENSTRA_MICROVM_IMAGE'] ?? 'agenstra-isolation-lab-microvm:local';
/** Agenstra's lab worker for the container levels (small Debian, `agent` user). */
export const AGENSTRA_WORKER_IMAGE =
  process.env['VM_LAB_AGENSTRA_WORKER_IMAGE'] ?? 'agenstra-isolation-lab-microvm-guest:local';
export const BUSYBOX = GOLDEN_PINS.busyboxImage;
/** Lab registry (TLS with a lab CA) for VM image artifacts and containerDisks, on vm1. */
export const LAB_REGISTRY_IMAGE = 'docker.io/library/registry:3.0.0';
export const LAB_REGISTRY_PORT = 5443;

export const AGENT_PATH = '/opt/loadweaver/m7-agent.js';
export const CONTROL_SOCKET = '/run/lw-m7-lab.sock';
export const STATE_DIR = '/var/lib/loadweaver';
export const LAB_CA_FILE = '/etc/loadweaver/lab-ca.crt';
const START_SCRIPT = '/etc/loadweaver/lw-m7-start.sh';

export const log = (line: string) => process.stderr.write(`[vm-lab] ${line}\n`);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { eventually };

/** The spec's `describe`, or `describe.skip` (with the reason printed) when the lab host can't nest KVM. */
export function nestedDescribe(scenario: string): jest.Describe {
  const decision = nestedDecision(readNestedReport(), scenario);

  if (decision.run) return describe;

  process.stderr.write(`[vm-lab] SKIPPED: ${decision.reason}\n`);

  return describe.skip;
}

/**
 * The definitive per-VM check (`/dev/kvm` inside the lab VM). False (with a printed reason) when nesting doesn't work
 * here and the run allows it; throws with `VM_LAB_REQUIRE_NESTED=1`.
 */
export async function requireNested(vm: Vm, scenario: string): Promise<boolean> {
  const result = await vm.nestedKvm();

  if (result.ok) return true;

  const reason = `${scenario}: ${vm.name} has no usable nested KVM (${result.detail})`;

  if (process.env['VM_LAB_REQUIRE_NESTED'] === '1') throw new Error(reason);

  process.stderr.write(`[vm-lab] SKIPPED: ${reason}\n`);

  return false;
}

/** Checks that the gate built the images this spec needs (the spec never builds them). */
export async function requireImages(images: Record<string, string>): Promise<void> {
  for (const [image, how] of Object.entries(images)) await requireLocalImage(image, how);
}

export const IMAGE_HINTS: Record<string, string> = {
  [LAUNCHER_IMAGE]: 'npx nx run shared-microvm-launcher:container-image (test configuration)',
  [CP_IMAGE]:
    'npx nx run loadweaver-backend-control-plane:api-container-image, then docker tag ghcr.io/forepath/loadweaver-control-plane-api:latest loadweaver-control-plane-api:dr-lab',
  [AGENSTRA_MICROVM_IMAGE]:
    "the Agenstra isolation lab builds it (buildLabMicrovmImages in feature-isolation-lab's harness/microvm.ts)",
  [AGENSTRA_WORKER_IMAGE]: 'the Agenstra isolation lab builds it (buildLabMicrovmImages, the lab guest image)',
};

const saved = new Map<string, string>();

/** Loads local images into a VM (`docker save` once per run, `docker load` in the guest). */
export async function loadImages(vm: Vm, images: readonly string[]): Promise<void> {
  mkdirSync(join(BUNDLES, 'images'), { recursive: true });

  for (const image of images) {
    let archive = saved.get(image);

    if (!archive || !existsSync(archive)) {
      archive = join(BUNDLES, 'images', `${createHash('sha256').update(image).digest('hex').slice(0, 16)}.tar`);
      await docker(['save', '-o', archive, image], { timeoutMs: 900_000 });
      saved.set(image, archive);
    }

    const remote = `/var/tmp/${randomBytes(4).toString('hex')}.tar`;

    await vm.copyIn(archive, remote);
    await vm.exec(`docker load -q -i ${remote} >/dev/null && rm -f ${remote}`, { timeoutMs: 900_000 });
  }
}

/** Whether an image exists on the lab host (for optional parts). */
export async function hasLocalImage(image: string): Promise<boolean> {
  return await dockerOk(['image', 'inspect', image]);
}

// Node driver.

export interface DriverMessage {
  seq: number;
  type: string;
  channel?: string;
  payload: Json;
}

/** The test's control-plane side of one node: the control API of m7-agent.entry.ts on the node's unix socket. */
export class NodeDriver {
  private seen = 0;

  constructor(readonly vm: Vm) {}

  async api<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 600_000): Promise<T> {
    const out = await this.vm.exec(
      body === undefined
        ? `curl -sS --max-time ${Math.ceil(timeoutMs / 1000)} --unix-socket ${CONTROL_SOCKET} -X ${method} http://lab${path}`
        : `curl -sS --max-time ${Math.ceil(timeoutMs / 1000)} --unix-socket ${CONTROL_SOCKET} -X ${method} -H 'Content-Type: application/json' --data-binary @- http://lab${path} <<'LWEOF'\n${JSON.stringify(body)}\nLWEOF`,
      { timeoutMs: timeoutMs + 30_000 },
    );
    const parsed = JSON.parse(out) as T & { error?: string };

    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error)
      throw new Error(`${this.vm.name} ${method} ${path}: ${parsed.error}`);

    return parsed;
  }

  isolation(fresh = false) {
    return this.api<IsolationReportLike>('GET', `/isolation${fresh ? '?fresh=1' : ''}`);
  }

  host(settings: { kvm?: 'auto' | 'disabled'; probeNonce?: string }) {
    return this.api('POST', '/host', settings);
  }

  capabilities() {
    return this.api<Record<string, Json>>('GET', '/capabilities');
  }

  apply(input: { workloads: WorkloadSpec[]; volumes?: VolumeAssignment[]; network?: unknown; dnsServers?: string[] }) {
    return this.api<{ changed: boolean }>('POST', '/apply', { node: this.vm.name, ...input });
  }

  status() {
    return this.api<{ workloads: Array<Record<string, Json>> }>('GET', '/status');
  }

  vmMessage(type: 'vmPower' | 'vmImageImport', payload: unknown) {
    return this.api('POST', '/vm', { type, payload });
  }

  migration(type: string, payload: unknown) {
    return this.api('POST', '/migration', { type, payload });
  }

  live(op: 'terminal' | 'input' | 'resize' | 'close' | 'console' | 'file', channel: string, payload?: unknown) {
    return this.api('POST', '/live', { op, channel, payload });
  }

  messages(since = 0) {
    return this.api<DriverMessage[]>('GET', `/messages?since=${since}`);
  }

  /** Waits for the next agent message matching `predicate` (after the last one this driver returned). */
  async waitMessage(
    what: string,
    predicate: (m: DriverMessage) => boolean,
    timeoutMs = 120_000,
  ): Promise<DriverMessage> {
    const found = await eventually(
      `${this.vm.name}: ${what}`,
      async () => (await this.messages(this.seen)).find(predicate),
      timeoutMs,
      500,
    );

    this.seen = found.seq;

    return found;
  }

  /** All messages of a live channel so far, with base64 output decoded. */
  async channelOutput(channel: string): Promise<{ text: string; exitCode: number | null; messages: DriverMessage[] }> {
    const all = (await this.messages(0)).filter((m) => m.channel === channel);
    const text = all
      .filter((m) => m.type === 'execOutput')
      .map((m) => Buffer.from(String(m.payload.data ?? ''), 'base64').toString('utf8'))
      .join('');
    const exit = all.find((m) => m.type === 'execExit');

    return { text, exitCode: exit ? (exit.payload.code ?? -1) : null, messages: all };
  }

  /** Runs a command in a replica through the live path (machine exec, no TTY) and returns its output. */
  async exec(replica: string, command: string[], options: { user?: string; env?: string[] } = {}) {
    const channel = `exec:${randomBytes(6).toString('hex')}`;

    await this.live('terminal', channel, {
      target: { kind: 'replica', replica },
      command,
      cols: 80,
      rows: 24,
      tty: false,
      ...(options.user ? { user: options.user } : {}),
      ...(options.env ? { env: options.env } : {}),
    });

    return await eventually(
      `${this.vm.name}: exec ${command.join(' ')} in ${replica}`,
      async () => {
        const out = await this.channelOutput(channel);

        return out.exitCode === null ? undefined : out;
      },
      120_000,
      500,
    );
  }

  /** One file-browser request (live path) and its `fileResponse`. */
  async file(request: Record<string, unknown>): Promise<Record<string, Json>> {
    const channel = `file:${randomBytes(6).toString('hex')}`;

    await this.live('file', channel, request);

    return (
      await eventually(
        `${this.vm.name}: file ${String(request['op'])}`,
        async () => (await this.messages(0)).find((m) => m.channel === channel && m.type === 'fileResponse'),
        60_000,
        300,
      )
    ).payload;
  }

  /** The replica's launcher / container id on this node. */
  async containerOf(replica: string): Promise<string> {
    return (
      await this.vm.exec(`docker ps -aq --no-trunc --filter label=loadweaver.com/workload=${replica} | head -n1`)
    ).trim();
  }
}

export interface IsolationLevelReport {
  state: string;
  reasonCode?: string;
  reason?: string;
}

export interface IsolationReportLike {
  checkedAt: string;
  bootId?: string;
  levels: Record<'runc' | 'sandboxed' | 'sandboxed-kvm' | 'microvm', IsolationLevelReport>;
  runtimes: string[];
  kvm?: { usable?: boolean; optOut?: boolean; [key: string]: unknown };
  cpuFlagsHash?: string;
  dockerRuntimes: Record<string, unknown>;
  microvm?: { launcherDigest: string; unpackCache: boolean; thinPool: boolean };
}

export interface DriverOptions {
  /** Peers for the transfer endpoint / firewall (migration specs). */
  peers?: Vm[];
  /** Node certificates (from `labCertificates`). */
  certs?: { key: string; cert: string; ca: string };
  /** `{ "<secret ref>": "<value>" }` for cloud-init user data and secret mounts. */
  secrets?: Record<string, string>;
  /** Thin pool on the data disk (volumes, VM disks, microVM writable layers on thin LVs). */
  storage?: boolean;
  /** Lab CA for the lab registry (VM images over HTTPS). */
  labCa?: string;
}

/** Copies the driver into the VM, prepares its state directory and storage and starts it (`systemd-run lw-m7`). */
export async function startNodeDriver(vm: Vm, options: DriverOptions = {}): Promise<NodeDriver> {
  const identity = {
    clusterId: 'lab',
    nodeName: vm.name,
    controlPlaneUrl: 'https://cp.lab',
    controlPlaneEndpoints: [],
  };
  const applied = {
    network: {
      addresses: [vm.ip],
      wireguard: (options.peers ?? []).map((peer) => ({ peer: peer.name, peerAddresses: [peer.ip] })),
    },
  };

  await vm.copyIn(M7_AGENT_BUNDLE, AGENT_PATH);
  await vm.exec(
    [
      `install -d -m 0700 ${STATE_DIR} /etc/loadweaver`,
      `echo '${JSON.stringify(identity)}' > ${STATE_DIR}/identity.json`,
      `echo '${JSON.stringify(applied)}' > ${STATE_DIR}/applied-state.json`,
      ...(options.certs
        ? [
            `cat > ${STATE_DIR}/node.key <<'EOF'\n${options.certs.key.trim()}\nEOF`,
            `cat > ${STATE_DIR}/node.crt <<'EOF'\n${options.certs.cert.trim()}\nEOF`,
            `cat > ${STATE_DIR}/ca.crt <<'EOF'\n${options.certs.ca.trim()}\nEOF`,
            `chmod 0600 ${STATE_DIR}/node.key`,
          ]
        : []),
      "printf '%s' lab-volume-key-0123456789abcdef > /etc/loadweaver/lab-volume.key",
      `cat > /etc/loadweaver/lab-secrets.json <<'EOF'\n${JSON.stringify(options.secrets ?? {})}\nEOF`,
      'chmod 0600 /etc/loadweaver/lab-volume.key /etc/loadweaver/lab-secrets.json',
      ...(options.labCa ? [`cat > ${LAB_CA_FILE} <<'EOF'\n${options.labCa.trim()}\nEOF`] : []),
      ...(options.storage && vm.dataDisk
        ? [
            `pvs ${vm.dataDisk} >/dev/null 2>&1 || { pvcreate -q ${vm.dataDisk} && vgcreate -q loadweaver ${vm.dataDisk}; }`,
            'lvs loadweaver/pool >/dev/null 2>&1 || lvcreate -q -l 90%FREE -T loadweaver/pool',
            'modprobe drbd',
          ]
        : []),
      // The start script survives reboots (the transient unit doesn't): restartNodeDriver runs it again.
      `cat > ${START_SCRIPT} <<'EOF'\n${[
        '#!/bin/bash',
        'systemctl stop lw-m7 2>/dev/null; systemctl reset-failed lw-m7 2>/dev/null',
        'modprobe drbd 2>/dev/null || true',
        'sysctl -qw net.ipv4.ip_forward=1',
        `rm -f ${CONTROL_SOCKET}`,
        `systemd-run --unit lw-m7 -E LOADWEAVER_STATE_DIR=${STATE_DIR} -E LOADWEAVER_MICROVM_LAUNCHER_IMAGE=${LAUNCHER_IMAGE} ` +
          `${options.labCa ? `-E NODE_EXTRA_CA_CERTS=${LAB_CA_FILE} ` : ''}node ${AGENT_PATH} serve`,
      ].join('\n')}\nEOF`,
      `chmod 0700 ${START_SCRIPT} && ${START_SCRIPT}`,
    ].join('\n'),
  );
  await eventually(
    `${vm.name} node driver`,
    async () => ((await vm.exec(`test -S ${CONTROL_SOCKET} && echo ok || true`)).includes('ok') ? true : undefined),
    120_000,
  );

  return new NodeDriver(vm);
}

/** (Re)starts the driver — after a reboot, a crash or a kill (agent restart: recovered sessions, re-read state). */
export async function restartNodeDriver(vm: Vm): Promise<void> {
  await vm.exec(START_SCRIPT);
  await eventually(
    `${vm.name} node driver restarted`,
    async () => ((await vm.exec(`test -S ${CONTROL_SOCKET} && echo ok || true`)).includes('ok') ? true : undefined),
    120_000,
  );
}

/** Node certificates from a lab CA, as the control plane issues them at join (URI SAN identity). */
export async function labCertificates(vms: Vm[]): Promise<Record<string, { key: string; cert: string; ca: string }>> {
  const ca = await createCertificateAuthority({ commonName: 'lab', validityDays: 1 });
  const result: Record<string, { key: string; cert: string; ca: string }> = {};

  for (const vm of vms) {
    const keys = await generateKeyPair();
    const cert = await issueCertificate({
      ca,
      csrPem: await createCsr(keys, vm.name),
      clusterId: 'lab',
      kind: 'node',
      name: vm.name,
      validityHours: 6,
    });

    result[vm.name] = { key: keys.privateKeyPem, cert: cert.certificatePem, ca: ca.certificatePem };
  }

  return result;
}

/** The driver's journal tail (diagnostics in failures). */
export async function driverJournal(vm: Vm, lines = 120): Promise<string> {
  return await vm.exec(`journalctl -u lw-m7 --no-pager -n ${lines} 2>&1 | tail -n ${lines}`, { allowFailure: true });
}

// Fixtures.

/** A workload spec with the defaults the control plane fills in. */
export function workload(overrides: Partial<WorkloadSpec> & Pick<WorkloadSpec, 'id' | 'addresses'>): WorkloadSpec {
  const [project, deployment, service] = overrides.id.split('/');

  return workloadSpecSchema.parse({
    project,
    deployment,
    service,
    kind: 'service',
    image: BUSYBOX,
    command: ['sleep', '1000000'],
    environment: {},
    labels: {},
    dnsSearch: [],
    runtime: 'runc',
    resources: { cpuMillis: 100, memoryBytes: 64 * 1024 ** 2 },
    restart: 'always',
    stopGracePeriodMs: 5_000,
    init: false,
    readOnly: false,
    privileged: false,
    capAdd: [],
    capDrop: [],
    ulimits: {},
    extraHosts: [],
    volumes: [],
    secrets: [],
    specHash: randomBytes(8).toString('hex'),
    ...overrides,
  });
}

/** A replicated volume on the given nodes (DRBD protocol C), primary on `primary`. */
export function volume(
  id: string,
  nodes: Vm[],
  primary: Vm,
  options: {
    minor: number;
    port: number;
    sizeBytes: number;
    block?: { digest: string; format: 'qcow2' | 'raw' } | true;
  },
): VolumeAssignment {
  const [project, deployment, name] = id.split('/');

  return volumeAssignmentSchema.parse({
    id,
    dockerName: `lw-vol-${id.replace(/\//g, '.')}`,
    minor: options.minor,
    port: options.port,
    sizeBytes: options.sizeBytes,
    replicas: nodes.map((vm, i) => ({ node: vm.name, nodeId: i, address: vm.ip })),
    connections: nodes.slice(1).map((vm) => ({ a: nodes[0].name, b: vm.name, protocol: 'C' })),
    primary: primary.name,
    keyRef: `secret://${project}/lw-volume-${deployment}.${name}`,
    ...(options.block ? { mode: 'block', ...(options.block === true ? {} : { initializeFrom: options.block }) } : {}),
  });
}

/** Pod network input of the driver's `/apply` (the node's pod subnet, as the compiler originates it). */
export function podNetwork(subnet: string): unknown {
  return { bgp: { originate: [subnet] } };
}

// Registry images (for generic microVM guest roots).

export interface InspectedLayer {
  digest: string;
  diffId: string;
  size: number;
  mediaType: string;
}

export interface InspectedImage {
  /** `<repo>@sha256:…` (the platform manifest). */
  pinned: string;
  layers: InspectedLayer[];
  process: {
    entrypoint: string[];
    cmd: string[];
    env: string[];
    user: string;
    workingDir: string;
    stopSignal: string;
  };
  labels: Record<string, string>;
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/**
 * Inspects a public Docker Hub image for `arch` the way the control plane's image resolver does (platform manifest,
 * layers with diff ids, process config), from the test process (anonymous pull token).
 */
export async function inspectHubImage(reference: string, arch: 'amd64' | 'arm64' = 'amd64'): Promise<InspectedImage> {
  const match = /^(?:docker\.io\/)?(?:library\/)?([a-z0-9._/-]+?)(?::([\w.-]+))?$/.exec(reference);

  if (!match) throw new Error(`unsupported reference ${reference}`);

  const repository = match[1].includes('/') ? match[1] : `library/${match[1]}`;
  const tag = match[2] ?? 'latest';
  const token = (
    (await (
      await fetch(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`)
    ).json()) as { token: string }
  ).token;
  const get = async (path: string, accept = MANIFEST_ACCEPT) => {
    const res = await fetch(`https://registry-1.docker.io/v2/${repository}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept },
    });

    if (!res.ok) throw new Error(`${reference}: GET ${path} HTTP ${res.status}`);

    return { json: (await res.json()) as Json, digest: res.headers.get('docker-content-digest') ?? '' };
  };
  let manifest = await get(`manifests/${tag}`);

  if (Array.isArray(manifest.json.manifests)) {
    const child = (
      manifest.json.manifests as Array<{ digest: string; platform?: { architecture: string; os: string } }>
    ).find((m) => m.platform?.os === 'linux' && m.platform.architecture === arch);

    if (!child) throw new Error(`${reference} has no linux/${arch} variant`);

    manifest = await get(`manifests/${child.digest}`);
    manifest.digest = child.digest;
  }

  const config = (await get(`blobs/${manifest.json.config.digest}`, '*/*')).json as {
    config?: Record<string, Json>;
    rootfs: { diff_ids: string[] };
  };
  const c = config.config ?? {};

  return {
    pinned: `docker.io/${repository}@${manifest.digest}`,
    layers: (manifest.json.layers as Array<{ digest: string; size: number; mediaType: string }>).map((l, i) => ({
      digest: l.digest,
      diffId: config.rootfs.diff_ids[i],
      size: l.size,
      mediaType: l.mediaType,
    })),
    process: {
      entrypoint: c['Entrypoint'] ?? [],
      cmd: c['Cmd'] ?? [],
      env: c['Env'] ?? [],
      user: c['User'] ?? '',
      workingDir: c['WorkingDir'] || '/',
      stopSignal: c['StopSignal'] ?? 'SIGTERM',
    },
    labels: c['Labels'] ?? {},
  };
}

/** A generic microVM replica of an inspected image (what `compileMicrovm` emits; `image` = the launcher). */
export function genericMicrovm(
  overrides: Partial<WorkloadSpec> & Pick<WorkloadSpec, 'id' | 'addresses'>,
  image: InspectedImage,
  options: {
    process?: Partial<InspectedImage['process']>;
    memoryMiB?: number;
    vcpus?: number;
    rootfsBytes?: number;
    platformLayers?: Partial<Record<'amd64' | 'arm64', InspectedLayer[]>>;
  } = {},
): WorkloadSpec {
  return workload({
    image: LAUNCHER_IMAGE,
    command: undefined,
    runtime: 'runc',
    isolation: 'microvm',
    stopGracePeriodMs: 10_000,
    resources: { cpuMillis: 1000, memoryBytes: 256 * 1024 ** 2 },
    microvm: {
      mode: 'generic',
      guestImage: image.pinned,
      ...(options.platformLayers ? { platformLayers: options.platformLayers } : { layers: image.layers }),
      process: { ...image.process, ...options.process },
      vcpus: options.vcpus ?? 1,
      memoryMiB: options.memoryMiB ?? 256,
      rootfsBytes: options.rootfsBytes ?? 1024 ** 3,
    },
    ...overrides,
  });
}

/** Deterministic MAC for a lab VM NIC (52:54:00 + 3 bytes of sha256(seed)). */
export function labMac(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');

  return `52:54:00:${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}`;
}

/**
 * Lab registry on `vm` (TLS with a lab CA, SAN = the VM's address) for VM image artifacts and containerDisks; returns
 * the CA (install it on the other nodes with `trustLabRegistry`).
 */
export async function startLabRegistry(vm: Vm): Promise<{ host: string; ca: string }> {
  const host = `${vm.ip}:${LAB_REGISTRY_PORT}`;

  await vm.exec(
    [
      'install -d -m 0755 /etc/lw-lab-registry',
      'cd /etc/lw-lab-registry',
      'openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 2 -subj /CN=lab-ca -keyout ca.key -out ca.crt 2>/dev/null',
      `openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=${vm.ip} -keyout tls.key -out tls.csr 2>/dev/null`,
      `printf 'subjectAltName=IP:${vm.ip}\\n' > san.ext`,
      'openssl x509 -req -in tls.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile san.ext -out tls.crt 2>/dev/null',
      `docker run -d --name lw-lab-registry --restart always -p ${LAB_REGISTRY_PORT}:${LAB_REGISTRY_PORT} --memory 128m ` +
        `-v /etc/lw-lab-registry:/certs:ro -e REGISTRY_HTTP_ADDR=0.0.0.0:${LAB_REGISTRY_PORT} ` +
        '-e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/tls.crt -e REGISTRY_HTTP_TLS_KEY=/certs/tls.key ' +
        `-e REGISTRY_STORAGE_DELETE_ENABLED=true ${LAB_REGISTRY_IMAGE} >/dev/null`,
    ].join('\n'),
    { timeoutMs: 600_000 },
  );

  const ca = await vm.exec('cat /etc/lw-lab-registry/ca.crt');

  await trustLabRegistry(vm, host, ca);
  await eventually(
    'lab registry',
    async () =>
      (await vm.exec(`curl -sf --cacert ${LAB_CA_FILE} https://${host}/v2/ -o /dev/null && echo ok || true`)).includes(
        'ok',
      ),
    120_000,
  );

  return { host, ca };
}

/** Trusts the lab registry's CA on a node (Docker pulls / pushes, the agent's blob fetches). */
export async function trustLabRegistry(vm: Vm, host: string, ca: string): Promise<void> {
  await vm.exec(
    [
      'install -d -m 0755 /etc/loadweaver',
      `install -d -m 0755 /etc/docker/certs.d/${host}`,
      `cat > ${LAB_CA_FILE} <<'EOF'\n${ca.trim()}\nEOF`,
      `cp ${LAB_CA_FILE} /etc/docker/certs.d/${host}/ca.crt`,
    ].join('\n'),
  );
}

export interface PushedVmImage {
  ref: string;
  digest: string;
  layerDigest: string;
  format: 'qcow2' | 'raw';
  virtualSize: number;
}

/**
 * Pushes a disk file (on `vm`) as a Loadweaver VM image artifact (OCI manifest, `artifactType` VM image, one config,
 * one disk layer; raw disks zstd-compressed) to the lab registry with the registry API (curl), like
 * `loadweaver vm-image push` does against the cluster registry.
 */
export async function pushVmArtifact(
  vm: Vm,
  registry: string,
  repository: string,
  tag: string,
  disk: { path: string; format: 'qcow2' | 'raw'; guestAgent?: boolean },
): Promise<PushedVmImage> {
  const mediaType =
    disk.format === 'qcow2'
      ? 'application/vnd.loadweaver.vm-image.disk.qcow2'
      : 'application/vnd.loadweaver.vm-image.disk.raw+zstd';
  const base = `https://${registry}/v2/${repository}`;
  const upload = (file: string) =>
    [
      `f=${file}`,
      'd="sha256:$(sha256sum "$f" | cut -d" " -f1)"',
      's=$(stat -c %s "$f")',
      `if ! curl -sf --cacert ${LAB_CA_FILE} -I "${base}/blobs/$d" >/dev/null; then`,
      `  loc=$(curl -sSf --cacert ${LAB_CA_FILE} -X POST -D - -o /dev/null "${base}/blobs/uploads/" | sed -n 's/^[Ll]ocation: //p' | tr -d '\\r')`,
      `  case "$loc" in http*) ;; *) loc="https://${registry}$loc" ;; esac`,
      '  case "$loc" in *\\?*) sep="&" ;; *) sep="?" ;; esac',
      `  curl -sSf --cacert ${LAB_CA_FILE} -X PUT -H 'Content-Type: application/octet-stream' --data-binary @"$f" "$loc\${sep}digest=$d" >/dev/null`,
      'fi',
      'echo "$d $s"',
    ].join('\n');
  const prepared = (
    await vm.exec(
      [
        'set -e',
        `src=${disk.path}`,
        'work=$(mktemp -d)',
        disk.format === 'raw' ? 'zstd -q -T0 -3 -o "$work/layer" "$src"' : 'cp --reflink=auto "$src" "$work/layer"',
        `vsize=$(qemu-img info --output=json -f ${disk.format} "$src" | sed -n 's/.*"virtual-size": \\([0-9]*\\).*/\\1/p' | head -n1)`,
        `printf '{"arch":"amd64","format":"${disk.format}","virtualSize":%s,"firmware":["uefi","bios"]${disk.guestAgent ? ',"guestAgent":true' : ''}}' "$vsize" > "$work/config"`,
        upload('"$work/layer"'),
        upload('"$work/config"'),
        'echo "vsize $vsize"',
        'rm -rf "$work"',
      ].join('\n'),
      { timeoutMs: 1_800_000 },
    )
  )
    .trim()
    .split('\n');
  const [layerDigest, layerSize] = prepared[prepared.length - 3].split(' ');
  const [configDigest, configSize] = prepared[prepared.length - 2].split(' ');
  const virtualSize = Number(prepared[prepared.length - 1].split(' ')[1]);
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: 'application/vnd.loadweaver.vm-image.v1',
    config: {
      mediaType: 'application/vnd.loadweaver.vm-image.config.v1+json',
      digest: configDigest,
      size: Number(configSize),
    },
    layers: [
      {
        mediaType,
        digest: layerDigest,
        size: Number(layerSize),
        annotations: { 'org.opencontainers.image.title': disk.format === 'qcow2' ? 'disk.qcow2' : 'disk.raw.zst' },
      },
    ],
  });
  // The registry's own digest of what it stored (the heredoc adds a final newline to the document).
  const digest = (
    await vm.exec(
      `curl -sSf --cacert ${LAB_CA_FILE} -X PUT -D - -o /dev/null -H 'Content-Type: application/vnd.oci.image.manifest.v1+json' --data-binary @- ${base}/manifests/${tag} <<'LWEOF' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p' | tr -d '\\r'\n${manifest}\nLWEOF`,
    )
  ).trim();

  if (!/^sha256:[0-9a-f]{64}$/.test(digest))
    throw new Error(`pushing ${repository}:${tag}: no manifest digest (${digest})`);

  return { ref: `${registry}/${repository}:${tag}`, digest, layerDigest, format: disk.format, virtualSize };
}

// Full VMs.

/** The pinned Debian 13 genericcloud image of the golden (qcow2, sha512-checked), downloaded on `vm`. */
export async function downloadDebianCloudImage(vm: Vm, path = '/var/tmp/debian-13.qcow2'): Promise<string> {
  await vm.exec(
    [
      `test -f ${path} || { curl -fsSL -o ${path}.part '${GOLDEN_PINS.debianImage.url}' && ` +
        `echo '${GOLDEN_PINS.debianImage.sha512}  ${path}.part' | sha512sum -c - >/dev/null && mv ${path}.part ${path}; }`,
    ].join('\n'),
    { timeoutMs: 1_800_000 },
  );

  return path;
}

export interface LabVmNic {
  name: string;
  addresses: string[];
}

export interface LabVmOptions {
  project?: string;
  name: string;
  image: PushedVmImage;
  /** Boot disk first; extra disks are empty. */
  disks: { name: string; sizeBytes: number }[];
  nics: LabVmNic[];
  memoryMiB?: number;
  vcpus?: number;
  firmware?: 'uefi' | 'bios';
  cpuModel?: 'host-model' | 'host-passthrough';
  graphics?: boolean;
  /** cloud-init user data (may reference `secret://…` refs listed in `secretRefs`). */
  userData?: string;
  secretRefs?: string[];
  sshKeys?: string[];
  instanceGeneration?: number;
}

/** A stable uuid (v5 layout) for a lab VM. */
export function labVmUid(project: string, name: string): string {
  const h = createHash('sha256').update(`${project}/${name}`).digest('hex');

  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The node-side cloud-init (what `vmCloudInit` emits): meta-data, per-NIC network-config v2, user data. */
export function labVmCloudInit(o: LabVmOptions, uid: string, macs: string[]) {
  const ethernets = Object.fromEntries(
    o.nics.map((nic, i) => [
      nic.name,
      {
        match: { macaddress: macs[i] },
        'set-name': nic.name,
        addresses: nic.addresses.map((a) => (a.includes(':') ? `${a}/128` : `${a}/32`)),
        routes:
          i === 0
            ? [
                { to: '169.254.1.1/32', scope: 'link' },
                { to: '0.0.0.0/0', via: '169.254.1.1', 'on-link': true },
              ]
            : [
                { to: '169.254.1.1/32', scope: 'link', table: 100 + i },
                { to: '0.0.0.0/0', via: '169.254.1.1', 'on-link': true, table: 100 + i },
              ],
        ...(i === 0
          ? { nameservers: { addresses: ['${LW_DNS}'] } }
          : { 'routing-policy': nic.addresses.map((a) => ({ from: a, table: 100 + i })) }),
      },
    ]),
  );

  return {
    metaData: JSON.stringify({
      'instance-id': `${uid}-${o.instanceGeneration ?? 1}`,
      'local-hostname': o.name,
      ...(o.sshKeys?.length ? { 'public-keys': o.sshKeys } : {}),
    }),
    networkConfig: JSON.stringify({ version: 2, ethernets }),
    ...(o.userData ? { userData: o.userData } : {}),
    secretRefs: o.secretRefs ?? [],
  };
}

/** A full VM replica (what `buildVmWorkloadSpec` emits): the launcher image, `isolation: microvm`, `vm`. */
export function vmWorkload(o: LabVmOptions): WorkloadSpec {
  const project = o.project ?? 'lab';
  const uid = labVmUid(project, o.name);
  const macs = o.nics.map((nic, i) => labMac(`${uid}/${i}/${nic.name}`));
  const memoryMiB = o.memoryMiB ?? 512;

  return workload({
    id: `${project}/lw-vm/${o.name}/0`,
    addresses: o.nics[0].addresses,
    image: LAUNCHER_IMAGE,
    command: undefined,
    hostname: o.name,
    labels: { 'loadweaver.com/vm': o.name },
    isolation: 'microvm',
    resources: { cpuMillis: (o.vcpus ?? 1) * 1000, memoryBytes: memoryMiB * 1024 ** 2 },
    stopGracePeriodMs: 60_000,
    vm: {
      uid,
      firmware: o.firmware ?? 'uefi',
      cpuModel: o.cpuModel ?? 'host-model',
      vcpus: o.vcpus ?? 1,
      memoryMiB,
      disks: o.disks.map((d, i) => ({
        name: d.name,
        volume: `${project}/lw-vm/${o.name}.${d.name}`,
        bus: 'virtio' as const,
        cache: 'none' as const,
        boot: i === 0,
      })),
      nics: o.nics.map((nic, i) => ({ name: nic.name, mac: macs[i], addresses: nic.addresses })),
      image: {
        ref: `${o.image.ref.replace(/:[^:/]+$/, '')}@${o.image.digest}`,
        digest: o.image.digest,
        format: o.image.format,
        layerDigest: o.image.layerDigest,
      },
      cloudInit: labVmCloudInit(o, uid, macs),
      graphics: o.graphics ?? true,
      power: 'running',
    },
  });
}

/** The block volumes of a lab VM's disks (boot disk initialized from the image's disk layer). */
export function vmVolumes(
  o: LabVmOptions,
  nodes: Vm[],
  primary: Vm,
  first: { minor: number; port: number },
): VolumeAssignment[] {
  const project = o.project ?? 'lab';

  return o.disks.map((d, i) =>
    volume(`${project}/lw-vm/${o.name}.${d.name}`, nodes, primary, {
      minor: first.minor + i,
      port: first.port + i,
      sizeBytes: d.sizeBytes,
      block: i === 0 ? { digest: o.image.layerDigest, format: o.image.format } : true,
    }),
  );
}

/** Serial console text of a VM so far (the node's collector, through a console session). */
export async function serialText(
  driver: NodeDriver,
  replica: string,
  waitFor: RegExp,
  timeoutMs = 300_000,
): Promise<string> {
  const channel = `console:${randomBytes(6).toString('hex')}`;

  await driver.live('console', channel, { target: { kind: 'replica', replica }, kind: 'serial' });

  try {
    return await eventually(
      `serial console of ${replica} shows ${waitFor}`,
      async () => {
        const out = await driver.channelOutput(channel);

        return waitFor.test(out.text) ? out.text : undefined;
      },
      timeoutMs,
      2_000,
    );
  } finally {
    await driver.live('close', channel).catch(() => undefined);
  }
}
