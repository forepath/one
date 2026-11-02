import { formatDate } from '@angular/common';
import { UrlSegment, type UrlMatcher } from '@angular/router';
import type {
  HealthKind,
  HealthReason,
  HealthState,
  HealthTreeNode,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';

import { matchesSearch, normalizeSearch } from '../list-search';

/** Health as an object-state badge tone (3.38 R10: tone badges for state; the status circle stays for the glyph). */
export const HEALTH_BADGE_TONE: Record<HealthState, FpcBadgeTone> = {
  healthy: 'success',
  degraded: 'warning',
  'at-risk': 'warning',
  failed: 'danger',
  unknown: 'neutral',
};

export const HEALTH_KIND_ICON: Record<HealthKind, string> = {
  cluster: 'bi-diagram-3',
  site: 'bi-geo-alt',
  node: 'bi-hdd-rack',
  project: 'bi-folder',
  deployment: 'bi-box-seam',
  service: 'bi-boxes',
  replica: 'bi-box',
  volume: 'bi-database',
};

export function healthKindLabel(kind: HealthKind): string {
  switch (kind) {
    case 'cluster':
      return $localize`:@@lwConsoleHealth-kindCluster:Cluster`;
    case 'site':
      return $localize`:@@lwConsoleHealth-kindSite:Site`;
    case 'node':
      return $localize`:@@lwConsoleHealth-kindNode:Node`;
    case 'project':
      return $localize`:@@lwConsoleHealth-kindProject:Project`;
    case 'deployment':
      return $localize`:@@lwConsoleHealth-kindDeployment:Deployment`;
    case 'service':
      return $localize`:@@lwConsoleHealth-kindService:Service`;
    case 'replica':
      return $localize`:@@lwConsoleHealth-kindReplica:Replica`;
    default:
      return $localize`:@@lwConsoleHealth-kindVolume:Volume`;
  }
}

/** A health reason code, readable (3.38 D9; unknown codes as they are). */
export function healthReasonLabel(code: string): string {
  switch (code) {
    case 'backups-not-offsite':
      return $localize`:@@lwConsoleHealth-reasonBackupsNotOffsite:Backups not off-site`;
    case 'backups-not-recoverable':
      return $localize`:@@lwConsoleHealth-reasonBackupsNotRecoverable:Backups not recoverable`;
    case 'maintenance':
      return $localize`:@@lwConsoleHealth-reasonMaintenance:Maintenance`;
    case 'never-reported':
      return $localize`:@@lwConsoleHealth-reasonNeverReported:Never reported`;
    case 'no-data':
      return $localize`:@@lwConsoleHealth-reasonNoData:No data`;
    case 'no-n-plus-1':
      return $localize`:@@lwConsoleHealth-reasonNoNPlus1:No spare capacity (N+1)`;
    case 'no-status':
      return $localize`:@@lwConsoleHealth-reasonNoStatus:No status`;
    case 'node-down':
      return $localize`:@@lwConsoleHealth-reasonNodeDown:Node down`;
    case 'nodes-down':
      return $localize`:@@lwConsoleHealth-reasonNodesDown:Nodes down`;
    case 'primary-down':
      return $localize`:@@lwConsoleHealth-reasonPrimaryDown:Primary down`;
    case 'quorum-lost':
      return $localize`:@@lwConsoleHealth-reasonQuorumLost:Quorum lost`;
    case 'quorum-reduced':
      return $localize`:@@lwConsoleHealth-reasonQuorumReduced:Quorum reduced`;
    case 'replica-down':
      return $localize`:@@lwConsoleHealth-reasonReplicaDown:Replica down`;
    case 'rollback-failed':
      return $localize`:@@lwConsoleHealth-reasonRollbackFailed:Rollback failed`;
    case 'single-site':
      return $localize`:@@lwConsoleHealth-reasonSingleSite:Single site`;
    case 'site-down':
      return $localize`:@@lwConsoleHealth-reasonSiteDown:Site down`;
    case 'volumes-at-risk':
      return $localize`:@@lwConsoleHealth-reasonVolumesAtRisk:Volumes at risk`;
    case 'memory-full':
      return $localize`:@@lwConsoleHealth-reasonMemoryFull:Memory almost full`;
    case 'disk-full':
      return $localize`:@@lwConsoleHealth-reasonDiskFull:Disk almost full`;
    case 'restarting':
      return $localize`:@@lwConsoleHealth-reasonRestarting:Restarting`;
    case 'created':
      return $localize`:@@lwConsoleHealth-reasonCreated:Not started yet`;
    default:
      return rollUpReasonLabel(code) ?? code;
  }
}

/** Roll-up codes of the health tree (`nodes-failed`, `replicas-degraded`, …: `<children>-<state>`). */
const ROLL_UP = /^(nodes|replicas|parts|deployments)-(failed|degraded|at-risk)$/;

function rollUpReasonLabel(code: string): string | null {
  const match = ROLL_UP.exec(code);

  if (!match) return null;

  const children = (() => {
    switch (match[1]) {
      case 'nodes':
        return $localize`:@@lwConsoleHealth-childrenNodes:Nodes`;
      case 'replicas':
        return $localize`:@@lwConsoleHealth-childrenReplicas:Replicas`;
      case 'parts':
        return $localize`:@@lwConsoleHealth-childrenParts:Parts`;
      default:
        return $localize`:@@lwConsoleHealth-childrenDeployments:Deployments`;
    }
  })();
  const state = (() => {
    switch (match[2]) {
      case 'failed':
        return $localize`:@@lwConsoleHealth-rollUpFailed:failed`;
      case 'degraded':
        return $localize`:@@lwConsoleHealth-rollUpDegraded:degraded`;
      default:
        return $localize`:@@lwConsoleHealth-rollUpAtRisk:at risk`;
    }
  })();

  return $localize`:@@lwConsoleHealth-reasonRollUp:${children}:children: ${state}:state:`;
}

/** ISO-8601 instants inside server text (e.g. "last seen 2026-10-28T12:47:40.270Z"). */
const ISO_INSTANT = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;

/** Server text with its ISO instants in the locale's short date-time (no raw timestamps in the UI, D7). */
export function formatInstants(text: string, locale: string): string {
  return text.replace(ISO_INSTANT, (iso) => {
    try {
      return formatDate(iso, 'short', locale);
    } catch {
      return iso;
    }
  });
}

/**
 * A reason as one short readable phrase (tree hints, feeds): the translated cause, with the number of affected
 * children for roll-ups ("Nodes failed (2)"); codes without a label fall back to the server message (instants
 * formatted), never `code: message`.
 */
export function healthReasonText(reason: Pick<HealthReason, 'code' | 'message' | 'entities'>, locale: string): string {
  const label = healthReasonLabel(reason.code);

  if (label === reason.code) return formatInstants(reason.message, locale);

  const count = ROLL_UP.test(reason.code) ? (reason.entities?.length ?? 0) : 0;

  return count > 0 ? `${label} (${count})` : label;
}

/** A health entity key (`cluster`, `site/fra1`, `deployment/shop/store`) as kind + name for display. */
export interface HealthEntityRef {
  kind: HealthKind | null;
  /** Without the kind; `null` for the cluster (its kind is its name). */
  name: string | null;
  /** Bootstrap icon class (`bi-…`), `null` for unknown kinds. */
  icon: string | null;
  /** "Site fra1", "Deployment shop/store", "Cluster". */
  label: string;
}

export function healthEntityRef(key: string): HealthEntityRef {
  const slash = key.indexOf('/');
  const kindPart = slash < 0 ? key : key.slice(0, slash);
  const rest = slash < 0 ? '' : key.slice(slash + 1);
  const kind = Object.prototype.hasOwnProperty.call(HEALTH_KIND_ICON, kindPart) ? (kindPart as HealthKind) : null;

  if (!kind) return { kind: null, name: key, icon: null, label: key };

  // `cluster/cluster` (and `cluster`): the kind once, not "Cluster cluster".
  const name = kind === 'cluster' || !rest ? null : rest;

  return {
    kind,
    name,
    icon: HEALTH_KIND_ICON[kind],
    label: name ? `${healthKindLabel(kind)} ${name}` : healthKindLabel(kind),
  };
}

/** A duration in the two largest units, e.g. `3d 4h`, `12m 5s`. */
export function formatDuration(ms: number): string {
  const units: [string, number][] = [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
  ];
  const parts: string[] = [];
  let rest = Math.max(0, Math.round(ms));

  for (const [unit, size] of units) {
    if (parts.length === 2) break;

    const value = Math.floor(rest / size);

    if (value > 0 || parts.length > 0) {
      parts.push(`${value}${unit}`);
      rest -= value * size;
    }
  }

  return parts.length > 0 ? parts.join(' ') : '0s';
}

/** The tree without healthy subtrees (only what needs attention). */
export function unhealthyOnly(nodes: readonly HealthTreeNode[]): HealthTreeNode[] {
  return nodes.flatMap((node) => {
    const children = unhealthyOnly(node.children);

    return node.entity.state !== 'healthy' || children.length > 0 ? [{ ...node, children }] : [];
  });
}

/**
 * The tree narrowed to entities matching the search (name, kind, key, reason codes / messages): a match keeps its
 * subtree, ancestors of matches stay as the path to them.
 */
export function searchHealthTree(nodes: readonly HealthTreeNode[], term: string | null | undefined): HealthTreeNode[] {
  if (!normalizeSearch(term)) return [...nodes];

  return nodes.flatMap((node) => {
    const { entity } = node;
    const values = [
      entity.name,
      entity.key,
      healthKindLabel(entity.kind),
      ...entity.reasons.flatMap((reason) => [reason.code, reason.message]),
    ];

    if (matchesSearch(term, values)) return [node];

    const children = searchHealthTree(node.children, term);

    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

/** Number of entities per state in a tree. */
export function countStates(nodes: readonly HealthTreeNode[]): Partial<Record<HealthState, number>> {
  const counts: Partial<Record<HealthState, number>> = {};
  const walk = (list: readonly HealthTreeNode[]) =>
    list.forEach((n) => {
      counts[n.entity.state] = (counts[n.entity.state] ?? 0) + 1;
      walk(n.children);
    });

  walk(nodes);

  return counts;
}

/**
 * `/observe/health/<key>`: entity keys contain slashes (`deployment/shop/store`), so the rest of the URL is the key —
 * whether it arrives as several segments or as one encoded segment.
 */
export const healthEntityMatcher: UrlMatcher = (segments: UrlSegment[]) => {
  if (segments.length < 2 || segments[0].path !== 'health') return null;

  const key = segments
    .slice(1)
    .map((s) => s.path)
    .join('/');

  return { consumed: segments, posParams: { key: new UrlSegment(key, {}) } };
};

/** The console route of an entity. */
export function healthLink(key: string): string {
  return `/observe/health/${key}`;
}
