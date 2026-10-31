import type { z } from 'zod';

import { foldDesiredStateEgressForLegacy } from './egress-downgrade';
import type { Envelope } from './envelope';
import { CONTROL_PLANE_TO_AGENT, type AgentHello, type ControlPlaneMessageType } from './messages';

/**
 * Agent-protocol versioning (3.26): the control plane is updated first and must keep working with agents one
 * release behind (N-1). Every schema stays `.strict()` on the agent, so the control plane must never send an N-1
 * agent a field it doesn't know. The agent announces what it speaks in its hello (`protocolVersion`, `features`);
 * the control plane strips every field gated by a feature the node didn't advertise (`forNode`) before sending.
 *
 * Rules for changing the protocol:
 * - Control plane → agent: new fields are optional and listed in `CONTROL_PLANE_FIELD_GATES` behind a feature in
 *   `PROTOCOL_FEATURES`; new message types are listed in `CONTROL_PLANE_MESSAGE_GATES` and never sent to a node
 *   without the feature. A gate either strips the field for nodes without the feature (default) or, where stripping
 *   would silently change what runs (an isolation level, a VM, a device, a block disk), refuses to send the message
 *   at all (`onMissing: 'refuse'`, `GatedFieldRefused`). Agents advertise a feature once they implement it (`agent: true`). No new enum values, no
 *   fields that become required, no removed fields while an N-1 agent may still rely on them.
 * - Agent → control plane: new fields are optional (an N-1 agent doesn't send them); fields are never removed from
 *   the control plane's schema while an N-1 agent may still send them.
 * - On every release the current schemas are frozen as the next N-1 snapshot (`src/compat/`, README); contract
 *   tests check the above against that snapshot.
 */

/**
 * Version of the protocol this build speaks. Bump it in a release whose protocol differs from the last frozen
 * snapshot (then freeze it, see the README). Agents without a version are version 0: the shape of version 1 without
 * `protocolVersion` / `features` in the hello.
 */
export const PROTOCOL_VERSION = 2;

/**
 * Registry of optional protocol features: id → since which protocol version it exists, what it unlocks and whether
 * the node agent built from this source implements it. Features are added by the steps that introduce gated fields
 * or messages (e.g. `live-migration`, `components`, `self-update`, `backups`); the control plane knows all of them,
 * an agent advertises only those it implements (`agent: true`).
 */
export const PROTOCOL_FEATURES = {
  'live-migration': {
    since: 2,
    description:
      'Live migration sessions (migrationPrepare / Precopy / Freeze / Restore / Commit / Abort, migrationProgress) and the desired-state hints for restored replicas (workloads[].restoredFrom, workloads[].hostRoutes)',
    // Control plane: sessions, eligibility, kept addresses. Agent: checkpoint manager (runc / runsc), transfer
    // endpoint, agent-managed restored replicas, kept-address network plugin (M6 step 1b).
    agent: true,
  },
  'drbd-hostnames': {
    since: 2,
    description:
      "Each volume replica's kernel host name for DRBD's `on` sections (volumes[].replicas[].host), from the hellos' `hostname`",
    agent: true,
  },
  components: {
    since: 2,
    description:
      "Release components (desiredState.components): the node's target release with its signed manifest, host update steps (cluster-local apt snapshot, reboot token) and coordinated actions (Patroni switchover); agents report componentVersions in hello / heartbeat",
    agent: true,
  },
  'platform-backups': {
    since: 2,
    description:
      "Backups of the control plane's own data (controlPlane.platformBackups): WAL-G archiving / base backups in Spilo and the OpenSearch snapshot repository through the member's S3 gateway, Postgres point-in-time clones into a new scope",
    agent: true,
  },
  'postgres-tls': {
    since: 2,
    description:
      "The member's Postgres server certificate from the cluster CA (controlPlane.postgresTls): Spilo serves it, the control-plane API connects with TLS and verifies it",
    agent: true,
  },
  'platform-cutover': {
    since: 2,
    description:
      'Cut-over of the control-plane database to a point-in-time clone (controlPlane.platformBackups.postgresCutover) and the database scope after one (controlPlane.postgresScope)',
    agent: true,
  },
  backups: {
    since: 2,
    description:
      'Backups (backupRun / restoreRun, backupProgress) and the repository servers on control-plane members (desiredState.backupServer)',
    agent: true,
  },
  'exec-stdio': {
    since: 2,
    description:
      'Machine exec over live sessions (execOpen.tty = false with user / workingDir / env, execInput.eof, execOutput.stream): no TTY, stdout and stderr apart, binary-safe (Agenstra on Loadweaver)',
    agent: true,
  },
  'egress-policies': {
    since: 2,
    description:
      'Per-source egress settings from policies (network.egressFilter.sources[].mode / blockPrivateNetworks / blockIpLiterals / logAllowed / denyUrlRegexes / denyCidrs): selector-scoped egress modes, URL deny patterns and web denies by address',
    agent: true,
  },
  'node-import': {
    since: 2,
    description:
      'Import of existing Docker hosts and former nodes (3.21): discoveryRequest / discoveryReport for pending nodes, importStep / importProgress for the join plan (components, rsync pre-copy and final pass, source stop / restart, port handover, wiping a former identity)',
    agent: true,
  },
  'drbd-spaas': {
    since: 2,
    description:
      "Host update steps of online clusters may build DRBD with LINBIT's SPAAS for kernels the release ships no compat patch / prebuilt module for (desiredState.components.host.spaas)",
    agent: true,
  },
  // M7 (3.1, 3.35): registered by the types / protocol step; each becomes `agent: true` once the node agent
  // implements it. Until then no node advertises them, so the control plane never sends their fields or messages.
  'isolation-ladder': {
    since: 2,
    description:
      'Isolation levels above the Docker family (workloads[].isolation: sandboxed-kvm, microvm; refused, never stripped), the host settings (desiredState.host: KVM opt-out, probe nonce) and gVisor-KVM checkpoint / restore on the same platform',
    agent: true,
  },
  'workload-devices': {
    since: 2,
    description: 'Allow-listed host devices for workloads (workloads[].devices: /dev/kvm; refused, never stripped)',
    agent: true,
  },
  microvm: {
    since: 2,
    description:
      'MicroVM workloads in the shared launcher (workloads[].microvm: bundled / generic mode, guest image layers and process, guest sizing, tap networking; refused, never stripped)',
    agent: true,
  },
  'virtual-machines': {
    since: 2,
    description:
      'Full virtual machines (workloads[].vm: firmware, CPU, disks, one or more NICs, image, cloud-init, power; refused, never stripped) and the messages vmPower / vmImageImport',
    agent: true,
  },
  'vm-block-volumes': {
    since: 2,
    description:
      'DRBD volumes in block mode as VM disks (volumes[].mode = block, volumes[].initializeFrom; refused, never stripped)',
    agent: true,
  },
  'vm-consoles': {
    since: 2,
    description: 'Serial and VNC consoles of VMs over live sessions (consoleOpen, then the exec data messages)',
    agent: true,
  },
  'vm-migration': {
    since: 2,
    description:
      'QEMU live migration of VMs and generic microVMs (vmMigrationPrepare / Start / Switchover with the migration progress, commit and abort messages)',
    agent: true,
  },
  'capability-updates': {
    since: 2,
    description:
      'Capability changes on the open stream (capabilitiesUpdate, agent → control plane) instead of a fresh hello on a second stream, which would end open live sessions; the control plane announces its features in helloAck',
    agent: true,
  },
  'control-plane-drain': {
    since: 2,
    description:
      'Draining control-plane members stay members (controlPlane.members[].draining, 2026-10-26): the member hands the Postgres leadership over (planned Patroni switchover) and agents prefer the other members',
    agent: true,
  },
  'etcd-bootstrap': {
    since: 2,
    description:
      'Split-brain-safe etcd bootstrap (3.43): agents report whether they hold etcd data (heartbeat.etcd), the control plane picks the one member that bootstraps while none does (controlPlane.etcd); the others join through members holding data',
    agent: true,
  },
  'database-handover': {
    since: 2,
    description:
      "Control-plane database handover (3.43): an external control plane says whether the cluster's database exists on the members yet (controlPlane.database); members start their API replica only once it is ready",
    agent: true,
  },
  'database-fencing': {
    since: 2,
    description:
      "Fenced takeover of the cluster's database (3.43, 2026-10-31): the control plane sends the database epoch (controlPlane.databaseFence); members whose Postgres data belongs to an older epoch move it aside (rows written after the takeover exported, never merged) and start empty, and report it (heartbeat.databaseFence)",
    agent: true,
  },
} as const satisfies Record<string, ProtocolFeatureInfo>;

export interface ProtocolFeatureInfo {
  /** First `PROTOCOL_VERSION` that has the feature. */
  since: number;
  description: string;
  /** The node agent built from this source implements the feature and advertises it in its hello. */
  agent: boolean;
}

export type ProtocolFeature = keyof typeof PROTOCOL_FEATURES;

/** Every registered feature: what the control plane negotiates with nodes. */
export const KNOWN_PROTOCOL_FEATURES: readonly ProtocolFeature[] = Object.keys(PROTOCOL_FEATURES) as ProtocolFeature[];

/** The features the agent built from this source implements and advertises. */
export const SUPPORTED_PROTOCOL_FEATURES: readonly ProtocolFeature[] = KNOWN_PROTOCOL_FEATURES.filter(
  (f) => (PROTOCOL_FEATURES[f] as ProtocolFeatureInfo).agent,
);

/** What the control plane may send to one node, negotiated from its hello. */
export interface NegotiatedProtocol {
  version: number;
  /** Features both sides know; unknown ids from a newer agent are dropped. */
  features: ReadonlySet<string>;
}

/** An agent that hasn't said hello yet, or one built before versioning: no optional features. */
export const LEGACY_PROTOCOL: NegotiatedProtocol = Object.freeze({ version: 0, features: new Set<string>() });

/**
 * Negotiates the protocol with a node from its hello: the lower of both versions and the features both know.
 * `known` defaults to the registry; tests pass their own.
 */
export function negotiate(
  hello: Pick<AgentHello, 'protocolVersion' | 'features'>,
  known: readonly string[] = KNOWN_PROTOCOL_FEATURES,
): NegotiatedProtocol {
  if (!hello.protocolVersion) return LEGACY_PROTOCOL;

  const knownSet = new Set(known);

  return {
    version: Math.min(hello.protocolVersion, PROTOCOL_VERSION),
    features: new Set((hello.features ?? []).filter((f) => knownSet.has(f))),
  };
}

/**
 * A control-plane → agent field only sent to nodes with `feature`. `path` is dot-separated from the payload root;
 * `name[]` descends into every element of an array, `*` into every value of a record
 * (e.g. `workloads[].migration`, `ingress.routes[].mirror`). The gated field must be optional in the schema.
 *
 * `onMissing` decides what happens for a node without the feature when the field is present:
 * - `strip` (default): the field is removed and the rest of the message is sent;
 * - `refuse`: the message is not sent at all (`forNode` / `envelopeForNode` throw `GatedFieldRefused`). For fields
 *   whose removal would silently change what runs: an isolation level (a downgrade), a VM, a device, a block disk
 *   (which would become a formatted filesystem). The scheduler keeps such workloads away from these nodes
 *   (`requiredFeatures`), so a refusal is a safety net that must never fire; the session logs it and raises an alert.
 */
export interface FieldGate<F extends string = string> {
  path: string;
  feature: F;
  onMissing?: 'strip' | 'refuse';
}

/**
 * A refuse-gated field (`onMissing: 'refuse'`) is present in a message for a node without its feature: the message
 * must not be sent (stripping would downgrade the workload).
 */
export class GatedFieldRefused extends Error {
  constructor(
    readonly type: string,
    readonly path: string,
    readonly feature: string,
  ) {
    super(`refusing to send ${type}: ${path} needs the protocol feature ${feature}, which the node doesn't advertise`);
    this.name = 'GatedFieldRefused';
  }
}

export type FieldGates<F extends string = string> = {
  readonly [T in ControlPlaneMessageType]?: readonly FieldGate<F>[];
};

/** Every gated control-plane → agent field (3.26). Add an entry with each new optional field. */
export const CONTROL_PLANE_FIELD_GATES: FieldGates<ProtocolFeature> = {
  desiredState: [
    { path: 'workloads[].restoredFrom', feature: 'live-migration' },
    { path: 'workloads[].hostRoutes', feature: 'live-migration' },
    { path: 'volumes[].replicas[].host', feature: 'drbd-hostnames' },
    { path: 'components', feature: 'components' },
    { path: 'components.host.spaas', feature: 'drbd-spaas' },
    { path: 'controlPlane.platformBackups', feature: 'platform-backups' },
    { path: 'controlPlane.platformBackups.postgresCutover', feature: 'platform-cutover' },
    { path: 'controlPlane.postgresScope', feature: 'platform-cutover' },
    { path: 'controlPlane.postgresTls', feature: 'postgres-tls' },
    // An older agent just doesn't hand over / reorder (as before): stripped.
    { path: 'controlPlane.members[].draining', feature: 'control-plane-drain' },
    // An older agent bootstraps / joins as before (alone → new cluster, else through any member): stripped.
    { path: 'controlPlane.etcd', feature: 'etcd-bootstrap' },
    // An older agent starts its API replica anyway (it crash-loops until the handover): stripped.
    { path: 'controlPlane.database', feature: 'database-handover' },
    // An older agent doesn't fence (the control plane still fences an old primary at the database level): stripped.
    { path: 'controlPlane.databaseFence', feature: 'database-fencing' },
    { path: 'backupServer', feature: 'backups' },
    { path: 'network.egressFilter.sources[].mode', feature: 'egress-policies' },
    { path: 'network.egressFilter.sources[].blockPrivateNetworks', feature: 'egress-policies' },
    { path: 'network.egressFilter.sources[].blockIpLiterals', feature: 'egress-policies' },
    { path: 'network.egressFilter.sources[].logAllowed', feature: 'egress-policies' },
    { path: 'network.egressFilter.sources[].denyUrlRegexes', feature: 'egress-policies' },
    { path: 'network.egressFilter.sources[].denyCidrs', feature: 'egress-policies' },
    // M7 (3.1, 3.35): stripping these would downgrade a workload or format a VM disk, so they are refused.
    { path: 'workloads[].isolation', feature: 'isolation-ladder', onMissing: 'refuse' },
    { path: 'workloads[].devices', feature: 'workload-devices', onMissing: 'refuse' },
    { path: 'workloads[].microvm', feature: 'microvm', onMissing: 'refuse' },
    { path: 'workloads[].vm', feature: 'virtual-machines', onMissing: 'refuse' },
    { path: 'volumes[].mode', feature: 'vm-block-volumes', onMissing: 'refuse' },
    { path: 'volumes[].initializeFrom', feature: 'vm-block-volumes', onMissing: 'refuse' },
    // Host settings (KVM opt-out, probe nonce): an older agent prepares no KVM anyway, so they are stripped.
    { path: 'host', feature: 'isolation-ladder' },
  ],
  migrationPrepare: [
    { path: 'spec.isolation', feature: 'isolation-ladder', onMissing: 'refuse' },
    { path: 'spec.devices', feature: 'workload-devices', onMissing: 'refuse' },
    { path: 'spec.microvm', feature: 'microvm', onMissing: 'refuse' },
    { path: 'spec.vm', feature: 'virtual-machines', onMissing: 'refuse' },
  ],
  execOpen: [
    { path: 'tty', feature: 'exec-stdio' },
    { path: 'user', feature: 'exec-stdio' },
    { path: 'workingDir', feature: 'exec-stdio' },
    { path: 'env', feature: 'exec-stdio' },
  ],
  execInput: [{ path: 'eof', feature: 'exec-stdio' }],
};

export type MessageGates<F extends string = string> = { readonly [T in ControlPlaneMessageType]?: F };

/**
 * Control-plane → agent message types that exist only with a feature (3.26): never sent to a node without it
 * (`envelopeForNode` drops them), so an N-1 agent never sees a type it doesn't know.
 */
export const CONTROL_PLANE_MESSAGE_GATES: MessageGates<ProtocolFeature> = {
  migrationPrepare: 'live-migration',
  migrationPrecopy: 'live-migration',
  migrationFreeze: 'live-migration',
  migrationRestore: 'live-migration',
  migrationCommit: 'live-migration',
  migrationAbort: 'live-migration',
  backupRun: 'backups',
  restoreRun: 'backups',
  discoveryRequest: 'node-import',
  importStep: 'node-import',
  consoleOpen: 'vm-consoles',
  vmPower: 'virtual-machines',
  vmImageImport: 'virtual-machines',
  vmMigrationPrepare: 'vm-migration',
  vmMigrationStart: 'vm-migration',
  vmMigrationSwitchover: 'vm-migration',
  helloAck: 'capability-updates',
};

/** Whether a node may receive a message type at all (its feature, if the type is gated, was advertised). */
export function messageAllowed(
  type: string,
  negotiated: NegotiatedProtocol,
  gates: MessageGates = CONTROL_PLANE_MESSAGE_GATES,
): boolean {
  const feature = gates[type as ControlPlaneMessageType];

  return !feature || negotiated.features.has(feature);
}

type Segment = { key: string; each: 'array' | 'record' | null };

/** Parses a gate path; throws on malformed paths (checked by the unit tests for the real gates). */
export function parseGatePath(path: string): Segment[] {
  const parts = path.split('.');

  return parts.map((part, i) => {
    const last = i === parts.length - 1;

    if (part === '*') {
      if (i === 0 || last) throw new Error(`invalid gate path ${path}: "*" must sit between two keys`);

      return { key: '*', each: 'record' };
    }

    const match = /^([A-Za-z0-9_]+)(\[\])?$/.exec(part);

    if (!match || (last && match[2])) throw new Error(`invalid gate path ${path}`);

    return { key: match[1], each: match[2] ? 'array' : null };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a (non-undefined) value exists at `segments` in any array element / record value on the way. */
function present(value: unknown, segments: Segment[]): boolean {
  const [head, ...rest] = segments;

  if (head.key === '*') return isRecord(value) && Object.values(value).some((v) => present(v, rest));

  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, head.key)) return false;

  const child = value[head.key];

  if (rest.length === 0) return child !== undefined;

  if (head.each === 'array') return Array.isArray(child) && child.some((element) => present(element, rest));

  return present(child, rest);
}

/** Removes the field at `segments` (copy on write: untouched branches keep their identity). */
function strip(value: unknown, segments: Segment[]): unknown {
  const [head, ...rest] = segments;

  if (head.key === '*') {
    if (!isRecord(value)) return value;

    let changed = false;
    const next: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(value)) {
      next[k] = strip(v, rest);
      changed ||= next[k] !== v;
    }

    return changed ? next : value;
  }

  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, head.key)) return value;

  if (rest.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drops the gated key
    const { [head.key]: _removed, ...remaining } = value;

    return remaining;
  }

  const child = value[head.key];
  let next: unknown;

  if (head.each === 'array') {
    if (!Array.isArray(child)) return value;

    const mapped = child.map((element) => strip(element, rest));

    next = mapped.some((element, i) => element !== child[i]) ? mapped : child;
  } else {
    next = strip(child, rest);
  }

  return next === child ? value : { ...value, [head.key]: next };
}

/**
 * Rewrites of a control-plane → agent payload for nodes without a feature, applied before the feature's gated fields
 * are stripped: settings the node can't receive are folded into fields it knows, never looser (M6 review M5).
 */
export interface PayloadDowngrade<F extends string = string> {
  feature: F;
  apply: (payload: unknown) => unknown;
}

export type PayloadDowngrades<F extends string = string> = {
  readonly [T in ControlPlaneMessageType]?: readonly PayloadDowngrade<F>[];
};

export const CONTROL_PLANE_DOWNGRADES: PayloadDowngrades<ProtocolFeature> = {
  desiredState: [{ feature: 'egress-policies', apply: foldDesiredStateEgressForLegacy }],
};

function unmetDowngrades(
  type: string,
  negotiated: NegotiatedProtocol,
  downgrades: PayloadDowngrades,
): readonly PayloadDowngrade[] {
  return (downgrades[type as ControlPlaneMessageType] ?? []).filter((d) => !negotiated.features.has(d.feature));
}

/** The gates of a message type the node doesn't satisfy. */
function unmetGates(type: string, negotiated: NegotiatedProtocol, gates: FieldGates): readonly FieldGate[] {
  return (gates[type as ControlPlaneMessageType] ?? []).filter((gate) => !negotiated.features.has(gate.feature));
}

/**
 * A control-plane → agent message as the node may receive it: every field gated by a feature the node didn't
 * advertise is removed. The payload is never mutated. Throws `GatedFieldRefused` when a refuse-gated field
 * (`onMissing: 'refuse'`) the node lacks the feature for is present.
 */
export function forNode<T extends ControlPlaneMessageType>(
  message: { type: T; payload: z.input<(typeof CONTROL_PLANE_TO_AGENT)[T]> },
  negotiated: NegotiatedProtocol,
  gates: FieldGates = CONTROL_PLANE_FIELD_GATES,
  downgrades: PayloadDowngrades = CONTROL_PLANE_DOWNGRADES,
): { type: T; payload: z.input<(typeof CONTROL_PLANE_TO_AGENT)[T]> } {
  let payload: unknown = message.payload;

  for (const downgrade of unmetDowngrades(message.type, negotiated, downgrades)) payload = downgrade.apply(payload);

  for (const gate of unmetGates(message.type, negotiated, gates)) {
    const segments = parseGatePath(gate.path);

    if (gate.onMissing === 'refuse' && present(payload, segments))
      throw new GatedFieldRefused(message.type, gate.path, gate.feature);

    payload = strip(payload, segments);
  }

  return payload === message.payload
    ? message
    : { type: message.type, payload: payload as z.input<(typeof CONTROL_PLANE_TO_AGENT)[T]> };
}

/**
 * `forNode` on an encoded control-plane → agent envelope, for the one place every message to a node passes
 * (the session's `send`). Envelopes without unmet gates are returned as they are (no re-encoding); otherwise the
 * stripped payload is validated again and re-encoded under the same id, correlation id and channel. Returns `null`
 * for a message type the node must not receive (`CONTROL_PLANE_MESSAGE_GATES`): the caller drops it. Throws
 * `GatedFieldRefused` when the payload carries a refuse-gated field the node lacks the feature for: the caller must
 * not send the message (and must not fall back to a stripped copy).
 */
export function envelopeForNode(
  envelope: Envelope,
  negotiated: NegotiatedProtocol,
  gates: FieldGates = CONTROL_PLANE_FIELD_GATES,
  messageGates: MessageGates = CONTROL_PLANE_MESSAGE_GATES,
  downgrades: PayloadDowngrades = CONTROL_PLANE_DOWNGRADES,
): Envelope | null {
  if (!messageAllowed(envelope.type, negotiated, messageGates)) return null;

  if (
    unmetGates(envelope.type, negotiated, gates).length === 0 &&
    unmetDowngrades(envelope.type, negotiated, downgrades).length === 0
  )
    return envelope;

  const type = envelope.type as ControlPlaneMessageType;
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(envelope.payload)) as unknown;
  const gated = forNode({ type, payload: payload as never }, negotiated, gates, downgrades);

  if (gated.payload === payload) return envelope;

  CONTROL_PLANE_TO_AGENT[type].parse(gated.payload);

  return { ...envelope, payload: new TextEncoder().encode(JSON.stringify(gated.payload)) };
}
