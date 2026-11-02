import { createHash } from 'node:crypto';

import { dockerRuntimeFamily, type WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  parseBytes,
  parseCompose,
  parseCpus,
  type ComposeDeployment,
  type ComposeIssue,
  type ServiceSpec,
} from '@forepath/loadweaver/shared/util-compose';
import {
  isRuntime,
  VM_DEPLOYMENT_NAME,
  type ClusterNetwork,
  type DeploymentSpec,
  type IsolationState,
  type ProjectSpec,
  type Runtime,
} from '@forepath/loadweaver/shared/util-model';
import {
  allocateAddress,
  formatIp,
  mustParseCidr,
  mustParseIp,
  type IpAddress,
} from '@forepath/loadweaver/shared/util-network';
import {
  isolationFeatures,
  runtimeNodeLabels,
  type ReplicaPlacement,
  type SchedulerNode,
  type SchedulerService,
  type VolumePlacement,
} from '@forepath/loadweaver/shared/util-scheduler';

import { canonicalJson } from './canonical-json.utils';
import type { MigrationChoice, MigrationMethod } from './migration-eligibility.utils';
import { compileMicrovm, imageArchitectures, microvmRequests, type ImageInspection } from './microvm-planning.utils';
import { buildVmWorkloadSpec, type PlannedVm } from './vm-planning.utils';

export interface ParsedDeployment {
  project: string;
  name: string;
  compose: ComposeDeployment;
  /**
   * The reserved deployment `lw-vm` (3.35): its services are `VirtualMachine` resources (`vm-planning.utils.ts`),
   * keyed by service (= VM) name. Absent for compose deployments.
   */
  virtualMachines?: Record<string, PlannedVm>;
}

export interface DeploymentIssue extends ComposeIssue {
  project: string;
  deployment: string;
}

export interface DeploymentInput {
  project: string;
  name: string;
  spec: DeploymentSpec;
}

const DEFAULT_PROJECT_DEFAULTS = { cpu: '0.25', memory: '256m', volumeSize: '10g' };

/**
 * Host devices a project's services request that its `workloads.allowedDevices` (admin-only, 3.1) doesn't allow:
 * one policy error per service and device.
 */
export function deviceAllowanceIssues(
  project: string,
  deployment: string,
  compose: ComposeDeployment,
  spec: ProjectSpec,
): DeploymentIssue[] {
  const allowed = new Set<string>(spec.workloads?.allowedDevices ?? []);

  return compose.services.flatMap((s) =>
    (s.deviceAccess ?? [])
      .filter((d) => !allowed.has(d.path))
      .map((d) => ({
        level: 'error' as const,
        project,
        deployment,
        path: `services.${s.name}.devices`,
        message: `device ${d.path} is not allowed in project ${project}: a cluster admin has to add it to the project's workloads.allowedDevices`,
      })),
  );
}

/** Parses every deployment with its project's defaults (3.11). Unknown projects are errors. */
export function translateDeployments(
  deployments: DeploymentInput[],
  projects: ReadonlyMap<string, ProjectSpec>,
): { parsed: ParsedDeployment[]; issues: DeploymentIssue[] } {
  const parsed: ParsedDeployment[] = [];
  const issues: DeploymentIssue[] = [];

  for (const deployment of deployments) {
    const project = projects.get(deployment.project);

    if (!project) {
      issues.push({
        project: deployment.project,
        deployment: deployment.name,
        level: 'error',
        path: 'metadata.project',
        message: `project ${deployment.project} does not exist`,
      });
      continue;
    }

    // `lw-vm` holds the project's virtual machines (3.35).
    if (deployment.name === VM_DEPLOYMENT_NAME) {
      issues.push({
        project: deployment.project,
        deployment: deployment.name,
        level: 'error',
        path: 'metadata.name',
        message: `the deployment name ${VM_DEPLOYMENT_NAME} is reserved for virtual machines`,
      });
      continue;
    }

    const defaults = { ...DEFAULT_PROJECT_DEFAULTS, ...project.defaults };
    const result = parseCompose(deployment.spec.compose, {
      name: deployment.name,
      project: deployment.project,
      variables: deployment.spec.variables,
      defaultRequests: {
        cpuMillis: parseCpus(defaults.cpu) ?? 250,
        memoryBytes: parseBytes(defaults.memory) ?? 256 * 1024 ** 2,
      },
      defaultVolumeSizeBytes: parseBytes(defaults.volumeSize) ?? 10 * 1024 ** 3,
    });

    if (result.ok === false) {
      issues.push(...result.issues.map((i) => ({ ...i, project: deployment.project, deployment: deployment.name })));
      continue;
    }

    issues.push(...result.warnings.map((i) => ({ ...i, project: deployment.project, deployment: deployment.name })));
    // `/dev/kvm` only where a cluster admin allowed it (3.1).
    issues.push(...deviceAllowanceIssues(deployment.project, deployment.name, result.deployment, project));
    parsed.push({ project: deployment.project, name: deployment.name, compose: result.deployment });
  }

  return { parsed, issues };
}

export function serviceId(project: string, deployment: string, service: string): string {
  return `${project}/${deployment}/${service}`;
}

export function volumeId(project: string, deployment: string, volume: string): string {
  return `${project}/${deployment}/${volume}`;
}

/**
 * The scheduler's view of one compose service (or VM, 3.35). The exact isolation level, `/dev/kvm` and full VMs are
 * hard node rules the scheduler derives its refuse-gated agent features from (`isolationFeatures`) — they are not
 * `requiredFeatures` (those keep replicas on older agents). MicroVM and VM requests include the launcher overhead.
 */
export function toSchedulerService(
  d: ParsedDeployment,
  s: ParsedDeployment['compose']['services'][number],
): SchedulerService {
  const vm = d.virtualMachines?.[s.name];

  return {
    id: serviceId(d.project, d.name, s.name),
    project: d.project,
    replicas: s.kind === 'service' ? s.replicas : 1,
    // VM requests already carry the launcher overhead (`vmRequests`).
    requests: s.runtime === 'microvm' && !vm ? microvmRequests(s) : s.resources.requests,
    runtime: vm ? 'microvm' : s.runtime,
    ...(vm ? { virtualMachine: true } : {}),
    // Fixtures / callers older than M7 may lack `deviceAccess`.
    ...(!vm && (s.deviceAccess ?? []).length > 0 ? { needsKvmDevice: true } : {}),
    ...(s.placement ? { selector: s.placement } : {}),
    spread: s.spread,
    volumes: s.volumes
      .filter((m): m is Extract<typeof m, { type: 'volume' }> => m.type === 'volume')
      .map((m) => {
        const volume = d.compose.volumes.find((v) => v.name === m.source);

        return {
          id: volumeId(d.project, d.name, m.source),
          sizeBytes: volume?.sizeBytes ?? 0,
          replicas: volume?.replicas ?? 2,
          crossSite: volume?.crossSite ?? 'async',
          // VM disks are raw DRBD devices (virtio-blk), 3.35.
          ...(vm ? { mode: 'block' as const } : {}),
        };
      }),
  };
}

/**
 * Agent protocol features a node needs to run the service's replicas (refuse-gated fields, M7): the placement of
 * every replica, and the target of a VM / microVM migration (`vmMigrationPrepare` is only message-gated, its spec
 * isn't field-gated), must have them.
 */
export function replicaAgentFeatures(service: SchedulerService): string[] {
  return isolationFeatures(service);
}

/**
 * Pinned image inspections (3.35) of microVM / VM services keyed by service id: their image architectures become the
 * scheduler's `architectures` rule (mixed-arch clusters: nodes the guest image has no variant for get no replicas).
 */
export function withImageArchitectures(
  services: readonly SchedulerService[],
  parsed: readonly ParsedDeployment[],
  imageConfigs: ReadonlyMap<string, Record<string, ImageInspection> | null | undefined>,
): SchedulerService[] {
  const arches = new Map<string, string[]>();

  for (const d of parsed) {
    const configs = imageConfigs.get(`${d.project}/${d.name}`);

    if (!configs) continue;

    for (const s of d.compose.services) {
      if (s.runtime !== 'microvm' && !d.virtualMachines?.[s.name]) continue;

      const list = imageArchitectures(configs[s.name]);

      if (list) arches.set(serviceId(d.project, d.name, s.name), list);
    }
  }

  return services.map((s) => (arches.has(s.id) ? { ...s, architectures: arches.get(s.id) } : s));
}

/** Long-running services and one-off jobs are placed; cron jobs are placed per run by the cron controller (3.23). */
export function toSchedulerServices(parsed: readonly ParsedDeployment[]): SchedulerService[] {
  return parsed.flatMap((d) =>
    d.compose.services.filter((s) => s.kind !== 'cron').map((s) => toSchedulerService(d, s)),
  );
}

/** Reserved for the agent, Docker and node components; control-plane members also run etcd, Postgres and the API. */
export const PLATFORM_RESERVE = { cpuMillis: 250, memoryBytes: 512 * 1024 ** 2 };
export const CONTROL_PLANE_RESERVE = { cpuMillis: 1000, memoryBytes: 2560 * 1024 ** 2 };

export interface PlannerNode {
  name: string;
  site: string;
  labels: Record<string, string>;
  lifecycle: 'active' | 'cordoned' | 'draining' | 'leaving' | 'left';
  witness: boolean;
  controlPlane: boolean;
  capacity: { cpuMillis: number; memoryBytes: number; diskBytes: number } | null;
  /** Ready isolation levels from the capabilities (3.1); unknown names are dropped. */
  runtimes: string[];
  /** Per-level probe results (capabilities `isolation`), for unschedulable reasons. */
  isolation?: Partial<Record<string, { state: string; reasonCode?: string; reason?: string }>>;
  /** KVM facts (capabilities `kvm`); `optOut` also from the node spec (`virtualization.kvm: disabled`). */
  kvm?: { usable: boolean; optOut: boolean };
  /** Full VMs possible (capabilities `virtualMachines`). */
  virtualMachines?: boolean;
  /** Block-mode volumes possible; undefined: derived by the scheduler (DRBD 9 + `vm-block-volumes`). */
  blockVolumes?: boolean;
  /** CPU architecture (`amd64` / `arm64`) from the agent's hello; undefined when not reported. */
  arch?: string;
  reachable: boolean;
  /** DRBD 9 module reported by the agent (3.5); undefined for agents that don't report it. */
  drbd9?: boolean;
  /** Why the node isn't ready for new volume copies (joining, M6 gate); undefined when it is. */
  notReady?: string;
  /** Protocol features the node's agent negotiated (M6 gate: egress steering); undefined when unknown. */
  features?: string[];
}

export function toSchedulerNodes(nodes: readonly PlannerNode[]): SchedulerNode[] {
  return nodes
    .filter((n) => n.lifecycle !== 'left')
    .map((n) => {
      const capacity = n.capacity ?? { cpuMillis: 0, memoryBytes: 0, diskBytes: 0 };
      const reserve = n.controlPlane
        ? {
            cpuMillis: PLATFORM_RESERVE.cpuMillis + CONTROL_PLANE_RESERVE.cpuMillis,
            memoryBytes: PLATFORM_RESERVE.memoryBytes + CONTROL_PLANE_RESERVE.memoryBytes,
          }
        : PLATFORM_RESERVE;

      const runtimes = n.runtimes.filter(isRuntime);

      return {
        name: n.name,
        site: n.site,
        // Derived runtime labels (3.1) win over user labels: selectors such as `runtime ≥ sandboxed-kvm` match them.
        labels: {
          ...n.labels,
          ...runtimeNodeLabels(runtimes),
          'loadweaver.com/site': n.site,
          'loadweaver.com/node': n.name,
        },
        lifecycle: n.lifecycle === 'left' ? 'leaving' : n.lifecycle,
        witness: n.witness,
        capacity: {
          cpuMillis: Math.max(0, capacity.cpuMillis - reserve.cpuMillis),
          memoryBytes: Math.max(0, capacity.memoryBytes - reserve.memoryBytes),
        },
        // Keep 10 % of the disk free for the system and logs.
        diskBytes: Math.floor(capacity.diskBytes * 0.9),
        runtimes,
        ...(n.isolation ? { isolation: schedulerIsolation(n.isolation) } : {}),
        ...(n.kvm ? { kvm: { usable: n.kvm.usable, optOut: n.kvm.optOut } } : {}),
        ...(n.virtualMachines === undefined ? {} : { virtualMachines: n.virtualMachines }),
        // VM disk copies only where the VM can fail over to (3.35): nodes without full-VM support hold none.
        ...(n.blockVolumes !== undefined
          ? { blockVolumes: n.blockVolumes }
          : n.virtualMachines !== true
            ? { blockVolumes: false }
            : {}),
        ...(n.arch ? { arch: n.arch } : {}),
        reachable: n.reachable,
        ...(n.drbd9 === undefined ? {} : { drbd9: n.drbd9 }),
        ...(n.notReady ? { notReady: n.notReady } : {}),
        ...(n.features ? { features: [...n.features] } : {}),
      };
    });
}

const ISOLATION_STATE_NAMES = new Set<string>([
  'ready',
  'unsupported',
  'installation-failed',
  'probe-failed',
  'disabled-by-admin',
]);

/** The known levels / states of a node's probe results (agents may report more than this build knows). */
function schedulerIsolation(isolation: NonNullable<PlannerNode['isolation']>): NonNullable<SchedulerNode['isolation']> {
  const result: NonNullable<SchedulerNode['isolation']> = {};

  for (const [level, probe] of Object.entries(isolation)) {
    if (!isRuntime(level) || !probe || !ISOLATION_STATE_NAMES.has(probe.state)) continue;

    result[level as Runtime] = {
      state: probe.state as IsolationState,
      ...(probe.reasonCode ? { reasonCode: probe.reasonCode } : {}),
      ...(probe.reason ? { reason: probe.reason } : {}),
    };
  }

  return result;
}

export interface WorkloadChange {
  action: 'start' | 'stop' | 'move';
  replica: string;
  from?: string;
  to?: string;
  /**
   * Migration method (3.10): live (CRIU pre-copy), stop-and-copy (gVisor), vm-live (QEMU: full VMs, generic
   * microVMs), blue / green for stateless replicas, short stop for stateful ones.
   */
  method?: MigrationMethod;
  /**
   * The method as explained in the plan: `live`, `stop-and-copy (gVisor)`, `vm-live (QEMU)`, `microvm-live (QEMU)`,
   * `short-stop (<reason>)`.
   */
  methodLabel?: string;
}

/**
 * A volume copy a plan adds on a node for a volume that exists already (M6 gate), e.g. one held back while the node
 * was joining: listed with the plan's workload changes as "copy added on <node>".
 */
export interface VolumeCopyChange {
  action: 'copy';
  volume: string;
  to: string;
  /** `sync` (same site as the primary) or `remote` (another site). */
  copy: 'sync' | 'remote';
}

/**
 * Copies a schedule adds to existing volumes (new holders, not new volumes; dropped copies are not listed). Sorted by
 * volume and node.
 */
export function volumeCopyChanges(
  current: readonly VolumePlacement[],
  next: readonly VolumePlacement[],
): VolumeCopyChange[] {
  const before = new Map(current.map((v) => [v.volume, new Set([v.primary, ...v.syncReplicas, ...v.remoteReplicas])]));
  const changes: VolumeCopyChange[] = [];

  for (const v of next) {
    const holders = before.get(v.volume);

    if (!holders) continue;

    for (const [nodes, copy] of [
      [[v.primary, ...v.syncReplicas], 'sync'],
      [v.remoteReplicas, 'remote'],
    ] as const)
      for (const node of nodes)
        if (!holders.has(node)) changes.push({ action: 'copy', volume: v.volume, to: node, copy });
  }

  return changes.sort((a, b) => a.volume.localeCompare(b.volume) || a.to.localeCompare(b.to));
}

export function diffPlacements(
  before: readonly ReplicaPlacement[],
  after: readonly ReplicaPlacement[],
  statefulServices: ReadonlySet<string>,
  choices: ReadonlyMap<string, MigrationChoice> = new Map(),
): WorkloadChange[] {
  const old = new Map(before.map((p) => [p.replica, p.node]));
  const next = new Map(after.map((p) => [p.replica, p]));
  const changes: WorkloadChange[] = [];

  for (const p of after) {
    const from = old.get(p.replica);

    if (!from) changes.push({ action: 'start', replica: p.replica, to: p.node });
    else if (from !== p.node) {
      const choice = choices.get(p.replica);

      changes.push({
        action: 'move',
        replica: p.replica,
        from,
        to: p.node,
        method: choice?.method ?? (statefulServices.has(p.service) ? 'short-stop' : 'blue-green'),
        ...(choice ? { methodLabel: choice.label } : {}),
      });
    }
  }

  for (const [replica, node] of old) {
    if (!next.has(replica)) changes.push({ action: 'stop', replica, from: node });
  }

  return changes.sort((a, b) => a.replica.localeCompare(b.replica));
}

/**
 * Whether a schedule places exactly what is placed now: the same replicas on the same nodes and the same volume
 * holders (order of replica lists ignored). Controllers that re-plan in a loop persist only when this is false.
 */
export function samePlacements(
  current: { replicas: readonly ReplicaPlacement[]; volumes: readonly VolumePlacement[] },
  next: { replicas?: readonly ReplicaPlacement[]; volumes?: readonly VolumePlacement[] },
): boolean {
  const replicas = (list: readonly ReplicaPlacement[]) =>
    canonicalJson(list.map((r) => `${r.replica}@${r.node}`).sort());
  const volumes = (list: readonly VolumePlacement[]) =>
    canonicalJson(
      list
        .map((v) => ({
          volume: v.volume,
          primary: v.primary,
          syncReplicas: [...v.syncReplicas].sort(),
          remoteReplicas: [...v.remoteReplicas].sort(),
        }))
        .sort((a, b) => a.volume.localeCompare(b.volume)),
    );

  return (
    replicas(current.replicas) === replicas(next.replicas ?? []) &&
    volumes(current.volumes) === volumes(next.volumes ?? [])
  );
}

/**
 * Whether a schedule changes the volume holders against what is placed (copies added, dropped or moved; replicas
 * ignored). An applied plan persists such a schedule even without workload changes: copies held back while a node was
 * joining are added by the next plan once it is ready (M6 gate).
 */
export function volumeHoldersChanged(current: readonly VolumePlacement[], next: readonly VolumePlacement[]): boolean {
  return !samePlacements({ replicas: [], volumes: current }, { volumes: next });
}

/**
 * Address slots of a replica (3.35): VM replicas get one address per NIC and family (`vm-planning.utils.ts`
 * `addressFamiliesOf`); undefined = one address per pod subnet of the node (containers).
 */
export type AddressFamilies = (replica: string) => ('v4' | 'v6')[] | undefined;

const familyOfAddress = (address: string): 'v4' | 'v6' => (address.includes(':') ? 'v6' : 'v4');

/**
 * Container addresses (3.4): a replica keeps its addresses while it stays on its node; a moved replica gets new
 * ones in the target node's pod subnets (its service IP stays the same). `.0` and the gateway `.1` are reserved.
 * Replicas with a slot layout (`families`, VMs with several NICs) keep each slot's address while its family stays,
 * so adding a NIC keeps the existing ones.
 */
export function allocateWorkloadAddresses(
  placements: readonly ReplicaPlacement[],
  podSubnets: ReadonlyMap<string, string[]>,
  existing: ReadonlyMap<string, { node: string; addresses: string[] }>,
  /** Addresses taken outside `placements` (migration targets, cron runs), per node. */
  reserved: ReadonlyMap<string, readonly string[]> = new Map(),
  families: AddressFamilies = () => undefined,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const used = new Map<string, IpAddress[]>(
    [...reserved].map(([node, addresses]): [string, IpAddress[]] => [node, addresses.map(mustParseIp)]),
  );
  const usedOn = (node: string) => used.get(node) ?? [];
  /** The slots of a replica on a node: its layout restricted to the node's families (subnet per slot). */
  const slotsOf = (p: ReplicaPlacement): string[] => {
    const subnets = podSubnets.get(p.node) ?? [];
    const layout = families(p.replica);

    if (!layout) return subnets;

    return layout.flatMap((f) => subnets.filter((s) => familyOfAddress(s) === f).slice(0, 1));
  };
  // Stays on its node: its addresses (or, with a layout, those whose slot keeps its family) stay taken.
  const kept = new Map<string, (string | null)[]>();

  for (const p of placements) {
    const current = existing.get(p.replica);

    if (!current || current.node !== p.node) continue;

    if (!families(p.replica)) {
      result.set(p.replica, current.addresses);
      used.set(p.node, [...usedOn(p.node), ...current.addresses.map(mustParseIp)]);
      continue;
    }

    const slots = slotsOf(p).map((subnet, i) =>
      current.addresses[i] !== undefined && familyOfAddress(current.addresses[i]) === familyOfAddress(subnet)
        ? current.addresses[i]
        : null,
    );

    kept.set(p.replica, slots);
    used.set(p.node, [...usedOn(p.node), ...slots.filter((a): a is string => !!a).map(mustParseIp)]);
  }

  for (const p of placements) {
    if (result.has(p.replica)) continue;

    const keptSlots = kept.get(p.replica);
    const addresses: string[] = [];

    slotsOf(p).forEach((subnet, i) => {
      const keep = keptSlots?.[i];

      if (keep) {
        addresses.push(keep);

        return;
      }

      const ip = allocateAddress(mustParseCidr(subnet), usedOn(p.node), BigInt(2));

      if (!ip) throw new Error(`pod subnet ${subnet} of node ${p.node} is full`);

      used.set(p.node, [...usedOn(p.node), ip]);
      addresses.push(formatIp(ip));
    });

    result.set(p.replica, addresses);
  }

  return result;
}

/** Stable service IPs (3.4): allocated once per service from the cluster's service pools. */
export function allocateServiceAddresses(
  services: readonly string[],
  network: ClusterNetwork,
  existing: ReadonlyMap<string, { v4: string | null; v6: string | null }>,
): Map<string, { v4: string | null; v6: string | null }> {
  const result = new Map<string, { v4: string | null; v6: string | null }>();
  const usedV4 = [...existing.values()]
    .map((a) => a.v4)
    .filter((a): a is string => !!a)
    .map(mustParseIp);
  const usedV6 = [...existing.values()]
    .map((a) => a.v6)
    .filter((a): a is string => !!a)
    .map(mustParseIp);

  for (const id of services) {
    const current = existing.get(id);

    if (current) {
      result.set(id, current);
      continue;
    }

    const pick = (pool: string | undefined, used: IpAddress[]) => {
      if (!pool) return null;

      const ip = allocateAddress(mustParseCidr(pool), used, BigInt(1));

      if (!ip) throw new Error(`service pool ${pool} is exhausted`);

      used.push(ip);

      return formatIp(ip);
    };

    result.set(id, { v4: pick(network.servicePoolV4, usedV4), v6: pick(network.servicePoolV6, usedV6) });
  }

  return result;
}

/** Automatic labels every workload carries, for selectors and log correlation (3.14). */
export function workloadLabels(
  project: string,
  deployment: string,
  service: ServiceSpec,
  replica: number,
): Record<string, string> {
  return {
    ...service.labels,
    'loadweaver.com/project': project,
    'loadweaver.com/deployment': deployment,
    'loadweaver.com/service': service.name,
    'loadweaver.com/replica': String(replica),
  };
}

/** Compose networks become workload groups whose members can talk (3.11). */
export function composeNetworkGroup(deployment: string, network: string): string {
  return `compose:${deployment}/${network}`;
}

/** What a deployment was applied with (3.22): pinned images, secret versions and the pinned images' inspections. */
export interface PinnedDeployment {
  images: Record<string, string>;
  secretVersions: Record<string, number>;
  generation?: number;
  /** Image config / layers / VM artifact per service (microVMs and VMs, 3.35); absent for older states. */
  imageConfigs?: Record<string, ImageInspection> | null;
}

/**
 * Translates one compose service replica into what the node agent runs. New M7 fields are only emitted where they
 * differ from the old behaviour (`isolation` for the KVM levels, `devices` when requested, `microvm` / `vm` for those
 * kinds), so existing replicas keep their spec hash (M7 0.2).
 */
export function buildWorkloadSpec(
  deployment: ParsedDeployment,
  service: ServiceSpec,
  replica: number,
  addresses: string[],
  dnsDomain: string,
  pinned?: PinnedDeployment,
): WorkloadSpec {
  const vm = deployment.virtualMachines?.[service.name];

  if (vm)
    return buildVmWorkloadSpec(deployment, vm, addresses, dnsDomain, {
      images: pinned?.images ?? {},
      imageConfigs: pinned?.imageConfigs ?? {},
      secretVersions: pinned?.secretVersions,
    });

  const image = pinned?.images[service.name] ?? service.image;
  const microvm =
    service.runtime === 'microvm'
      ? compileMicrovm(service, image, pinned?.imageConfigs?.[service.name] ?? undefined)
      : null;
  // Generic microVMs run the image's process inside the guest: the launcher container keeps its own.
  const guestProcess = !microvm?.generic;
  const healthcheck = microvm ? microvm.healthcheck : service.healthcheck;
  const versioned = (ref: string) =>
    pinned?.secretVersions[ref] && !ref.includes('@') ? `${ref}@${pinned.secretVersions[ref]}` : ref;
  const secretRef = (name: string, list: 'secrets' | 'configs') =>
    deployment.compose[list].find((s) => s.name === name)?.ref ?? `secret://${deployment.project}/${name}`;
  const spec: Omit<WorkloadSpec, 'specHash'> = {
    id: `${serviceId(deployment.project, deployment.name, service.name)}/${replica}`,
    project: deployment.project,
    deployment: deployment.name,
    service: service.name,
    kind: service.kind,
    image: microvm?.image ?? image,
    ...(service.command && guestProcess ? { command: service.command } : {}),
    ...(service.entrypoint && guestProcess ? { entrypoint: service.entrypoint } : {}),
    environment: service.environment,
    labels: {
      ...workloadLabels(deployment.project, deployment.name, service, replica),
      // One-off jobs run once per apply: a new generation is a new container (3.23).
      ...(service.kind === 'job' && pinned?.generation !== undefined
        ? { 'loadweaver.com/generation': String(pinned.generation) }
        : {}),
    },
    ...(service.user && guestProcess ? { user: service.user } : {}),
    ...(service.workingDir && guestProcess ? { workingDir: service.workingDir } : {}),
    ...(service.hostname ? { hostname: service.hostname } : {}),
    addresses,
    dnsSearch: [`${deployment.name}.${deployment.project}.${dnsDomain}`, `${deployment.project}.${dnsDomain}`],
    // Docker family + KVM level only when it differs (spec hash stability, M7 0.2).
    runtime: dockerRuntimeFamily(service.runtime),
    ...(service.runtime === 'sandboxed-kvm' || service.runtime === 'microvm' ? { isolation: service.runtime } : {}),
    ...((service.deviceAccess ?? []).length > 0
      ? { devices: service.deviceAccess.map((d) => ({ path: d.path, permissions: d.permissions })) }
      : {}),
    ...(microvm ? { microvm: microvm.microvm } : {}),
    resources: {
      cpuMillis: service.resources.requests.cpuMillis,
      memoryBytes: service.resources.requests.memoryBytes,
      ...(service.resources.limits.cpuMillis ? { cpuLimitMillis: service.resources.limits.cpuMillis } : {}),
      ...(service.resources.limits.memoryBytes ? { memoryLimitBytes: service.resources.limits.memoryBytes } : {}),
    },
    ...(healthcheck ? { healthcheck } : {}),
    restart: service.kind === 'service' ? service.restart : 'no',
    stopGracePeriodMs: service.stopGracePeriodMs,
    ...(service.stopSignal && guestProcess ? { stopSignal: service.stopSignal } : {}),
    init: service.init,
    readOnly: service.readOnly,
    privileged: service.privileged,
    // In a generic microVM, capabilities apply inside the guest (its process runs as root there); the launcher's set
    // is the agent's.
    capAdd: guestProcess ? service.capAdd : [],
    capDrop: guestProcess ? service.capDrop : [],
    ulimits: service.ulimits,
    extraHosts: service.extraHosts,
    volumes: service.volumes.map((m) =>
      m.type === 'volume'
        ? {
            type: 'volume' as const,
            volume: volumeId(deployment.project, deployment.name, m.source),
            target: m.target,
            readOnly: m.readOnly,
          }
        : m.type === 'bind'
          ? { type: 'bind' as const, source: m.source, target: m.target, readOnly: m.readOnly }
          : { type: 'tmpfs' as const, target: m.target, ...(m.sizeBytes ? { sizeBytes: m.sizeBytes } : {}) },
    ),
    secrets: [
      ...service.secrets.map((s) => ({
        ref: versioned(secretRef(s.source, 'secrets')),
        target: s.target,
        ...(s.mode !== undefined ? { mode: s.mode } : {}),
      })),
      ...service.configs.map((c) => ({
        ref: versioned(secretRef(c.source, 'configs')),
        target: c.target,
        ...(c.mode !== undefined ? { mode: c.mode } : {}),
      })),
    ],
  };

  return { ...spec, specHash: createHash('sha256').update(canonicalJson(spec)).digest('hex').slice(0, 32) };
}
