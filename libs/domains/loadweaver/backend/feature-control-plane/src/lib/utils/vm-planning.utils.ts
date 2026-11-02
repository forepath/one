import { createHash } from 'node:crypto';

import type { VolumeAssignment, WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { ServiceSpec, VolumeSpec } from '@forepath/loadweaver/shared/util-compose';
import {
  parseVmQuantity,
  virtualMachineSpecSchema,
  vmBootDisk,
  vmDiskVolumeId,
  VM_DEPLOYMENT_NAME,
  type ProjectSpec,
  type VirtualMachineSpec,
  type VmNic,
} from '@forepath/loadweaver/shared/util-model';

import { canonicalJson } from './canonical-json.utils';
import { MICROVM_LAUNCHER_OVERHEAD, microvmLauncherImage, type ImageInspection } from './microvm-planning.utils';
import type { DeploymentIssue, ParsedDeployment } from './workload-planning.utils';

/**
 * Full virtual machines (3.35, M7.3): each `VirtualMachine` resource is planned like a single-replica stateful
 * service of the reserved deployment `lw-vm` of its project (`<project>/lw-vm/<name>/0`), so scheduling, failover,
 * addresses, service IPs, policies and volume placement work unchanged. Its disks are DRBD volumes in block mode
 * (`<project>/lw-vm/<name>.<disk>`), its launcher runs at the `microvm` level on VM-capable nodes only.
 */

const MiB = 1024 ** 2;

/** Grace the launcher gives the guest for an ACPI shutdown before it destroys the domain (`launch-vm`). */
export const VM_STOP_GRACE_MS = 60_000;
/** Label every VM workload carries: groups / policies select VMs like services. */
export const VM_LABEL = 'loadweaver.com/vm';
/** Label of the NIC a policy member stands for (extra NICs are members of their own). */
export const VM_NIC_LABEL = 'loadweaver.com/nic';
/** The link-local gateways a guest routes through (static addressing, M7.2 / M7.3). */
export const VM_GATEWAY_V4 = '169.254.1.1';
export const VM_GATEWAY_V6 = 'fe80::1';
/** Placeholder the node agent replaces with its DNS servers (JSON strings) in the network config. */
export const VM_DNS_PLACEHOLDER = '${LW_DNS}';
/** Maximum NoCloud meta-data size on the wire. */
const MAX_META_DATA = 4096;

/** Operational power of a `Manual` VM (W8 records it from the lifecycle API); absent: running. */
export type VmPower = 'running' | 'stopped';

/** A VM as the planner sees it. */
export interface PlannedVm {
  project: string;
  name: string;
  labels: Record<string, string>;
  spec: VirtualMachineSpec;
  uid: string;
  /** Whether the VM has a replica: `Halted` and stopped `Manual` VMs have none. */
  running: boolean;
  /** cloud-init instance generation (W8's `reimage` bumps it); default 1. */
  instanceGeneration?: number;
}

/** Stable VM uid (name-based, RFC 9562 version 5 layout): the same VM keeps its MACs and instance id. */
export function vmUid(project: string, name: string): string {
  const h = createHash('sha256').update(`loadweaver.com/vm:${project}/${name}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);

  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** MAC of a VM NIC: QEMU's prefix 52:54:00 + 3 bytes of sha256 of the uid (first NIC) or `<uid>/<nic>`. */
export function vmNicMac(uid: string, index: number, nic: string): string {
  const h = createHash('sha256')
    .update(index === 0 ? uid : `${uid}/${nic}`)
    .digest('hex');

  return `52:54:00:${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}`;
}

export function vmMemoryBytes(spec: Pick<VirtualMachineSpec, 'memory'>): number {
  return parseVmQuantity(spec.memory) ?? 0;
}

export function vmDiskBytes(disk: { size?: string | number }): number {
  return disk.size === undefined ? 0 : (parseVmQuantity(disk.size) ?? 0);
}

/** Scheduler requests of a VM (M7.3): guest memory + 384 MiB, vCPUs × 1000 m + 250 m launcher overhead. */
export function vmRequests(spec: Pick<VirtualMachineSpec, 'memory' | 'cpu'>): {
  cpuMillis: number;
  memoryBytes: number;
} {
  return {
    cpuMillis: spec.cpu.vcpus * 1000 + MICROVM_LAUNCHER_OVERHEAD.cpuMillis,
    memoryBytes: vmMemoryBytes(spec) + MICROVM_LAUNCHER_OVERHEAD.memoryBytes,
  };
}

/** The volume name of a VM disk inside the `lw-vm` deployment (`<vm>.<disk>`). */
export function vmDiskVolumeName(vm: string, disk: string): string {
  return `${vm}.${disk}`;
}

/** The planner's service of a VM (only the fields the scheduler, quotas, policies and failover read matter). */
export function vmServiceSpec(vm: PlannedVm): ServiceSpec {
  const { spec } = vm;
  const primary = spec.nics[0];

  return {
    name: vm.name,
    image: spec.image,
    environment: {},
    labels: { ...vm.labels, ...(primary?.labels ?? {}), [VM_LABEL]: vm.name },
    replicas: vm.running ? 1 : 0,
    resources: { requests: vmRequests(spec), limits: {}, source: 'compose' },
    dependsOn: [],
    volumes: spec.disks.map((d) => ({
      type: 'volume' as const,
      source: vmDiskVolumeName(vm.name, d.name),
      target: `/lw-vm/disks/${d.name}`,
      readOnly: false,
    })),
    secrets: [],
    configs: [],
    networks: [],
    groups: primary?.groups ?? [],
    aliases: [],
    ports: [],
    http: [],
    runtime: 'microvm',
    ...(spec.placement?.selector ? { placement: spec.placement.selector } : {}),
    spread: spec.placement?.spread ?? 'node',
    kind: 'service',
    liveMigration: spec.liveMigration.enabled,
    restart: 'always',
    capAdd: [],
    capDrop: [],
    readOnly: false,
    privileged: false,
    init: false,
    devices: [],
    deviceAccess: [],
    stopGracePeriodMs: VM_STOP_GRACE_MS,
    extraHosts: [],
    ulimits: {},
    // `ha.restartElsewhere: false` keeps the VM on its node: a deliberate pin (no failover).
    pins: spec.ha.restartElsewhere ? [] : [{ kind: 'deployment', reason: 'ha disabled (restartElsewhere: false)' }],
    ...(spec.ha.restartElsewhere ? {} : { pinAcknowledgement: 'ha disabled' }),
  };
}

/** The volumes of a VM's disks. */
export function vmVolumeSpecs(vm: PlannedVm): VolumeSpec[] {
  return vm.spec.disks.map((d) => ({
    name: vmDiskVolumeName(vm.name, d.name),
    external: false,
    sizeBytes: vmDiskBytes(d),
    replicas: d.replicas ?? 2,
    crossSite: d.crossSite ?? 'async',
    pins: [],
  }));
}

/** A `VirtualMachine` resource row (stored or previewed). */
export interface VmResourceInput {
  project: string;
  name: string;
  labels?: Record<string, string> | null;
  spec: unknown;
}

/**
 * Turns `VirtualMachine` resources into one `lw-vm` deployment per project (3.35). Unknown projects and invalid specs
 * are errors; `power` holds the operational power of `Manual` VMs (`<project>/<name>`).
 */
export function vmDeployments(
  resources: readonly VmResourceInput[],
  projects: ReadonlyMap<string, ProjectSpec>,
  power: ReadonlyMap<string, VmPower> = new Map(),
  /** cloud-init instance generations (`<project>/<name>`, W8's `reimage`); absent = 1. */
  generations: ReadonlyMap<string, number> = new Map(),
): { parsed: ParsedDeployment[]; issues: DeploymentIssue[] } {
  const byProject = new Map<string, PlannedVm[]>();
  const issues: DeploymentIssue[] = [];

  for (const r of [...resources].sort((a, b) => `${a.project}/${a.name}`.localeCompare(`${b.project}/${b.name}`))) {
    const issue = (message: string, path = 'spec') =>
      issues.push({
        level: 'error',
        project: r.project,
        deployment: VM_DEPLOYMENT_NAME,
        path: `${r.name}.${path}`,
        message,
      });

    if (!projects.has(r.project)) {
      issue(`project ${r.project} does not exist`, 'metadata.project');
      continue;
    }

    const parsed = virtualMachineSpecSchema.safeParse(r.spec);

    if (!parsed.success) {
      issue(`virtual machine ${r.name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      continue;
    }

    const spec = parsed.data;
    const running =
      spec.runStrategy === 'Always' ||
      (spec.runStrategy === 'Manual' && power.get(`${r.project}/${r.name}`) !== 'stopped');
    const list = byProject.get(r.project) ?? [];

    list.push({
      project: r.project,
      name: r.name,
      labels: { ...(r.labels ?? {}) },
      spec,
      uid: vmUid(r.project, r.name),
      running,
      ...((generations.get(`${r.project}/${r.name}`) ?? 1) > 1
        ? { instanceGeneration: generations.get(`${r.project}/${r.name}`) }
        : {}),
    });
    byProject.set(r.project, list);
  }

  const parsed: ParsedDeployment[] = [...byProject].map(([project, vms]) => ({
    project,
    name: VM_DEPLOYMENT_NAME,
    compose: {
      name: VM_DEPLOYMENT_NAME,
      services: vms.map(vmServiceSpec),
      volumes: vms.flatMap(vmVolumeSpecs),
      networks: [],
      secrets: [],
      configs: [],
    },
    virtualMachines: Object.fromEntries(vms.map((vm) => [vm.name, vm])),
  }));

  return { parsed, issues };
}

/** The VM behind a planner service, if it is one. */
export function plannedVm(
  deployment: Pick<ParsedDeployment, 'virtualMachines'>,
  service: string,
): PlannedVm | undefined {
  return deployment.virtualMachines?.[service];
}

type Family = 'v4' | 'v6';

/** Address families a NIC wants (default: every family). */
export function nicFamilies(nic: Pick<VmNic, 'ipv4' | 'ipv6'>): Family[] {
  return [...(nic.ipv4 !== false ? (['v4'] as const) : []), ...(nic.ipv6 !== false ? (['v6'] as const) : [])];
}

/**
 * The address slots of a VM replica in allocation order: per NIC, its families (IPv4 first). The replica's
 * `addresses` hold all NICs' addresses in this order; the first NIC's are the workload's own addresses.
 */
export function vmAddressFamilies(vm: Pick<PlannedVm, 'spec'>): Family[] {
  return vm.spec.nics.flatMap(nicFamilies);
}

function familyOf(address: string): Family {
  return address.includes(':') ? 'v6' : 'v4';
}

/**
 * Splits a VM replica's addresses into its NICs (allocation order, slots of families the node has no pod subnet for
 * are skipped). NICs without any address are left out.
 */
export function vmNicAddresses(
  vm: Pick<PlannedVm, 'spec'>,
  addresses: readonly string[],
): { nic: VmNic; index: number; addresses: string[] }[] {
  const result: { nic: VmNic; index: number; addresses: string[] }[] = [];
  let next = 0;

  vm.spec.nics.forEach((nic, index) => {
    const mine: string[] = [];

    for (const family of nicFamilies(nic)) {
      if (next < addresses.length && familyOf(addresses[next]) === family) mine.push(addresses[next++]);
    }

    if (mine.length > 0) result.push({ nic, index, addresses: mine });
  });

  return result;
}

/**
 * Address layouts per replica for the allocator: VM replicas get one slot per NIC family; other replicas keep the
 * default (one address per pod subnet of their node).
 */
export function addressFamiliesOf(parsed: readonly ParsedDeployment[]): (replica: string) => Family[] | undefined {
  const layouts = new Map<string, Family[]>();

  for (const d of parsed)
    for (const vm of Object.values(d.virtualMachines ?? {}))
      layouts.set(`${d.project}/${d.name}/${vm.name}/0`, vmAddressFamilies(vm));

  return (replica) => layouts.get(replica);
}

/**
 * Static addressing of every NIC (cloud-init network config v2; JSON is valid YAML): `/32` + `/128` with the
 * link-local gateways, DNS on the primary NIC (the agent fills in its servers for `${VM_DNS_PLACEHOLDER}`).
 */
export function vmNetworkConfig(
  vm: PlannedVm,
  nics: readonly { nic: VmNic; index: number; addresses: string[] }[],
  macs: ReadonlyMap<string, string>,
  dnsSearch: readonly string[],
): string {
  const ethernets: Record<string, unknown> = {};

  for (const { nic, index, addresses } of nics) {
    const table = 100 + index;
    const routes = (extra: Record<string, unknown>) => [
      ...(addresses.some((a) => familyOf(a) === 'v4')
        ? [{ to: '0.0.0.0/0', via: VM_GATEWAY_V4, 'on-link': true, ...extra }]
        : []),
      ...(addresses.some((a) => familyOf(a) === 'v6') ? [{ to: '::/0', via: VM_GATEWAY_V6, ...extra }] : []),
    ];

    ethernets[nic.name] = {
      match: { macaddress: macs.get(nic.name) },
      'set-name': nic.name,
      addresses: addresses.map((a) => `${a}/${familyOf(a) === 'v4' ? 32 : 128}`),
      ...(index === 0
        ? {
            routes: routes({}),
            nameservers: { addresses: [VM_DNS_PLACEHOLDER], search: [...dnsSearch] },
          }
        : {
            // Extra NICs answer through themselves (own table + source rule): the tap's anti-spoofing only lets
            // the NIC's own source addresses out.
            routes: routes({ table }),
            'routing-policy': addresses.map((a) => ({ from: `${a}/${familyOf(a) === 'v4' ? 32 : 128}`, table })),
          }),
    };
  }

  return JSON.stringify({ version: 2, ethernets });
}

const SECRET_REF = /secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(?:@\d+)?/g;

/** The user data of a VM's seed: `userDataSecret` becomes a user data that is just its reference. */
function vmUserData(spec: Pick<VirtualMachineSpec, 'cloudInit'>): string | undefined {
  return spec.cloudInit?.userDataSecret ?? spec.cloudInit?.userData;
}

/**
 * The `secret://` references of a VM's user data that aren't pinned to a version yet (`@<n>`): the plan pins each
 * to its latest version (`vmSecretVersionKey`), so a later secret change shows up in a plan instead of silently
 * changing the next boot.
 */
export function vmSecretRefs(spec: Pick<VirtualMachineSpec, 'cloudInit'>): string[] {
  return [...new Set(vmUserData(spec)?.match(SECRET_REF) ?? [])].filter((r) => !r.includes('@')).sort();
}

/** Key of a VM's pinned secret version in the `lw-vm` deployment state's `secretVersions` (per VM: VMs re-pin alone). */
export function vmSecretVersionKey(vm: string, ref: string): string {
  return `${vm}/${ref}`;
}

/**
 * Plan-time secret pins of a project's VMs (`secretVersions` of the `lw-vm` state): VMs this plan re-pins (`repin`)
 * get the latest version of every unpinned user-data ref, the others keep their previous pins. `missing` = refs
 * without a value (plan errors).
 */
export async function pinVmSecrets(
  vms: Readonly<Record<string, Pick<PlannedVm, 'spec'>>>,
  repin: (vm: string) => boolean,
  previous: Readonly<Record<string, number>> | undefined,
  latestVersions: (refs: string[]) => Promise<Record<string, number>>,
): Promise<{ versions: Record<string, number>; missing: { vm: string; ref: string }[] }> {
  const versions: Record<string, number> = {};
  const missing: { vm: string; ref: string }[] = [];

  for (const [name, vm] of Object.entries(vms)) {
    const refs = vmSecretRefs(vm.spec);

    if (refs.length === 0) continue;

    const latest = repin(name) ? await latestVersions(refs) : null;

    for (const ref of refs) {
      const key = vmSecretVersionKey(name, ref);
      const version = latest ? latest[ref] : previous?.[key];

      if (version) versions[key] = version;
      else if (latest) missing.push({ vm: name, ref });
    }
  }

  return { versions, missing };
}

/** The user data with every unpinned reference pinned to its planned version (`secret://p/x` → `secret://p/x@3`). */
export function pinVmUserData(
  vm: string,
  userData: string,
  secretVersions: Readonly<Record<string, number>> | undefined,
): string {
  if (!secretVersions) return userData;

  return userData.replace(SECRET_REF, (ref) => {
    const version = ref.includes('@') ? undefined : secretVersions[vmSecretVersionKey(vm, ref)];

    return version ? `${ref}@${version}` : ref;
  });
}

/**
 * The NoCloud seed of a VM (M7.3): meta-data (instance id, host name, SSH keys), the static network config of every
 * NIC (unless `networkConfig: none`) and the user data. `userDataSecret` becomes a user data that is just its
 * reference; the agent substitutes every listed `secret://` reference (tmpfs only), pinned to the versions of the
 * plan (`secretVersions`, keys `vmSecretVersionKey`). `generation` bumps the instance id (re-runs cloud-init:
 * reimage).
 */
export function vmCloudInit(
  vm: PlannedVm,
  nics: readonly { nic: VmNic; index: number; addresses: string[] }[],
  macs: ReadonlyMap<string, string>,
  dnsSearch: readonly string[],
  generation = 1,
  secretVersions?: Readonly<Record<string, number>>,
): NonNullable<NonNullable<WorkloadSpec['vm']>['cloudInit']> {
  const cloudInit = vm.spec.cloudInit;
  const metaData = JSON.stringify({
    'instance-id': `${vm.uid}-${generation}`,
    'local-hostname': vm.name,
    ...(cloudInit?.sshAuthorizedKeys?.length ? { 'public-keys': cloudInit.sshAuthorizedKeys } : {}),
  });

  if (metaData.length > MAX_META_DATA)
    throw new Error(`virtual machine ${vm.name}: sshAuthorizedKeys are too large for the seed; put them into userData`);

  const raw = vmUserData(vm.spec);
  const userData = raw === undefined ? undefined : pinVmUserData(vm.name, raw, secretVersions);

  return {
    metaData,
    ...(cloudInit?.networkConfig === 'none' ? {} : { networkConfig: vmNetworkConfig(vm, nics, macs, dnsSearch) }),
    ...(userData !== undefined ? { userData } : {}),
    secretRefs: [...new Set(userData?.match(SECRET_REF) ?? [])].sort(),
  };
}

/** Plan-time problems of a VM with its pinned image (errors reject the plan). */
export function vmImageIssues(vm: PlannedVm, inspection: ImageInspection | undefined): DeploymentIssue[] {
  const issue = (path: string, message: string): DeploymentIssue => ({
    level: 'error',
    project: vm.project,
    deployment: VM_DEPLOYMENT_NAME,
    path: `${vm.name}.${path}`,
    message,
  });

  if (!inspection) return [];

  const image = inspection.vmImage;

  if (!image)
    return [
      issue(
        'spec.image',
        `${vm.spec.image} is no VM image artifact (application/vnd.loadweaver.vm-image.v1); push it with lw vm-image push`,
      ),
    ];

  const issues: DeploymentIssue[] = [];
  const boot = vmBootDisk(vm.spec);

  if (image.containerDisk)
    issues.push({
      ...issue(
        'spec.image',
        `${vm.spec.image} is a KubeVirt containerDisk (${image.containerDisk.path}, ${image.format}, ${image.virtualSize} bytes): it boots as a VM image, firmware assumed ${image.firmware.join(' / ')}; push a VM image artifact (lw vm-image push) to declare firmware and guest agent`,
      ),
      level: 'warning',
    });

  if (boot && vmDiskBytes(boot) < image.virtualSize)
    issues.push(
      issue(
        `spec.disks.${boot.name}.size`,
        `the boot disk (${vmDiskBytes(boot)} bytes) is smaller than the image (${image.virtualSize} bytes)`,
      ),
    );

  if (!image.firmware.includes(vm.spec.firmware))
    issues.push(
      issue('spec.firmware', `${vm.spec.image} boots with ${image.firmware.join(' / ')}, not ${vm.spec.firmware}`),
    );

  return issues;
}

/**
 * The workload a node runs for a VM (M7.3): the launcher at the `microvm` level with the `vm` field. The NoCloud
 * seed is outside the spec hash except its instance id, so a user-data change doesn't recreate the VM (cloud-init
 * applies user data on the first boot only).
 */
export function buildVmWorkloadSpec(
  deployment: ParsedDeployment,
  vm: PlannedVm,
  addresses: string[],
  dnsDomain: string,
  pinned: {
    images: Record<string, string>;
    imageConfigs?: Record<string, ImageInspection>;
    secretVersions?: Record<string, number>;
  },
  launcherImage: string = microvmLauncherImage(),
): WorkloadSpec {
  const image = pinned.images[vm.name];
  const inspection = pinned.imageConfigs?.[vm.name]?.vmImage;

  if (!image || !inspection) throw new Error(`virtual machine ${vm.project}/${vm.name}: image not pinned yet`);

  const digest = image.slice(image.indexOf('@') + 1);
  const nics = vmNicAddresses(vm, addresses);
  const macs = new Map(vm.spec.nics.map((nic, i) => [nic.name, vmNicMac(vm.uid, i, nic.name)]));
  const dnsSearch = [`${deployment.name}.${deployment.project}.${dnsDomain}`, `${deployment.project}.${dnsDomain}`];
  const service = vmServiceSpec(vm);
  const memoryMiB = Math.ceil(vmMemoryBytes(vm.spec) / MiB);
  const disks = [...vm.spec.disks]
    .sort((a, b) => Number(b.source === 'image') - Number(a.source === 'image'))
    .map((d) => ({
      name: d.name,
      volume: vmDiskVolumeId(vm.project, vm.name, d.name),
      bus: d.bus,
      cache: d.cache,
      boot: d.source === 'image',
    }));
  const cloudInit = vmCloudInit(vm, nics, macs, dnsSearch, vm.instanceGeneration ?? 1, pinned.secretVersions);
  const spec: Omit<WorkloadSpec, 'specHash'> = {
    id: `${deployment.project}/${deployment.name}/${vm.name}/0`,
    project: deployment.project,
    deployment: deployment.name,
    service: vm.name,
    kind: 'service',
    image: launcherImage,
    environment: {},
    labels: {
      ...service.labels,
      'loadweaver.com/project': deployment.project,
      'loadweaver.com/deployment': deployment.name,
      'loadweaver.com/service': vm.name,
      'loadweaver.com/replica': '0',
    },
    hostname: vm.name,
    addresses: nics[0]?.addresses ?? addresses,
    dnsSearch,
    runtime: 'runc',
    isolation: 'microvm',
    resources: { ...service.resources.requests, memoryLimitBytes: service.resources.requests.memoryBytes },
    restart: 'always',
    stopGracePeriodMs: VM_STOP_GRACE_MS,
    init: false,
    readOnly: false,
    privileged: false,
    capAdd: [],
    capDrop: [],
    ulimits: {},
    extraHosts: [],
    volumes: [],
    secrets: [],
    vm: {
      uid: vm.uid,
      firmware: vm.spec.firmware,
      cpuModel: vm.spec.cpu.model,
      vcpus: vm.spec.cpu.vcpus,
      memoryMiB,
      disks,
      nics: nics.map(({ nic, addresses: a }) => ({ name: nic.name, mac: macs.get(nic.name) as string, addresses: a })),
      image: { ref: image, digest, format: inspection.format, layerDigest: inspection.layerDigest },
      cloudInit,
      graphics: vm.spec.console.graphical,
      power: 'running',
    },
  };
  const hashed = {
    ...spec,
    vm: { ...spec.vm, cloudInit: { instanceId: JSON.parse(cloudInit.metaData)['instance-id'] } },
  };

  return { ...spec, specHash: createHash('sha256').update(canonicalJson(hashed)).digest('hex').slice(0, 32) };
}

/**
 * Block-mode volumes (VM disks, M7.3) with the boot disk's one-time initialization from the pinned image layer, by
 * volume id; filesystem volumes are not listed.
 */
export function vmBlockVolumes(
  parsed: readonly ParsedDeployment[],
  states: readonly { id: string; imageConfigs?: Record<string, ImageInspection> | null }[] = [],
): Map<string, Pick<VolumeAssignment, 'mode' | 'initializeFrom'>> {
  const result = new Map<string, Pick<VolumeAssignment, 'mode' | 'initializeFrom'>>();

  for (const d of parsed) {
    const state = states.find((s) => s.id === `${d.project}/${d.name}`);

    for (const vm of Object.values(d.virtualMachines ?? {})) {
      const image = state?.imageConfigs?.[vm.name]?.vmImage;

      for (const disk of vm.spec.disks)
        result.set(vmDiskVolumeId(vm.project, vm.name, disk.name), {
          mode: 'block',
          ...(disk.source === 'image' && image
            ? { initializeFrom: { digest: image.layerDigest, format: image.format } }
            : {}),
        });
    }
  }

  return result;
}

/** VM usage of each project for the VM quotas (3.35): count, vCPUs and memory of running VMs, all disk sizes. */
export interface VmUsage {
  virtualMachines: number;
  vmVcpus: number;
  vmMemoryBytes: number;
  vmDiskBytes: number;
}

export function vmUsage(parsed: readonly ParsedDeployment[]): Map<string, VmUsage> {
  const usage = new Map<string, VmUsage>();

  for (const d of parsed)
    for (const vm of Object.values(d.virtualMachines ?? {})) {
      const u = usage.get(d.project) ?? { virtualMachines: 0, vmVcpus: 0, vmMemoryBytes: 0, vmDiskBytes: 0 };

      u.virtualMachines += 1;

      if (vm.running) {
        u.vmVcpus += vm.spec.cpu.vcpus;
        u.vmMemoryBytes += vmMemoryBytes(vm.spec);
      }

      u.vmDiskBytes += vm.spec.disks.reduce((sum, disk) => sum + vmDiskBytes(disk), 0);
      usage.set(d.project, u);
    }

  return usage;
}
