import type { PlanStatus, SearchAction, SearchResult } from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcCommandGroup, FpcCommandItem } from '@forepath/shared/frontend/ui-components';

import { formatSearch, parseSearch } from '../list-search';

import { resourceObjectRoute } from '../objects/object-route';
import { PLAN_STATUS_TONE } from '../plans/plan-format';
import { kindDisplayName, kindIcon } from '../resources/resource-format';

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

/**
 * The console route of a result. The index links resources and services to API-style paths
 * (`/projects/shop/deployments/web`); the console shows resources on their object pages (`/resources/...`, 3.37) and
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
        ? `/observe/health/service/${encodeURIComponent(project)}/${encodeURIComponent(deployment)}/${encodeURIComponent(service)}`
        : result.link;
    }
    default: {
      // Resources: `Kind:<project>/<name>` (empty project for cluster-level ones and projects themselves).
      const slash = key.lastIndexOf('/');

      if (slash < 0) return result.link;

      const project = key.slice(0, slash);
      const name = key.slice(slash + 1);

      return resourceObjectRoute({ kind: kind || result.kind, name, project: project || null })
        .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
        .join('/');
    }
  }
}

/** The console route of a `navigate` action. */
export function searchActionRoute(action: SearchAction): string | null {
  return action.link || null;
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

/** A section (plural) label per kind (D7, LW-21): no raw identifiers like `WorkloadGroup` as headers. */
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
    case 'WorkloadGroup':
      return $localize`:@@lwConsoleSearch-kindWorkloadGroup:Groups`;
    case 'NodeGroup':
      return $localize`:@@lwConsoleSearch-kindNodeGroup:Node groups`;
    case 'Policy':
      return $localize`:@@lwConsoleSearch-kindPolicy:Policies`;
    case 'DnsRecord':
      return $localize`:@@lwConsoleSearch-kindDnsRecord:DNS records`;
    case 'DnsZone':
      return $localize`:@@lwConsoleSearch-kindDnsZone:DNS zones`;
    case 'AlertRule':
      return $localize`:@@lwConsoleSearch-kindAlertRule:Alert rules`;
    case 'Dashboard':
      return $localize`:@@lwConsoleSearch-kindDashboard:Dashboards`;
    case 'StatusPage':
      return $localize`:@@lwConsoleSearch-kindStatusPage:Status pages`;
    case 'IpPool':
      return $localize`:@@lwConsoleSearch-kindIpPool:IP pools`;
    case 'BackupPolicy':
      return $localize`:@@lwConsoleSearch-kindBackupPolicy:Backup policies`;
    case 'Site':
      return $localize`:@@lwConsoleSearch-kindSite:Sites`;
    case 'VirtualMachine':
      return $localize`:@@lwConsoleSearch-kindVirtualMachine:Virtual machines`;
    default:
      return humanizeKind(kind);
  }
}

/** The singular label of a kind in a result title ("Alert rule shop/cpu"). */
export function searchKindSingular(kind: string): string {
  switch (kind) {
    case 'Service':
      return $localize`:@@lwConsoleSearch-oneService:Service`;
    case 'Node':
      return $localize`:@@lwConsoleSearch-oneNode:Node`;
    case 'Plan':
      return $localize`:@@lwConsoleSearch-onePlan:Plan`;
    case 'Project':
      return $localize`:@@lwConsoleSearch-oneProject:Project`;
    case 'Deployment':
      return $localize`:@@lwConsoleSearch-oneDeployment:Deployment`;
    case 'WorkloadGroup':
      return $localize`:@@lwConsoleSearch-oneWorkloadGroup:Group`;
    case 'NodeGroup':
      return $localize`:@@lwConsoleSearch-oneNodeGroup:Node group`;
    case 'Policy':
      return $localize`:@@lwConsoleSearch-onePolicy:Policy`;
    case 'DnsRecord':
      return $localize`:@@lwConsoleSearch-oneDnsRecord:DNS record`;
    case 'DnsZone':
      return $localize`:@@lwConsoleSearch-oneDnsZone:DNS zone`;
    case 'AlertRule':
      return $localize`:@@lwConsoleSearch-oneAlertRule:Alert rule`;
    case 'Dashboard':
      return $localize`:@@lwConsoleSearch-oneDashboard:Dashboard`;
    case 'StatusPage':
      return $localize`:@@lwConsoleSearch-oneStatusPage:Status page`;
    case 'IpPool':
      return $localize`:@@lwConsoleSearch-oneIpPool:IP pool`;
    case 'BackupPolicy':
      return $localize`:@@lwConsoleSearch-oneBackupPolicy:Backup policy`;
    case 'Site':
      return $localize`:@@lwConsoleSearch-oneSite:Site`;
    case 'VirtualMachine':
      return $localize`:@@lwConsoleSearch-oneVirtualMachine:Virtual machine`;
    default:
      return kindDisplayName(kind);
  }
}

/** `BackupPolicy` → `Backup policy` (kinds without a label yet). */
function humanizeKind(kind: string): string {
  const words = kind.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');

  return words.map((w, i) => (i === 0 ? w : /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

/** A plan result's status (the server title ends in `(<status>)`), for its badge. */
export function searchResultStatus(result: Pick<SearchResult, 'kind' | 'title'>): PlanStatus | null {
  if (result.kind !== 'Plan') return null;

  const status = /\(([a-z-]+)\)$/.exec(result.title)?.[1];

  return status && status in PLAN_STATUS_TONE ? (status as PlanStatus) : null;
}

/**
 * A result's title in the console's words (D7 / D11, LW-21): translated kind + name (`Alert rule shop/cpu`), plans
 * without their id (`Plan shop` + a status badge), alerts and unknown shapes as the server titles them.
 */
export function searchResultTitle(result: Pick<SearchResult, 'kind' | 'title' | 'name' | 'project'>): string {
  if (result.kind === 'Alert') return result.title;

  if (result.kind === 'Plan') {
    const plan = searchKindSingular('Plan');

    return result.project ? `${plan} ${result.project}` : plan;
  }

  // Without a `name` (older control planes): a server title `<Kind> <ref>` still gets the readable kind
  // ("BackupPolicy shop/nightly" → "Backup policy shop/nightly", LW-21 round 2).
  if (!result.name) {
    return result.title.startsWith(`${result.kind} `)
      ? `${searchKindSingular(result.kind)}${result.title.slice(result.kind.length)}`
      : result.title;
  }

  if (result.kind === 'Service') {
    // `Service shop/store/web`: the title carries project / deployment / service.
    const path = result.title.replace(/^\S+\s+/, '');

    return `${searchKindSingular('Service')} ${path}`;
  }

  const prefix = result.project && result.kind !== 'Project' ? `${result.project}/` : '';

  return `${searchKindSingular(result.kind)} ${prefix}${result.name}`;
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

/** Scope tokens of the palette (3.37): `in:project/shop` (or `in:shop`), `kind:VirtualMachine`; the rest is searched. */
export interface PaletteQuery {
  text: string;
  project: string | null;
  kind: string | null;
}

export function parsePaletteQuery(query: string): PaletteQuery {
  const parsed = parseSearch(query, ['in', 'kind']);
  const scope = parsed.filters.find((t) => t.field === 'in' && !t.negated)?.value ?? null;
  const kind = parsed.filters.find((t) => t.field === 'kind' && !t.negated)?.value ?? null;

  return {
    text: formatSearch(parsed.text),
    project: scope ? scope.replace(/^project\//i, '') : null,
    kind,
  };
}

/** Results inside the palette's scope (kind: case-insensitive prefix, so `kind:VM` finds virtual machines too). */
export function scopedResults(results: readonly SearchResult[], scope: PaletteQuery): SearchResult[] {
  const kind = scope.kind?.toLowerCase() ?? null;
  const kindMatches = (k: string) =>
    !kind || k.toLowerCase().startsWith(kind) || (kind === 'vm' && k === 'VirtualMachine');

  return results.filter((r) => kindMatches(r.kind) && (!scope.project || r.project === scope.project));
}

/** A palette entry: a search entry, a "go to tab" command of the open object page, or "All results". */
export type PaletteEntry = SearchEntry | { type: 'tab'; id: string; tab: string } | { type: 'all'; id: string };

/** The palette's groups (`fpc-command-palette`): search sections, then the open object's tabs. */
export function paletteGroups(
  sections: readonly SearchSection[],
  tabs: readonly { id: string; label: string; icon: string }[],
  query: string,
  labels: { tabs: string; goToTab: string; favourite: string; action: string },
): FpcCommandGroup<PaletteEntry>[] {
  const q = query.trim().toLowerCase();
  const groups: FpcCommandGroup<PaletteEntry>[] = sections.map((section) => ({
    id: section.id,
    label: section.label,
    items: section.entries.map((entry): FpcCommandItem<PaletteEntry> => {
      switch (entry.type) {
        case 'action':
          return {
            id: entry.id,
            label: entry.action.title,
            icon: entry.action.kind === 'api' ? 'lightning-charge' : 'arrow-right-circle',
            badge: labels.action,
            data: entry,
          };
        case 'favourite': {
          const { kind, key } = splitItem(entry.item);

          return { id: entry.id, label: key, hint: kind, icon: 'star-fill', data: entry };
        }
        default:
          return {
            id: entry.id,
            label: searchResultTitle(entry.result),
            hint: entry.result.project,
            icon: searchKindIcon(entry.result.kind).replace(/^bi-/, ''),
            badge: entry.result.favourite ? labels.favourite : null,
            data: entry,
          };
      }
    }),
  }));
  const tabItems = tabs
    .filter((tab) => !q || tab.label.toLowerCase().includes(q) || 'tab'.startsWith(q))
    .map(
      (tab): FpcCommandItem<PaletteEntry> => ({
        id: `tab:${tab.id}`,
        label: tab.label,
        icon: tab.icon,
        badge: labels.goToTab,
        data: { type: 'tab', id: `tab:${tab.id}`, tab: tab.id },
      }),
    );

  return tabItems.length > 0 ? [...groups, { id: 'tabs', label: labels.tabs, items: tabItems }] : groups;
}
