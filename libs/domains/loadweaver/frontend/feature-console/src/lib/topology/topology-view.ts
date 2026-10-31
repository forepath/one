import { matchesParsedSearch, parseSearch } from '../list-search';
import { contentsQueryFromParams } from '../objects/object-contents';
import { itemSearchDocument, RESOURCE_SEARCH_FIELDS } from '../objects/resource-tree';
import { workspaceAncestors, type WorkspaceModel } from '../workspace/workspace-model';
import { TOPOLOGY_MAP_LAYERS, type TopologyMapLayer } from './topology-format';

/** Live (now, streamed), timeline (flows at a past time) or a pending plan's overlay. */
export type TopologyMode = 'live' | 'timeline' | 'plan';

/** What a map shows (3.37): the whole cluster (Observe › Topology), or a Site / Project object page's Topology tab. */
export type TopologyScope = { kind: 'cluster' } | { kind: 'site'; name: string } | { kind: 'project'; name: string };

/**
 * The map's URL state (3.37): `/observe/topology?select=&q=&layers=&mode=live|timeline|plan&plan=&at=`. Link filters
 * `?kind=&project=&status=` are folded into `q` (`SearchSyntax`); defaults are left out of the URL. `?draft=` belongs to
 * the app-wide draft tray and is never written here.
 */
export interface TopologyUrlState {
  select: string | null;
  q: string;
  layers: TopologyMapLayer[];
  mode: TopologyMode;
  plan: string | null;
  at: string | null;
}

export const TOPOLOGY_DEFAULT_STATE: TopologyUrlState = {
  select: null,
  q: '',
  layers: [...TOPOLOGY_MAP_LAYERS],
  mode: 'live',
  plan: null,
  at: null,
};

type Params = Readonly<Record<string, string | null | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the state from query parameters; invalid values fall back to the defaults. */
export function parseTopologyUrl(params: Params): TopologyUrlState {
  const at = params['at'] && !Number.isNaN(Date.parse(params['at'])) ? new Date(params['at']).toISOString() : null;
  const plan = params['plan'] && UUID.test(params['plan']) ? params['plan'] : null;
  const mode = params['mode'];
  const layers =
    params['layers'] === undefined || params['layers'] === null
      ? [...TOPOLOGY_MAP_LAYERS]
      : TOPOLOGY_MAP_LAYERS.filter((l) =>
          (params['layers'] ?? '')
            .split(',')
            .map((v) => v.trim())
            .includes(l),
        );

  return {
    select: params['select'] && params['select'].length <= 300 ? params['select'] : null,
    q: contentsQueryFromParams(params).slice(0, 200),
    layers,
    mode: mode === 'live' || mode === 'timeline' || mode === 'plan' ? mode : plan ? 'plan' : at ? 'timeline' : 'live',
    plan,
    at,
  };
}

/** Query parameters for a state (merge them into the URL): `null` removes a parameter. */
export function topologyUrlParams(state: TopologyUrlState): Record<string, string | null> {
  const allLayers = TOPOLOGY_MAP_LAYERS.every((l) => state.layers.includes(l));

  return {
    select: state.select,
    q: state.q.trim() || null,
    // Link filters were folded into `q`.
    kind: null,
    project: null,
    status: null,
    // `layers=` (empty) means all switched off, so it is written whenever not all are on.
    layers: allLayers ? null : TOPOLOGY_MAP_LAYERS.filter((l) => state.layers.includes(l)).join(','),
    mode: state.mode === 'live' ? null : state.mode,
    plan: state.mode === 'plan' ? state.plan : null,
    at: state.mode === 'timeline' ? state.at : null,
  };
}

/**
 * Items a scoped map keeps (null = the whole cluster): a site with everything inside it; a project's items with their
 * containers (site / node boxes) and their own children (replicas).
 */
export function topologyScopeIds(model: WorkspaceModel, scope: TopologyScope | null): ReadonlySet<string> | null {
  if (!scope || scope.kind === 'cluster') return null;

  const out = new Set<string>();
  const addTree = (id: string): void => {
    if (out.has(id)) return;

    out.add(id);

    for (const child of model.byId.get(id)?.children ?? []) addTree(child);
  };

  if (scope.kind === 'site') {
    if (model.byId.has(`site:${scope.name}`)) addTree(`site:${scope.name}`);

    return out;
  }

  for (const item of model.items) {
    if (item.project !== scope.name) continue;

    addTree(item.id);

    for (const ancestor of workspaceAncestors(model, item.id)) out.add(ancestor);
  }

  return out;
}

/** Ids matching a `SearchSyntax` query (same fields as the tree / Contents); null for an empty query. */
export function topologyMatches(model: WorkspaceModel, query: string): Set<string> | null {
  const parsed = parseSearch(query, RESOURCE_SEARCH_FIELDS);

  if (parsed.terms.length === 0) return null;

  return new Set(model.items.filter((i) => matchesParsedSearch(parsed, itemSearchDocument(i))).map((i) => i.id));
}

/** Restricts a set of item ids to a scope (null scope = unchanged). */
export function withinScope(ids: ReadonlySet<string>, scope: ReadonlySet<string> | null): Set<string> {
  return scope ? new Set([...ids].filter((id) => scope.has(id))) : new Set(ids);
}
