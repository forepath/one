import { UrlSegment, type UrlMatcher } from '@angular/router';
import type { HealthKind, HealthState, HealthTreeNode } from '@forepath/loadweaver/frontend/data-access-console';

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
 * `/health/<key>`: entity keys contain slashes (`deployment/shop/store`), so the rest of the URL is the key —
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
  return `/health/${key}`;
}
