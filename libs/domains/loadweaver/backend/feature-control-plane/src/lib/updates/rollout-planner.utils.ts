import {
  imageComponents,
  imageReference,
  packagePins,
  REQUIRED_HOST_PACKAGES,
  type BinaryComponent,
  type KernelModuleComponent,
  type ReleaseManifest,
  type TarballComponent,
} from '@forepath/loadweaver/shared/util-release';

import type { RolloutDiffEntry } from './rollout.entity';

/**
 * Update rollout planning (3.26): control-plane members first, one at a time (Patroni replicas before the leader,
 * which switches over first), then a canary node, then waves — one site at a time and never more nodes per wave
 * than the failure domain tolerates (N+1: one node, or one site with `failureDomain: site`).
 */

export interface PlannerNode {
  name: string;
  site: string;
  /** etcd / Patroni member (witnesses are members too). */
  controlPlane: boolean;
  witness: boolean;
  lifecycle: string;
  /** Replicas the node runs (the canary is the least busy node). */
  replicas: number;
  postgres?: 'leader' | 'replica' | 'unknown';
  /** The node's agent supports release components (protocol feature `components`). */
  components: boolean;
}

export interface PlannedStep {
  index: number;
  wave: number;
  phase: 'control-plane' | 'canary' | 'wave';
  node: string;
  site: string;
  kind: 'components' | 'host';
}

export interface StepPlan {
  steps: PlannedStep[];
  /** Nodes left out, with the reason. */
  skipped: { node: string; reason: string }[];
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Orders the nodes into steps and waves. */
export function planSteps(input: {
  nodes: readonly PlannerNode[];
  failureDomain: 'node' | 'site';
  host: boolean;
}): StepPlan {
  const skipped: StepPlan['skipped'] = [];
  const eligible = input.nodes.filter((n) => {
    // Nodes waiting for their join plan (3.21) get their components from the import, not from a rollout.
    if (n.lifecycle === 'left' || n.lifecycle === 'leaving' || n.lifecycle === 'pending' || n.lifecycle === 'importing')
      return false;

    if (!n.components) {
      skipped.push({
        node: n.name,
        reason: `the agent on ${n.name} predates release components (protocol feature "components"); update it with the installer`,
      });

      return false;
    }

    return true;
  });
  const kind: PlannedStep['kind'] = input.host ? 'host' : 'components';
  const steps: PlannedStep[] = [];
  let wave = 0;
  const push = (n: PlannerNode, phase: PlannedStep['phase'], w: number) =>
    steps.push({ index: steps.length, wave: w, phase, node: n.name, site: n.site, kind });

  // Control-plane members one at a time; the Patroni leader last (it switches over to an updated replica first).
  const rank = (n: PlannerNode) => (n.postgres === 'leader' ? 2 : n.witness ? 0 : 1);
  const members = eligible.filter((n) => n.controlPlane).sort((a, b) => rank(a) - rank(b) || byName(a, b));

  for (const member of members) push(member, 'control-plane', wave++);

  // Canary: the least busy regular node.
  const rest = eligible.filter((n) => !n.controlPlane && !n.witness);
  const canary = [...rest].sort((a, b) => a.replicas - b.replicas || byName(a, b))[0];

  if (canary) push(canary, 'canary', wave++);

  // Waves: one site at a time (the canary's site first), within the failure domain's tolerance.
  const remaining = rest.filter((n) => n !== canary);
  const sites = [...new Set(remaining.map((n) => n.site))].sort((a, b) =>
    a === canary?.site ? -1 : b === canary?.site ? 1 : a < b ? -1 : a > b ? 1 : 0,
  );

  for (const site of sites) {
    const nodes = remaining.filter((n) => n.site === site).sort(byName);
    const size = input.failureDomain === 'site' ? nodes.length : 1;

    for (let i = 0; i < nodes.length; i += size) {
      for (const n of nodes.slice(i, i + size)) push(n, 'wave', wave);

      wave++;
    }
  }

  return { steps, skipped };
}

/** What each wave puts at risk while its nodes restart (3.12): replicas and volumes with no copy elsewhere. */
export function waveRisks(
  steps: readonly PlannedStep[],
  placements: readonly { id: string; node: string; deployment: string; project: string; service: string }[],
  volumes: readonly { id: string; nodes: string[] }[],
  disruptive: boolean,
): { wave: number; nodes: string[]; risk: string[] }[] {
  const waves = [...new Set(steps.map((s) => s.wave))].sort((a, b) => a - b);

  return waves.map((wave) => {
    const nodes = steps.filter((s) => s.wave === wave).map((s) => s.node);
    const down = new Set(nodes);
    const risk: string[] = [];

    if (disruptive) {
      const services = new Map<string, string[]>();

      for (const p of placements) {
        const key = `${p.project}/${p.deployment}/${p.service}`;

        services.set(key, [...(services.get(key) ?? []), p.node]);
      }

      for (const [service, hosts] of services)
        if (hosts.every((h) => down.has(h)))
          risk.push(`${service} has no replica outside ${nodes.join(', ')}: drained (moved) before the reboot`);

      for (const v of volumes)
        if (v.nodes.every((n) => down.has(n)))
          risk.push(`volume ${v.id} has no copy outside ${nodes.join(', ')}: unavailable during the reboot`);
    }

    return { wave, nodes, risk };
  });
}

/** How each component updates (3.26 table), for the plan's diff. */
export const COMPONENT_METHODS: Record<string, string> = {
  'node-agent': 'binary swap + systemd restart (containers keep running: Docker live-restore)',
  'control-plane': 'member by member (the API keeps serving from the others)',
  envoy: 'hot handover with connection draining',
  ratelimit: 'restart (requests fail open meanwhile)',
  valkey: 'restart on the member (queued jobs persist)',
  etcd: 'one member at a time, waiting for quorum',
  postgres: 'replicas first, then switchover, then the old leader',
  opensearch: 'one member at a time, waiting for green',
  garage: 'one member at a time, waiting for quorum',
  registry: 'one member at a time',
  bind9: 'restart (secondaries keep answering)',
  trivy: 'next scan',
  'node-shell': 'next shell',
  bird: 'graceful restart, routes stay installed',
  docker: 'live-restore, containers keep running',
  packages: 'cluster-local apt source',
  'required-packages': 'installed from the cluster-local apt snapshot if missing (no reboot of its own)',
  kernel: 'drain → update → reboot → rejoin',
  gvisor: 'drain → update → reboot → rejoin',
  drbd: 'drain → module build → reboot → rejoin',
  'kvm-modules': 'with the kernel: drain → update → reboot → rejoin, isolation probe before uncordon',
};

/** The node uses KVM (3.1): usable per its last isolation probe and not opted out by its node spec. */
export function kvmInUse(capabilities: Record<string, unknown> | null | undefined): boolean {
  const kvm = capabilities?.['kvm'] as { usable?: boolean; optOut?: boolean } | undefined;

  return !!kvm?.usable && !kvm.optOut;
}

/**
 * KVM modules follow kernel rollouts (3.1): Ubuntu nodes that use KVM get `linux-modules-extra` of the snapshot's
 * kernels in the same host step as the kernel (drain → update → reboot); Debian has KVM in `linux-image-*`.
 */
export function kvmModuleEntries(
  nodes: readonly { name: string; os: string | null; capabilities: Record<string, unknown> | null | undefined }[],
  snapshot: string | undefined,
): RolloutDiffEntry[] {
  return nodes
    .filter((n) => n.os?.startsWith('ubuntu:') && kvmInUse(n.capabilities))
    .map((n) => ({
      node: n.name,
      component: 'kvm-modules',
      from: null,
      to: `linux-modules-extra for the kernels of snapshot ${snapshot ?? 'none'}`,
      method: COMPONENT_METHODS['kvm-modules'],
    }));
}

/** Where a component runs: on members only, on ingress / every node, or the node's host. */
const MEMBER_COMPONENTS = new Set(['control-plane', 'valkey', 'etcd', 'postgres', 'opensearch', 'garage', 'registry']);

export interface DiffNode {
  name: string;
  controlPlane: boolean;
  os: string | null;
  arch: string | null;
  /** Reported versions (components.images, packages, gvisor, drbd) and agent version. */
  agentVersion: string | null;
  images: Record<string, string>;
  packages: Record<string, string>;
  gvisor: string | null;
  drbd: string | null;
}

function imageDigest(reference: string | undefined): string | null {
  if (!reference) return null;

  const at = reference.lastIndexOf('@');

  return at >= 0 ? reference.slice(at + 1) : reference;
}

/**
 * The plan's per-node, per-component diff (current → target). Images compare by digest; host components (packages,
 * gVisor, DRBD) only when the rollout includes host updates.
 */
export function componentDiff(nodes: readonly DiffNode[], target: ReleaseManifest, host: boolean): RolloutDiffEntry[] {
  const out: RolloutDiffEntry[] = [];
  const images = imageComponents(target);
  const agent = target.components['node-agent'] as BinaryComponent | undefined;
  const gvisor = target.components['gvisor'] as TarballComponent | undefined;
  const drbd = target.components['drbd'] as KernelModuleComponent | undefined;

  for (const node of nodes) {
    const entry = (component: string, from: string | null, to: string | null) => {
      if (from !== to)
        out.push({ node: node.name, component, from, to, method: COMPONENT_METHODS[component] ?? 'restart' });
    };

    if (agent) entry('node-agent', node.agentVersion, agent.version);

    for (const [name, image] of Object.entries(images)) {
      if (MEMBER_COMPONENTS.has(name) && !node.controlPlane) continue;

      // Components the node doesn't run (no ingress, no name server) aren't listed.
      if (!MEMBER_COMPONENTS.has(name) && !node.images[name]) continue;

      const current = node.images[name];

      if (imageDigest(current) !== image.digest)
        out.push({
          node: node.name,
          component: name,
          from: current ?? null,
          to: imageReference(image),
          method: COMPONENT_METHODS[name] ?? 'restart',
        });
    }

    if (!host) continue;

    if (gvisor) entry('gvisor', node.gvisor, gvisor.version);

    if (drbd) entry('drbd', node.drbd, drbd.version);

    if (node.os) {
      const pins = packagePins(target, node.os);

      for (const [pkg, version] of Object.entries(pins).sort())
        if (node.packages[pkg] !== version)
          out.push({
            node: node.name,
            component: `package:${pkg}`,
            from: node.packages[pkg] ?? null,
            to: version,
            method:
              pkg === 'bird2'
                ? COMPONENT_METHODS['bird']
                : pkg.startsWith('docker')
                  ? COMPONENT_METHODS['docker']
                  : COMPONENT_METHODS['packages'],
          });

      // Required host packages the node lacks (installed before they were required): installed from the snapshot.
      for (const pkg of REQUIRED_HOST_PACKAGES)
        if (!pins[pkg] && !node.packages[pkg])
          out.push({
            node: node.name,
            component: `package:${pkg}`,
            from: null,
            to: 'snapshot version',
            method: COMPONENT_METHODS['required-packages'],
          });
    }
  }

  return out;
}

/**
 * Whether host steps may let DRBD fall back to LINBIT's SPAAS for kernels the release ships no compat patch / prebuilt
 * module for (3.26): only for online clusters. A cluster counts as air-gapped when it takes bundles by upload only
 * (`Cluster.spec.updates.source: upload`) or when the step's apt snapshot is the bundle's (the upstream archives were
 * unreachable at plan time) — then DRBD builds offline and an uncovered kernel is refused before any change.
 */
export function drbdSpaasAllowed(
  updates: { source?: 'github' | 'mirror' | 'upload' } | undefined,
  snapshotOrigin: 'plan' | 'bundle' | undefined,
): boolean {
  return (updates?.source ?? 'github') !== 'upload' && snapshotOrigin === 'plan';
}
