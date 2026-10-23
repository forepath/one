import type { SearchAction, SearchResult } from '@forepath/loadweaver/frontend/data-access-console';

import { kindIcon } from '../resources/resource-format';

/** Kinds that aren't resources. */
const EXTRA_ICONS: Record<string, string> = {
  Service: 'bi-box',
  Node: 'bi-hdd',
  Plan: 'bi-file-diff',
  Alert: 'bi-bell',
};

export function searchKindIcon(kind: string): string {
  return EXTRA_ICONS[kind] ?? kindIcon(kind);
}

/** `Deployment:shop/web` → kind `Deployment`, key `shop/web`. */
export function splitItem(item: string): { kind: string; key: string } {
  const at = item.indexOf(':');

  return at < 0 ? { kind: '', key: item } : { kind: item.slice(0, at), key: item.slice(at + 1) };
}

function query(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v);

  return entries.length ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
}

/**
 * The console route of a result. The index links resources and services to API-style paths
 * (`/projects/shop/deployments/web`); the console shows resources under `/resources/<Kind>/<name>?project=` and
 * services in the health tree.
 */
export function searchResultRoute(result: Pick<SearchResult, 'id' | 'kind' | 'link'>): string {
  const { kind, key } = splitItem(result.id);

  switch (kind || result.kind) {
    case 'Node':
    case 'Plan':
    case 'Alert':
      return result.link;
    case 'Service': {
      const [project, deployment, service] = key.split('/');

      return project && deployment && service
        ? `/health/service/${encodeURIComponent(project)}/${encodeURIComponent(deployment)}/${encodeURIComponent(service)}`
        : result.link;
    }
    default: {
      // Resources: `Kind:<project>/<name>` (empty project for cluster-level ones and projects themselves).
      const slash = key.lastIndexOf('/');

      if (slash < 0) return result.link;

      const project = key.slice(0, slash);
      const name = key.slice(slash + 1);

      return `/resources/${encodeURIComponent(kind || result.kind)}/${encodeURIComponent(name)}${query({ project })}`;
    }
  }
}

/** The console route of a `navigate` action (plans are created from the resource editor). */
export function searchActionRoute(action: SearchAction): string | null {
  if (!action.link) return null;

  return action.link === '/plans/new' ? '/resources/new' : action.link;
}

/** `POST /nodes/n2/drain`: what an `api` action calls. */
export function searchActionRequest(action: SearchAction): string {
  return action.request ? `${action.request.method.toUpperCase()} ${action.request.path}` : '';
}

export type SearchEntry =
  | { type: 'action'; id: string; action: SearchAction }
  | { type: 'result'; id: string; result: SearchResult }
  /** A favourite without a result (empty query): picking it searches for it. */
  | { type: 'favourite'; id: string; item: string };

export interface SearchSection {
  id: string;
  label: string;
  icon: string;
  entries: SearchEntry[];
}

export function searchKindLabel(kind: string): string {
  switch (kind) {
    case 'Service':
      return $localize`:@@lwConsoleSearch-kindService:Services`;
    case 'Node':
      return $localize`:@@lwConsoleSearch-kindNode:Nodes`;
    case 'Plan':
      return $localize`:@@lwConsoleSearch-kindPlan:Plans`;
    case 'Alert':
      return $localize`:@@lwConsoleSearch-kindAlert:Alerts`;
    case 'Project':
      return $localize`:@@lwConsoleSearch-kindProject:Projects`;
    case 'Deployment':
      return $localize`:@@lwConsoleSearch-kindDeployment:Deployments`;
    default:
      return kind;
  }
}

/**
 * Sections of the palette and the search page: actions, favourites, then the results by kind (in the API's order:
 * recently visited first, then by relevance). Without a query: recently opened items and the favourites.
 */
export function searchSections(input: {
  query: string;
  results: readonly SearchResult[];
  actions: readonly SearchAction[];
  favourites: readonly string[];
  recent: readonly SearchResult[];
}): SearchSection[] {
  const sections: SearchSection[] = [];

  if (!input.query.trim()) {
    const recentIds = new Set(input.recent.map((r) => r.id));

    if (input.recent.length > 0)
      sections.push({
        id: 'recent',
        label: $localize`:@@lwConsoleSearch-recent:Recent`,
        icon: 'bi-clock-history',
        entries: input.recent.map((result) => ({ type: 'result', id: `result:${result.id}`, result })),
      });

    const favourites = input.favourites.filter((f) => !recentIds.has(f));

    if (favourites.length > 0)
      sections.push({
        id: 'favourites',
        label: $localize`:@@lwConsoleSearch-favourites:Favourites`,
        icon: 'bi-star-fill',
        entries: favourites.map((item) => ({ type: 'favourite', id: `favourite:${item}`, item })),
      });

    return sections;
  }

  if (input.actions.length > 0)
    sections.push({
      id: 'actions',
      label: $localize`:@@lwConsoleSearch-actions:Actions`,
      icon: 'bi-lightning',
      entries: input.actions.map((action, i) => ({ type: 'action', id: `action:${i}:${action.title}`, action })),
    });

  const favourites = input.results.filter((r) => r.favourite);

  if (favourites.length > 0)
    sections.push({
      id: 'favourites',
      label: $localize`:@@lwConsoleSearch-favourites:Favourites`,
      icon: 'bi-star-fill',
      entries: favourites.map((result) => ({ type: 'result', id: `result:${result.id}`, result })),
    });

  const byKind = new Map<string, SearchResult[]>();

  for (const result of input.results.filter((r) => !r.favourite))
    byKind.set(result.kind, [...(byKind.get(result.kind) ?? []), result]);

  for (const [kind, results] of byKind)
    sections.push({
      id: `kind:${kind}`,
      label: searchKindLabel(kind),
      icon: searchKindIcon(kind),
      entries: results.map((result) => ({ type: 'result', id: `result:${result.id}`, result })),
    });

  return sections;
}

/** Every entry in display order (keyboard navigation). */
export function flattenSections(sections: readonly SearchSection[]): SearchEntry[] {
  return sections.flatMap((s) => s.entries);
}
