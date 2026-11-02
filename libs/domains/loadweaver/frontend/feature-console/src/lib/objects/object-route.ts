import type { ResourceKey } from '@forepath/loadweaver/frontend/data-access-console';

import type { WorkspaceItem } from '../workspace/workspace-model';

/**
 * Object pages (3.37): `/resources/cluster`, `/resources/site/:name`, `/resources/node/:name`, `/resources/project/:project` and
 * `/resources/:kind/:project/:name` (kind lower-case, `-` for cluster-level resources), `?tab=`.
 */
export type ObjectRoute = readonly string[];

/** The project segment of cluster-level resources. */
export const CLUSTER_SCOPE = '-';

export const CLUSTER_ROUTE: ObjectRoute = ['/resources', 'cluster'];

/** The object page of a declared resource. */
export function resourceObjectRoute(key: ResourceKey): ObjectRoute {
  switch (key.kind) {
    case 'Site':
      return ['/resources', 'site', key.name];
    case 'Node':
      return ['/resources', 'node', key.name];
    case 'Project':
      return ['/resources', 'project', key.name];
    default:
      return ['/resources', key.kind.toLowerCase(), key.project ?? CLUSTER_SCOPE, key.name];
  }
}

/** The object page of a Workspace item: its resource, else (stacks, replicas) the resource it belongs to; null for runtime-only items. */
export function objectRoute(
  item: Pick<WorkspaceItem, 'kind' | 'label' | 'resource' | 'project' | 'data'>,
): ObjectRoute | null {
  if (item.resource) return resourceObjectRoute(item.resource);

  switch (item.kind) {
    case 'site':
      return ['/resources', 'site', item.label];
    case 'node':
      return ['/resources', 'node', item.label];
    case 'stack':
    case 'replica':
    case 'service': {
      const deployment = typeof item.data['deployment'] === 'string' ? item.data['deployment'] : null;

      return deployment && item.project ? ['/resources', 'deployment', item.project, deployment] : null;
    }
    default:
      return null;
  }
}

/** Parses `/resources/...` route params back to a resource key (`kind` as the URL has it, lower-case). */
export function objectKeyFromParams(params: {
  kind?: string | null;
  project?: string | null;
  name?: string | null;
}): { kind: string; project: string | null; name: string } | null {
  if (!params.kind || !params.name) return null;

  return {
    kind: params.kind,
    project: params.project && params.project !== CLUSTER_SCOPE ? params.project : null,
    name: params.name,
  };
}

/** The object of an `/resources/...` URL (path only; locale prefix and query ignored), null elsewhere. */
export function objectRefFromUrl(url: string): { kind: string; project: string | null; name: string | null } | null {
  const path = url.split(/[?#]/)[0];
  const match = path.match(/(?:^|\/)resources\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?\/?$/);

  if (!match) return null;

  const [, kind, second, third] = match.map((part) => (part === undefined ? undefined : decodeURIComponent(part)));

  switch (kind) {
    case 'cluster':
      return { kind: 'cluster', project: null, name: null };
    case 'site':
    case 'node':
    case 'project':
      return second ? { kind, project: null, name: second } : null;
    default:
      return kind && second && third ? { kind, project: second === CLUSTER_SCOPE ? null : second, name: third } : null;
  }
}

/**
 * Leading "home" crumb of every object-header trail (user, 2026-10-29): an icon-only house linking to the cluster
 * overview, so a one-level trail still reads as navigation instead of repeating the title as plain text.
 */
export function consoleHomeCrumb(): { label: string; link: string[]; icon: string; iconOnly: true } {
  return {
    label: $localize`:@@lwConsoleResources-cluster:Cluster`,
    link: [...CLUSTER_ROUTE],
    icon: 'house',
    iconOnly: true,
  };
}
