import type {
  ClusterRole,
  ConsoleNode,
  NodeAction,
  NodeLifecycle,
} from '@forepath/loadweaver/frontend/data-access-console';

export type NodeTone = 'success' | 'warning' | 'danger' | 'secondary' | 'info';

export const LIFECYCLE_TONE: Record<NodeLifecycle, NodeTone> = {
  pending: 'info',
  importing: 'info',
  active: 'success',
  cordoned: 'warning',
  draining: 'warning',
  leaving: 'info',
  left: 'secondary',
};

export function lifecycleLabel(lifecycle: NodeLifecycle): string {
  switch (lifecycle) {
    case 'active':
      return $localize`:@@lwConsoleNodes-active:Active`;
    case 'cordoned':
      return $localize`:@@lwConsoleNodes-cordoned:Cordoned`;
    case 'draining':
      return $localize`:@@lwConsoleNodes-draining:Draining`;
    case 'leaving':
      return $localize`:@@lwConsoleNodes-leaving:Leaving`;
    case 'pending':
      return $localize`:@@lwConsoleNodes-pending:Waiting for its join plan`;
    case 'importing':
      return $localize`:@@lwConsoleNodes-importing:Importing`;
    default:
      return $localize`:@@lwConsoleNodes-left:Left`;
  }
}

/** Connection state as a tone: connected nodes by lifecycle, disconnected members in red. */
export function nodeTone(node: ConsoleNode): NodeTone {
  if (node.lifecycle === 'left') return 'secondary';

  if (!node.connected) return 'danger';

  if (node.applyStatus === 'failed') return 'warning';

  return LIFECYCLE_TONE[node.lifecycle];
}

export function nodeIcon(node: ConsoleNode): string {
  if (node.lifecycle === 'left') return 'bi-box-arrow-right';

  if (!node.connected) return 'bi-plug';

  return node.lifecycle === 'active' ? 'bi-check-lg' : 'bi-pause';
}

/** Who may run lifecycle actions (3.17): infra operators and cluster admins; `confirm-lost` cluster admins only. */
export function mayOperateNodes(role: ClusterRole | null | undefined): boolean {
  return role === 'cluster-admin' || role === 'infra-operator';
}

/**
 * Who may add nodes (join tokens, 3.21): infra operators and cluster admins; through the fleet (3.24) only the
 * cluster-wide **admin** grant (console role cluster admin) — the relay refuses join tokens for everyone else.
 */
export function mayJoinNodes(role: ClusterRole | null | undefined, fleetMode: boolean): boolean {
  return fleetMode ? role === 'cluster-admin' : mayOperateNodes(role);
}

/** Through the fleet (3.24) `leave` and `confirm-lost` need the admin grant (the relay refuses them otherwise). */
const FLEET_ADMIN_ACTIONS: readonly NodeAction[] = ['leave', 'confirm-lost'];

/** The actions the API offers for the node's lifecycle (leave only after a drain). */
export function nodeActions(node: ConsoleNode, role: ClusterRole | null | undefined, fleetMode = false): NodeAction[] {
  if (!mayOperateNodes(role)) return [];

  const byLifecycle: Record<NodeLifecycle, NodeAction[]> = {
    // Waiting for / running a join plan (3.21): handled in the import wizard.
    pending: [],
    importing: [],
    active: ['cordon', 'drain'],
    cordoned: ['uncordon', 'drain'],
    draining: ['uncordon', 'leave'],
    leaving: [],
    left: [],
  };
  const lost: NodeAction[] =
    role === 'cluster-admin' && !node.connected && node.lifecycle !== 'left' ? ['confirm-lost'] : [];

  const actions = [...byLifecycle[node.lifecycle], ...lost];

  return fleetMode && role !== 'cluster-admin' ? actions.filter((a) => !FLEET_ADMIN_ACTIONS.includes(a)) : actions;
}

export function actionLabel(action: NodeAction): string {
  switch (action) {
    case 'cordon':
      return $localize`:@@lwConsoleNodes-cordon:Cordon`;
    case 'uncordon':
      return $localize`:@@lwConsoleNodes-uncordon:Uncordon`;
    case 'drain':
      return $localize`:@@lwConsoleNodes-drain:Drain`;
    case 'leave':
      return $localize`:@@lwConsoleNodes-leave:Leave cluster`;
    default:
      return $localize`:@@lwConsoleNodes-confirmLost:Confirm lost`;
  }
}

export function actionIcon(action: NodeAction): string {
  switch (action) {
    case 'cordon':
      return 'bi-pause-circle';
    case 'uncordon':
      return 'bi-play-circle';
    case 'drain':
      return 'bi-box-arrow-down';
    case 'leave':
      return 'bi-box-arrow-right';
    default:
      return 'bi-x-octagon';
  }
}

/** Leave and confirm-lost can't be undone. */
export function actionDangerous(action: NodeAction): boolean {
  return action === 'leave' || action === 'confirm-lost';
}

/** What the confirmation explains before the action runs. */
export function actionConfirmMessage(action: NodeAction, node: string): string {
  switch (action) {
    case 'cordon':
      return $localize`:@@lwConsoleNodes-cordonMessage:No new workloads are placed on ${node}:node:. Running replicas stay.`;
    case 'uncordon':
      return $localize`:@@lwConsoleNodes-uncordonMessage:${node}:node: takes new workloads again.`;
    case 'drain':
      return $localize`:@@lwConsoleNodes-drainMessage:Replicas and volume copies move off ${node}:node: to prepare it for leaving. This takes a while; the node stays a member.`;
    case 'leave':
      return $localize`:@@lwConsoleNodes-leaveMessage:${node}:node: leaves the cluster: its identity is revoked immediately and its tunnels disappear from every other node. It can join again later with a new token.`;
    default:
      return $localize`:@@lwConsoleNodes-confirmLostMessage:Confirm that ${node}:node: is gone for good. Stateful workloads may fail over without quorum and the node's identity is revoked. Only do this when the node can't come back.`;
  }
}

/** `1.0 / 4.0 cores`. */
export function formatCores(millis: number): string {
  return (millis / 1000).toFixed(1);
}

/** Usage share in percent (0–100), null without capacity. */
export function usagePercent(used: number | undefined, total: number | undefined): number | null {
  return used !== undefined && total ? Math.min(100, Math.round((used / total) * 100)) : null;
}

/** Labels `k=v, k2=v2` into a map; empty or malformed entries are skipped. */
export function parseLabels(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter((part) => part.includes('='))
      .map((part) => {
        const index = part.indexOf('=');

        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key]) => key.length > 0),
  );
}

/**
 * The installer line. The join token is never part of it (shell history, process list): the line reads it without
 * echo (`read -rs`, pasted from the console) into `LOADWEAVER_JOIN_TOKEN`, which the installer takes from the
 * environment (`sudo --preserve-env` hands it over).
 */
export function joinCommand(scriptUrl: string): string {
  return (
    `printf 'Join token: ' && read -rs LOADWEAVER_JOIN_TOKEN && echo && export LOADWEAVER_JOIN_TOKEN && ` +
    `curl -fsSL ${scriptUrl} | sudo --preserve-env=LOADWEAVER_JOIN_TOKEN bash -s -- --name <node-name>`
  );
}
