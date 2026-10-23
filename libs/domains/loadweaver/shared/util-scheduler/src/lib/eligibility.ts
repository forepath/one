import {
  KVM_RUNTIMES,
  matchesSelector,
  runtimesAtLeast,
  strongestRuntime,
  type Labels,
  type Runtime,
  type SelectorExpression,
} from '@forepath/loadweaver/shared/util-model';

import type { SchedulerNode, SchedulerService } from './types';

/**
 * Agent protocol features (`util-agent-protocol` `PROTOCOL_FEATURES`) whose fields are refuse-gated: a workload that
 * uses them must never land on an agent without them (the field would be refused, not stripped), so they are hard
 * eligibility rules — unlike `requiredFeatures`, which keeps replicas already placed on older agents.
 */
export const ISOLATION_LADDER_FEATURE = 'isolation-ladder';
export const MICROVM_FEATURE = 'microvm';
export const WORKLOAD_DEVICES_FEATURE = 'workload-devices';
export const VIRTUAL_MACHINES_FEATURE = 'virtual-machines';
export const VM_BLOCK_VOLUMES_FEATURE = 'vm-block-volumes';

/** Derived node label with the strongest ready level (3.1): selectors `runtime ≥ X` match it with `In`. */
export const RUNTIME_LABEL = 'loadweaver.com/runtime';
/** Derived node label per ready level: `runtime.loadweaver.com/<level>: ready`. */
export const RUNTIME_READY_LABEL_PREFIX = 'runtime.loadweaver.com/';

const MAX_DETAILS = 5;

/**
 * The derived runtime labels of a node from its ready levels (3.1), merged into its effective labels so selectors
 * such as `runtime.loadweaver.com/sandboxed-kvm = ready` or `loadweaver.com/runtime In (…)` work.
 */
export function runtimeNodeLabels(runtimes: readonly Runtime[]): Labels {
  const strongest = strongestRuntime(runtimes);

  return {
    ...Object.fromEntries(runtimes.map((level) => [`${RUNTIME_READY_LABEL_PREFIX}${level}`, 'ready'])),
    ...(strongest ? { [RUNTIME_LABEL]: strongest } : {}),
  };
}

/**
 * A `runtime ≥ min` selector term: the node's strongest ready level is `min` or stronger. For node selection by the
 * user only; the service itself still runs at exactly its declared level.
 */
export function runtimeAtLeastExpression(min: Runtime): SelectorExpression {
  return { key: RUNTIME_LABEL, operator: 'In', values: runtimesAtLeast(min) };
}

/** `/dev/kvm` usable on the node and not opted out (node spec `virtualization.kvm: disabled`). */
export function kvmUsable(node: SchedulerNode): boolean {
  return node.kvm?.usable === true && !node.kvm.optOut;
}

/**
 * The node runs `level` (exact level, 3.1): its probe passed. KVM levels are additionally refused on nodes that
 * report KVM as unusable or opted out (the agent never reports them there; this guards against stale capabilities).
 */
export function runsLevel(node: SchedulerNode, level: Runtime): boolean {
  if (!node.runtimes.includes(level)) return false;

  return !KVM_RUNTIMES.includes(level) || (node.kvm?.optOut !== true && node.kvm?.usable !== false);
}

/** Nodes that can hold volume copies: DRBD 9 module present or not reported (3.5). */
export function canHoldVolumes(node: SchedulerNode): boolean {
  return node.drbd9 !== false;
}

/** Nodes that can hold copies of block-mode volumes (VM disks, 3.35). */
export function canHoldBlockVolumes(node: SchedulerNode): boolean {
  return (
    canHoldVolumes(node) &&
    node.blockVolumes !== false &&
    (!node.features || node.features.includes(VM_BLOCK_VOLUMES_FEATURE))
  );
}

export function canRunWorkloads(node: SchedulerNode): boolean {
  return node.lifecycle === 'active' && !node.witness && node.reachable;
}

/**
 * Refuse-gated agent features the service's replicas need (3.1, 3.35): KVM levels need `isolation-ladder` (+
 * `microvm`), `/dev/kvm` needs `workload-devices`, full VMs need `virtual-machines` and block volumes
 * `vm-block-volumes`. The design's VM workload carries `isolation: microvm` without the `microvm` field, so a VM
 * doesn't need the `microvm` feature.
 */
export function isolationFeatures(service: SchedulerService): string[] {
  const features = new Set<string>();

  if (service.runtime === 'sandboxed-kvm' || service.runtime === 'microvm') features.add(ISOLATION_LADDER_FEATURE);

  if (service.runtime === 'microvm' && !service.virtualMachine) features.add(MICROVM_FEATURE);

  if (service.needsKvmDevice) features.add(WORKLOAD_DEVICES_FEATURE);

  if (service.virtualMachine) features.add(VIRTUAL_MACHINES_FEATURE);

  if (service.volumes.some((v) => v.mode === 'block')) features.add(VM_BLOCK_VOLUMES_FEATURE);

  return [...features];
}

function needsFor(service: SchedulerService): string {
  return [
    ...(service.virtualMachine ? ['virtual machines'] : [`runtime ${service.runtime}`]),
    ...(service.needsKvmDevice ? ['device /dev/kvm'] : []),
  ].join(', ');
}

/** Whether the node's agent has every protocol feature the service's new replicas need (unknown features: yes). */
export function hasRequiredFeatures(service: SchedulerService, node: SchedulerNode): boolean {
  return (service.requiredFeatures ?? []).every((f) => !node.features || node.features.includes(f));
}

/** Unschedulable reason when only nodes without the needed agent features would fit. */
export function missingFeaturesReason(service: SchedulerService): string {
  const features = (service.requiredFeatures ?? []).join(', ');

  return `no eligible node with enough capacity has an agent with the protocol feature ${features}${service.requiredFeaturesReason ? ` (needed for ${service.requiredFeaturesReason})` : ''}; update the node agents`;
}

function nodes(count: number): string {
  return `${count} node${count === 1 ? '' : 's'}`;
}

function details(rejected: readonly SchedulerNode[], detail: (node: SchedulerNode) => string): string {
  const shown = rejected.slice(0, MAX_DETAILS).map((n) => `${n.name} ${detail(n)}`);
  const more = rejected.length - shown.length;

  return [...shown, ...(more > 0 ? [`${more} more`] : [])].join(', ');
}

function levelDetail(node: SchedulerNode, level: Runtime): string {
  const kvmLevel = KVM_RUNTIMES.includes(level);

  if (kvmLevel && node.kvm?.optOut) return 'disabled by node spec';

  const status = node.isolation?.[level];

  if (status && status.state !== 'ready') return status.reasonCode ?? status.state;

  if (kvmLevel && node.kvm?.usable === false) return 'E_KVM_UNAVAILABLE';

  return 'not ready';
}

/** The node's architecture is one the service's image has (3.35); unknown architectures pass. */
export function runsArchitecture(service: SchedulerService, node: SchedulerNode): boolean {
  return !service.architectures || !node.arch || service.architectures.includes(node.arch);
}

function kvmDetail(node: SchedulerNode): string {
  if (!node.kvm) return 'KVM not reported';

  return node.kvm.optOut ? 'disabled by node spec' : 'KVM not usable';
}

function vmDetail(node: SchedulerNode): string {
  if (node.kvm?.optOut) return 'disabled by node spec';

  return node.virtualMachines === false ? 'no full-VM support' : 'full-VM support not reported';
}

/** One step of the eligibility funnel: which nodes pass, and the reason when none does. */
interface Stage {
  passes: (node: SchedulerNode) => boolean;
  reason: (rejected: SchedulerNode[]) => string;
}

function stages(service: SchedulerService): Stage[] {
  const level = service.runtime;
  const features = isolationFeatures(service);

  return [
    { passes: canRunWorkloads, reason: () => 'no eligible node (no active node can run workloads)' },
    ...(service.selector
      ? [
          {
            passes: (n: SchedulerNode) => matchesSelector(service.selector ?? {}, { name: n.name, labels: n.labels }),
            reason: (rejected: SchedulerNode[]) =>
              `no eligible node (selector matches none of the ${nodes(rejected.length)} that can run workloads)`,
          },
        ]
      : []),
    ...(service.architectures
      ? [
          {
            passes: (n: SchedulerNode) => runsArchitecture(service, n),
            reason: (rejected: SchedulerNode[]) =>
              `no eligible node (image architectures ${service.architectures?.join(', ')}: 0 of ${nodes(rejected.length)} match — ${details(rejected, (n) => n.arch ?? 'unknown')})`,
          },
        ]
      : []),
    {
      passes: (n) => runsLevel(n, level),
      reason: (rejected) =>
        `no eligible node (runtime ${level}: 0 of ${nodes(rejected.length)} ready — ${details(rejected, (n) => levelDetail(n, level))})`,
    },
    ...(service.needsKvmDevice
      ? [
          {
            passes: kvmUsable,
            reason: (rejected: SchedulerNode[]) =>
              `no eligible node (device /dev/kvm: 0 of ${nodes(rejected.length)} with runtime ${level} have usable KVM — ${details(rejected, kvmDetail)})`,
          },
        ]
      : []),
    ...(service.virtualMachine
      ? [
          {
            passes: (n: SchedulerNode) => n.virtualMachines === true && kvmUsable(n),
            reason: (rejected: SchedulerNode[]) =>
              `no eligible node (virtual machines: 0 of ${nodes(rejected.length)} with runtime ${level} support full VMs — ${details(rejected, vmDetail)})`,
          },
        ]
      : []),
    ...(features.length > 0
      ? [
          {
            passes: (n: SchedulerNode) => !n.features || features.every((f) => n.features?.includes(f)),
            reason: () =>
              `no eligible node has an agent with the protocol features ${features.join(', ')} (needed for ${needsFor(service)}); update the node agents`,
          },
        ]
      : []),
  ];
}

/**
 * Nodes a service may run on, ignoring capacity (3.1, P4): lifecycle, selector, the image architectures, the **exact**
 * isolation level, KVM for `/dev/kvm`, full-VM support and the refuse-gated agent features.
 */
export function eligibleNodes(service: SchedulerService, all: readonly SchedulerNode[]): SchedulerNode[] {
  return stages(service).reduce<SchedulerNode[]>((left, stage) => left.filter(stage.passes), [...all]);
}

/**
 * Why no node is eligible: the first funnel step that leaves no node, with per-node causes, e.g.
 * `no eligible node (runtime microvm: 0 of 5 nodes ready — node-1 E_KVM_UNAVAILABLE, node-2 disabled by node spec)`.
 * `null` when some node is eligible.
 */
export function ineligibilityReason(service: SchedulerService, all: readonly SchedulerNode[]): string | null {
  let left = [...all];

  for (const stage of stages(service)) {
    const passing = left.filter(stage.passes);

    if (passing.length === 0) return stage.reason(left);

    left = passing;
  }

  return null;
}
