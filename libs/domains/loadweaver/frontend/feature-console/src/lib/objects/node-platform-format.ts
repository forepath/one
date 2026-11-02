import type {
  NodePlatformComponent,
  NodePlatformComponentKind,
  NodePlatformRole,
  NodePlatformState,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcTableState } from '@forepath/shared/frontend/ui-components';

/**
 * Node page "Workloads" → group "Platform" (2026-10-30): labels, roles and state badges of the platform components a
 * node runs (`GET /nodes/:name/platform`).
 */
const COMPONENT_LABELS: Record<NodePlatformComponentKind, string> = {
  etcd: $localize`:@@lwConsoleNodePlatform-etcd:etcd`,
  postgres: $localize`:@@lwConsoleNodePlatform-postgres:PostgreSQL (Patroni)`,
  queue: $localize`:@@lwConsoleNodePlatform-queue:Job queue (Valkey)`,
  'control-plane-api': $localize`:@@lwConsoleNodePlatform-controlPlaneApi:Control-plane API`,
  'log-store': $localize`:@@lwConsoleNodePlatform-logStore:Log store (OpenSearch)`,
  'object-store': $localize`:@@lwConsoleNodePlatform-objectStore:Object store (Garage)`,
  registry: $localize`:@@lwConsoleNodePlatform-registry:Registry`,
  'registry-mirror': $localize`:@@lwConsoleNodePlatform-registryMirror:Registry mirror`,
  ingress: $localize`:@@lwConsoleNodePlatform-ingress:Ingress`,
  dns: $localize`:@@lwConsoleNodePlatform-dns:Authoritative DNS (bind9)`,
  'vpn-gateway': $localize`:@@lwConsoleNodePlatform-vpnGateway:VPN gateway`,
  bgp: $localize`:@@lwConsoleNodePlatform-bgp:External BGP`,
  'rate-limiter': $localize`:@@lwConsoleNodePlatform-rateLimiter:Rate limiter`,
  'backup-server': $localize`:@@lwConsoleNodePlatform-backupServer:Backup repository server`,
};

const ROLE_LABELS: Record<NodePlatformRole, string> = {
  leader: $localize`:@@lwConsoleNodePlatform-roleLeader:Leader`,
  replica: $localize`:@@lwConsoleNodePlatform-roleReplica:Replica`,
  member: $localize`:@@lwConsoleNodePlatform-roleMember:Member`,
  witness: $localize`:@@lwConsoleNodePlatform-roleWitness:Witness`,
  pending: $localize`:@@lwConsoleNodePlatform-rolePending:Pending`,
  active: $localize`:@@lwConsoleNodePlatform-roleActive:Active`,
  standby: $localize`:@@lwConsoleNodePlatform-roleStandby:Standby`,
};

const STATE_BADGES: Record<NodePlatformState, FpcTableState> = {
  running: { label: $localize`:@@lwConsoleNodePlatform-stateRunning:Running`, tone: 'success', icon: 'check-circle' },
  failed: { label: $localize`:@@lwConsoleNodePlatform-stateFailed:Failed`, tone: 'danger', icon: 'x-circle' },
  unknown: {
    label: $localize`:@@lwConsoleNodePlatform-stateUnknown:Unknown`,
    tone: 'neutral',
    icon: 'question-circle',
  },
};

/** Localized label of a component; the API's English label for kinds this console doesn't know yet. */
export function platformComponentLabel(row: Pick<NodePlatformComponent, 'component' | 'label'>): string {
  return COMPONENT_LABELS[row.component] ?? row.label;
}

/** Localized role, `—` without one; unknown roles as sent. */
export function platformRoleLabel(role: NodePlatformRole | string | undefined): string {
  if (!role) return '—';

  return ROLE_LABELS[role as NodePlatformRole] ?? role;
}

/** State badge (running / failed / unknown; anything else counts as unknown). */
export function platformStateBadge(state: NodePlatformState | string): FpcTableState {
  return STATE_BADGES[state as NodePlatformState] ?? STATE_BADGES.unknown;
}

/** Search over the shown texts (component, role, state, detail); every word must match, case-insensitive. */
export function filterPlatformRows(rows: readonly NodePlatformComponent[], query: string): NodePlatformComponent[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return [...rows];

  return rows.filter((row) => {
    const text = [
      platformComponentLabel(row),
      row.component,
      platformRoleLabel(row.role),
      platformStateBadge(row.state).label,
      row.detail ?? '',
    ]
      .join(' ')
      .toLowerCase();

    return terms.every((term) => text.includes(term));
  });
}
