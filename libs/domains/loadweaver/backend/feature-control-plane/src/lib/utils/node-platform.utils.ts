import type { DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * Platform components a node runs (2026-10-30, node page "Workloads" → group "Platform"): derived from the node's
 * stored desired state (what it is asked to run) and the agent's last apply report (layer → status). Read-only, no
 * secrets: only names, roles, counts and the layer's error message.
 */
export const PLATFORM_COMPONENTS = [
  'etcd',
  'postgres',
  'queue',
  'control-plane-api',
  'log-store',
  'object-store',
  'registry',
  'registry-mirror',
  'ingress',
  'dns',
  'vpn-gateway',
  'bgp',
  'rate-limiter',
  'backup-server',
] as const;
export type PlatformComponent = (typeof PLATFORM_COMPONENTS)[number];

export type PlatformComponentRole = 'leader' | 'replica' | 'member' | 'witness' | 'pending' | 'active' | 'standby';
export type PlatformComponentState = 'running' | 'failed' | 'unknown';

export interface NodePlatformComponentDto {
  /** Stable per node (`object-store:2`, `registry-mirror:docker.io`). */
  id: string;
  component: PlatformComponent;
  /** English label (the console localizes by `component`). */
  label: string;
  role?: PlatformComponentRole;
  state: PlatformComponentState;
  /** Short facts (generation, counts) or the layer's error. */
  detail?: string;
}

/** What the agent last reported, and whether it is connected (a disconnected node's state is unknown). */
export interface PlatformReportFacts {
  connected: boolean;
  lastReportSteps: { layer: string; status: string; message?: string }[] | null;
}

/** Postgres role from the member's Patroni (`/patroni`), when the control plane could ask it. */
export type PatroniRole = 'leader' | 'replica' | null;

const LABELS: Record<PlatformComponent, string> = {
  etcd: 'etcd',
  postgres: 'PostgreSQL (Patroni)',
  queue: 'Job queue (Valkey)',
  'control-plane-api': 'Control-plane API',
  'log-store': 'Log store (OpenSearch)',
  'object-store': 'Object store (Garage)',
  registry: 'Registry',
  'registry-mirror': 'Registry mirror',
  ingress: 'Ingress',
  dns: 'Authoritative DNS (bind9)',
  'vpn-gateway': 'VPN gateway',
  bgp: 'External BGP',
  'rate-limiter': 'Rate limiter',
  'backup-server': 'Backup repository server',
};

/** The agent's apply layer each component is reconciled in (`applyStepSchema.layer`). */
const LAYERS: Record<PlatformComponent, string> = {
  etcd: 'control-plane',
  postgres: 'control-plane',
  queue: 'control-plane',
  'control-plane-api': 'control-plane',
  'log-store': 'control-plane',
  'object-store': 'object-store',
  registry: 'registry',
  'registry-mirror': 'registry',
  ingress: 'ingress',
  dns: 'authoritative-dns',
  'vpn-gateway': 'remote-access',
  bgp: 'routing',
  'rate-limiter': 'rate-limiter',
  'backup-server': 'backups',
};

const MAX_DETAIL = 240;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();

  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat;
}

/**
 * State of an apply layer from the last report: applied / unchanged → running, failed → failed (with its message),
 * skipped / not reached / no report / agent disconnected → unknown.
 */
export function layerState(
  report: PlatformReportFacts,
  layer: string,
): { state: PlatformComponentState; error?: string } {
  if (!report.connected) return { state: 'unknown' };

  const step = report.lastReportSteps?.find((s) => s.layer === layer);

  if (!step) return { state: 'unknown' };

  if (step.status === 'failed') return { state: 'failed', ...(step.message ? { error: clip(step.message) } : {}) };

  return step.status === 'applied' || step.status === 'unchanged' ? { state: 'running' } : { state: 'unknown' };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The platform components of a node's desired state, in a stable order. */
export function nodePlatformComponents(
  desired:
    | (Pick<
        DesiredState,
        | 'controlPlane'
        | 'objectStore'
        | 'registry'
        | 'ingress'
        | 'authoritativeDns'
        | 'externalBgp'
        | 'rateLimiter'
        | 'backupServer'
      > & { network?: Pick<DesiredState['network'], 'remoteAccess'> })
    | null,
  report: PlatformReportFacts,
  patroni: PatroniRole = null,
): NodePlatformComponentDto[] {
  if (!desired) return [];

  const result: NodePlatformComponentDto[] = [];
  const add = (
    component: PlatformComponent,
    extra: { id?: string; role?: PlatformComponentRole; detail?: string; state?: PlatformComponentState } = {},
  ) => {
    const layer = layerState(report, LAYERS[component]);
    const state = extra.state ?? layer.state;
    const detail = layer.state === 'failed' && layer.error ? layer.error : extra.detail;

    result.push({
      id: extra.id ?? component,
      component,
      label: LABELS[component],
      ...(extra.role ? { role: extra.role } : {}),
      state,
      ...(detail ? { detail } : {}),
    });
  };
  const cp = desired.controlPlane;

  if (cp?.role === 'witness') add('etcd', { role: 'witness' });

  if (cp?.role === 'member') {
    const voters = cp.members.filter((m) => !m.witness).length;

    add('etcd', { role: 'member', detail: plural(cp.members.length, 'member', 'members') });
    add('postgres', {
      role: patroni ?? 'member',
      detail: `scope ${cp.postgresScope ?? cp.scope} · ${plural(voters, 'member', 'members')}`,
    });
    add('queue');

    if (cp.database === 'pending')
      // The member waits with its API replica until the external control plane handed the database over (3.43).
      add('control-plane-api', { role: 'pending', state: 'unknown', detail: 'waits for the database handover' });
    else add('control-plane-api', { role: 'replica' });

    if (cp.logStore) add('log-store', { role: 'member', detail: `heap ${cp.logStore.heapMb} MiB` });
  }

  for (const generation of [...(desired.objectStore?.generations ?? [])].sort((a, b) => a.generation - b.generation))
    add('object-store', {
      id: `object-store:${generation.generation}`,
      detail: `generation ${generation.generation} · replication ${generation.replicationFactor} · zone ${generation.zone}`,
    });

  if (desired.registry) {
    const registry = desired.registry;

    add('registry', {
      detail: `generation ${registry.generation}${registry.readOnly ? ' · read-only (object-store migration)' : ''}`,
    });

    for (const mirror of registry.mirrors)
      add('registry-mirror', { id: `registry-mirror:${mirror.host}`, detail: mirror.host });
  }

  if (desired.ingress) {
    const ingress = desired.ingress;

    add('ingress', {
      detail: `${plural(ingress.sites.length, 'site', 'sites')} · ${plural(ingress.addresses.length, 'address', 'addresses')}`,
    });
  }

  if (desired.authoritativeDns) add('dns', { detail: plural(desired.authoritativeDns.zones.length, 'zone', 'zones') });

  const vpn = desired.network?.remoteAccess;

  if (vpn)
    add('vpn-gateway', {
      role: vpn.active ? 'active' : 'standby',
      detail: plural(vpn.peers.length, 'client', 'clients'),
    });

  if (desired.externalBgp)
    add('bgp', {
      detail: `AS${desired.externalBgp.asn} · ${plural(desired.externalBgp.peers.length, 'peer', 'peers')}`,
    });

  if (desired.rateLimiter) add('rate-limiter');

  if (desired.backupServer && desired.backupServer.repositories.length > 0)
    add('backup-server', {
      detail: plural(desired.backupServer.repositories.length, 'repository', 'repositories'),
    });

  return result;
}

/** Postgres role from Patroni's `GET /patroni` answer (`role`: `primary` / `master` / `replica` / `standby_leader`). */
export function patroniRole(body: unknown): PatroniRole {
  const role = (body as { role?: unknown } | null)?.role;

  if (role === 'primary' || role === 'master') return 'leader';

  if (role === 'replica' || role === 'standby_leader' || role === 'sync_standby') return 'replica';

  return null;
}
