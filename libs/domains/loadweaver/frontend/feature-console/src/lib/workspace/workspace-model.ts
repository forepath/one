import type {
  ConsoleResource,
  ResourceKey,
  TopologyChange,
  TopologyEdge,
  TopologyElement,
  TopologyGraph,
} from '@forepath/loadweaver/frontend/data-access-console';

/**
 * The Workspace (3.36): one model of the cluster for the map and the table, merged from `GET /topology` (what runs
 * where) and `GET /resources` (what is declared). Pure, so the map, the table, the popovers and a web worker share it.
 */

/** The reserved deployment of virtual machines (3.35): replicas `<project>/lw-vm/<name>/0`. */
export const WORKSPACE_VM_DEPLOYMENT = 'lw-vm';

export type WorkspaceItemKind =
  | 'site'
  | 'node'
  /** A deployment's service, logical (table row; on the map as one stack per node). */
  | 'service'
  /** The replicas of one service on one node (map). */
  | 'stack'
  | 'replica'
  | 'vm'
  | 'volume'
  | 'group'
  | 'hostname'
  | 'address'
  | 'external'
  | 'policy'
  | 'deployment'
  /** Any other declared resource (Project, IpPool, DnsZone, AlertRule, …): table + the "Cluster & unplaced" tray. */
  | 'resource';

export interface WorkspaceItem {
  id: string;
  kind: WorkspaceItemKind;
  label: string;
  /** The kind the table and `?kind=` filter by: the resource kind, or a map kind (`Service`, `Volume`, …). */
  typeName: string;
  /** The declared resource behind the item (null for runtime-only items such as replicas, addresses). */
  resource: ResourceKey | null;
  project: string | null;
  /** Map container: site of a node, node of a stack / VM / volume, stack of a replica. */
  parent: string | null;
  /** Where it runs (node, or site for nodes). */
  placement: string | null;
  health: string;
  status: string | null;
  /** Drawn as an element on the map. */
  drawn: boolean;
  /** Has a place on the map (drawn, or through its stacks / edges); false = the "Cluster & unplaced" tray. */
  placed: boolean;
  /** The topology element / edge ids the item stands for (plan overlay, trace). */
  elements: string[];
  /** Children ids (map containment / aggregation). */
  children: string[];
  data: Record<string, unknown>;
}

export interface WorkspaceModel {
  items: WorkspaceItem[];
  byId: ReadonlyMap<string, WorkspaceItem>;
  /** Declared resources without a place on the map. */
  tray: WorkspaceItem[];
  /** Topology edges with their endpoints mapped to drawn items (VM replicas → the VM). */
  edges: TopologyEdge[];
}

/** Kinds the table lists (replicas, stacks, addresses and outside peers are map detail). */
export const WORKSPACE_TABLE_KINDS: ReadonlySet<WorkspaceItemKind> = new Set([
  'site',
  'node',
  'service',
  'vm',
  'volume',
  'group',
  'hostname',
  'policy',
  'deployment',
  'resource',
]);

const MAP_TYPE_NAMES: Record<WorkspaceItemKind, string> = {
  site: 'Site',
  node: 'Node',
  service: 'Service',
  stack: 'Service',
  replica: 'Replica',
  vm: 'VirtualMachine',
  volume: 'Volume',
  group: 'WorkloadGroup',
  hostname: 'Hostname',
  address: 'Address',
  external: 'External',
  policy: 'Policy',
  deployment: 'Deployment',
  resource: 'Resource',
};

/** The item id a declared resource maps to (the same id as its map element where there is one). */
export function workspaceResourceId(key: ResourceKey): string {
  const scoped = (name: string) => (key.project ? `${key.project}/${name}` : name);

  switch (key.kind) {
    case 'Site':
      return `site:${key.name}`;
    case 'Node':
      return `node:${key.name}`;
    case 'WorkloadGroup':
      return `group:${scoped(key.name)}`;
    case 'Deployment':
      return `deployment:${scoped(key.name)}`;
    case 'VirtualMachine':
      return `vm:${scoped(key.name)}`;
    case 'Policy':
      return `policy:${scoped(key.name)}`;
    default:
      return `resource:${key.kind}/${key.project ?? ''}/${key.name}`;
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** Splits a replica id `<project>/<deployment>/<service>/<n>`. */
export function replicaParts(id: string): { project: string; deployment: string; service: string; index: string } {
  const [project, deployment, service, index] = id.replace(/^replica:/, '').split('/');

  return { project, deployment, service, index };
}

/** The worst of several health states (for aggregates: stacks, services, deployments). */
export function worstHealth(states: readonly string[]): string {
  const order = ['critical', 'unhealthy', 'degraded', 'warning', 'unknown', 'healthy'];

  if (states.length === 0) return 'unknown';

  return states.reduce((worst, s) => {
    const a = order.indexOf(worst);
    const b = order.indexOf(s);

    return (b === -1 ? order.length : b) < (a === -1 ? order.length : a) ? s : worst;
  }, 'healthy');
}

/** Merges the map and the declared resources into one model (3.36). */
export function workspaceModel(
  graph: Pick<TopologyGraph, 'elements' | 'edges'> | null,
  resources: readonly ConsoleResource<unknown>[],
): WorkspaceModel {
  const items = new Map<string, WorkspaceItem>();
  const add = (item: Omit<WorkspaceItem, 'children' | 'typeName'> & { typeName?: string }): WorkspaceItem => {
    const existing = items.get(item.id);

    if (existing) return existing;

    const full: WorkspaceItem = { ...item, typeName: item.typeName ?? MAP_TYPE_NAMES[item.kind], children: [] };

    items.set(full.id, full);

    return full;
  };
  const elements = graph?.elements ?? [];
  const nodeSite = new Map(
    elements.filter((e) => e.kind === 'node').map((e) => [e.id, (e.parent ?? '').replace(/^site:/, '')] as const),
  );
  /** VM replica element → VM item id. */
  const vmOfReplica = new Map<string, string>();

  for (const e of elements) {
    const health = str(e.data['health']) ?? 'unknown';

    switch (e.kind) {
      case 'site':
        add(base(e, 'site', { health, resource: { kind: 'Site', name: e.label, project: null } }));
        break;
      case 'node':
        add(
          base(e, 'node', {
            health,
            parent: e.parent ?? null,
            placement: nodeSite.get(e.id) || null,
            resource: { kind: 'Node', name: e.label, project: null },
          }),
        );
        break;
      case 'replica': {
        const { project, deployment, service } = replicaParts(e.id);
        const node = e.parent ?? null;

        if (deployment === WORKSPACE_VM_DEPLOYMENT) {
          const id = `vm:${project}/${service}`;

          vmOfReplica.set(e.id, id);
          add({
            ...base(e, 'vm', { health, parent: node, placement: node?.replace(/^node:/, '') ?? null }),
            id,
            label: service,
            project,
            status: str(e.data['state']),
            resource: { kind: 'VirtualMachine', name: service, project },
          });
          break;
        }

        const serviceId = `service:${project}/${deployment}/${service}`;
        const stackId = `stack:${project}/${deployment}/${service}@${node?.replace(/^node:/, '') ?? ''}`;

        add({
          id: `deployment:${project}/${deployment}`,
          kind: 'deployment',
          label: deployment,
          resource: { kind: 'Deployment', name: deployment, project },
          project,
          parent: null,
          placement: null,
          health: 'unknown',
          status: null,
          drawn: false,
          placed: true,
          elements: [],
          data: {},
        });
        add({
          id: serviceId,
          kind: 'service',
          label: `${deployment}/${service}`,
          resource: { kind: 'Deployment', name: deployment, project },
          project,
          parent: null,
          placement: null,
          health: 'unknown',
          status: null,
          drawn: false,
          placed: true,
          elements: [],
          data: { deployment, service },
        });
        add({
          id: stackId,
          kind: 'stack',
          label: service,
          resource: { kind: 'Deployment', name: deployment, project },
          project,
          parent: node,
          placement: node?.replace(/^node:/, '') ?? null,
          health: 'unknown',
          status: null,
          drawn: true,
          placed: true,
          elements: [],
          data: { deployment, service, service_id: serviceId },
        });
        add({
          ...base(e, 'replica', { health, parent: stackId, placement: node?.replace(/^node:/, '') ?? null }),
          project,
          status: str(e.data['state']),
          resource: { kind: 'Deployment', name: deployment, project },
        });
        break;
      }
      case 'volume': {
        const primary = graph?.edges.find(
          (x) => x.kind === 'volume' && x.source === e.id && x.data['role'] === 'primary',
        )?.target;

        add(
          base(e, 'volume', {
            health,
            parent: primary ?? null,
            placement: primary?.replace(/^node:/, '') ?? null,
          }),
        );
        break;
      }
      case 'group':
        add(
          base(e, 'group', {
            health,
            resource:
              e.data['selector'] || !e.project ? null : { kind: 'WorkloadGroup', name: e.label, project: e.project },
          }),
        );
        break;
      default:
        add(base(e, e.kind, { health }));
    }
  }

  // Aggregates: stacks → services → deployments (replica ids, worst health, replica counts).
  const all = [...items.values()];

  for (const replica of all.filter((i) => i.kind === 'replica')) {
    const stack = items.get(replica.parent as string) as WorkspaceItem;
    const service = items.get(stack.data['service_id'] as string) as WorkspaceItem;
    const deployment = items.get(`deployment:${replica.project}/${replicaParts(replica.id).deployment}`);

    for (const agg of [stack, service, deployment])
      if (agg) {
        agg.elements.push(replica.id);
        agg.health = worstHealth([agg.elements.length === 1 ? replica.health : agg.health, replica.health]);
      }
  }

  for (const item of all)
    item.data = item.kind === 'stack' ? { ...item.data, replicas: item.elements.length } : item.data;

  // Declared resources: merged into their map item, or added (drawn sites / groups, logical items, the tray).
  for (const r of resources) {
    const key: ResourceKey = { kind: r.kind, name: r.metadata.name, project: r.metadata.project ?? null };
    const id = workspaceResourceId(key);
    const existing = items.get(id);
    const spec = (r.spec ?? {}) as Record<string, unknown>;

    if (existing) {
      existing.resource = key;
      existing.data = { ...existing.data, labels: r.metadata.labels ?? {}, spec };
      continue;
    }

    const kind: WorkspaceItemKind =
      r.kind === 'Site'
        ? 'site'
        : r.kind === 'Node'
          ? 'node'
          : r.kind === 'WorkloadGroup'
            ? 'group'
            : r.kind === 'Deployment'
              ? 'deployment'
              : r.kind === 'VirtualMachine'
                ? 'vm'
                : r.kind === 'Policy'
                  ? 'policy'
                  : 'resource';
    const policyEdges =
      kind === 'policy'
        ? (graph?.edges ?? [])
            .filter(
              (x) =>
                x.kind === 'policy' && x.data['policy'] === (key.project ? `${key.project}/${key.name}` : key.name),
            )
            .map((x) => x.id)
        : [];
    // Sites without nodes and groups without members are still drawn (drop targets, policy ends).
    const drawn = kind === 'site' || kind === 'group';

    add({
      id,
      kind,
      label: key.name,
      typeName: r.kind,
      resource: key,
      project: key.project,
      parent: kind === 'node' && typeof spec['site'] === 'string' ? `site:${spec['site']}` : null,
      placement: null,
      health: 'unknown',
      status: null,
      drawn,
      placed: drawn || policyEdges.length > 0,
      elements: policyEdges,
      data: { labels: r.metadata.labels ?? {}, spec },
    });
  }

  for (const item of items.values())
    if (item.parent) {
      const parent = items.get(item.parent);

      if (parent) parent.children.push(item.id);
      else item.parent = null;
    }

  // Edges between drawn items: a VM's replica edges end at the VM.
  const edges = (graph?.edges ?? []).map((e) =>
    vmOfReplica.has(e.source) || vmOfReplica.has(e.target)
      ? { ...e, source: vmOfReplica.get(e.source) ?? e.source, target: vmOfReplica.get(e.target) ?? e.target }
      : e,
  );
  const list = [...items.values()];

  return { items: list, byId: items, tray: list.filter((i) => !i.placed), edges };
}

function base(
  e: TopologyElement,
  kind: WorkspaceItemKind,
  extra: Partial<WorkspaceItem> & { health: string },
): Omit<WorkspaceItem, 'children' | 'typeName'> {
  return {
    id: e.id,
    kind,
    label: e.label,
    resource: null,
    project: e.project ?? null,
    parent: null,
    placement: null,
    status: null,
    drawn: true,
    placed: true,
    elements: [e.id],
    data: e.data,
    ...extra,
  };
}

/** The change a plan / draft overlay makes to an item (aggregates: create / delete when all agree, else update). */
export function workspaceItemChange(
  item: WorkspaceItem,
  overlay: Readonly<Record<string, TopologyChange>> | null | undefined,
): TopologyChange | null {
  if (!overlay) return null;

  const own = overlay[item.id];

  if (own) return own;

  const changes = item.elements.map((id) => overlay[id]).filter((c): c is TopologyChange => !!c);

  if (changes.length === 0) return null;

  return changes.every((c) => c === changes[0]) && changes.length === item.elements.length ? changes[0] : 'update';
}

/** The item ids up the containment (for keeping a match's site / node visible). */
export function workspaceAncestors(model: WorkspaceModel, id: string): string[] {
  const out: string[] = [];
  let current = model.byId.get(id)?.parent ?? null;

  while (current && !out.includes(current)) {
    out.push(current);
    current = model.byId.get(current)?.parent ?? null;
  }

  return out;
}

export interface WorkspaceFilters {
  q: string;
  kinds: readonly string[];
  projects: readonly string[];
  statuses: readonly string[];
  /** Only items the draft changes (ids, see {@link workspaceItemChange}). */
  onlyChanged?: ReadonlySet<string> | null;
}

/** Search over label, kind, project, placement, status (case-insensitive; all words must match). */
export function matchesWorkspaceSearch(item: WorkspaceItem, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (words.length === 0) return true;

  const haystack = [item.label, item.typeName, item.project, item.placement, item.status, item.health, item.id]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return words.every((w) => haystack.includes(w));
}

/** The status the status filter uses: the item's health, or its runtime status where there is one. */
export function workspaceStatus(item: WorkspaceItem): string {
  return item.health !== 'unknown' ? item.health : (item.status ?? 'unknown');
}

/** Ids of the items that match search + filters. */
export function filterWorkspace(model: WorkspaceModel, filters: WorkspaceFilters): Set<string> {
  const kinds = new Set(filters.kinds);
  const projects = new Set(filters.projects);
  const statuses = new Set(filters.statuses);

  return new Set(
    model.items
      .filter(
        (i) =>
          (kinds.size === 0 || kinds.has(i.typeName)) &&
          (projects.size === 0 || (i.project !== null && projects.has(i.project))) &&
          (statuses.size === 0 || statuses.has(workspaceStatus(i))) &&
          (!filters.onlyChanged || filters.onlyChanged.has(i.id)) &&
          matchesWorkspaceSearch(i, filters.q),
      )
      .map((i) => i.id),
  );
}

/** Rows of the table view: table kinds, sorted by type, project, name. */
export function workspaceRows(model: WorkspaceModel, matching: ReadonlySet<string> | null): WorkspaceItem[] {
  return model.items
    .filter((i) => WORKSPACE_TABLE_KINDS.has(i.kind) && (!matching || matching.has(i.id)))
    .sort(
      (a, b) =>
        a.typeName.localeCompare(b.typeName) ||
        (a.project ?? '').localeCompare(b.project ?? '') ||
        a.label.localeCompare(b.label),
    );
}

/** Values the filter panel offers: kinds, projects and statuses present in the model. */
export function workspaceFacets(model: WorkspaceModel): { kinds: string[]; projects: string[]; statuses: string[] } {
  const rows = model.items.filter((i) => WORKSPACE_TABLE_KINDS.has(i.kind));

  return {
    kinds: [...new Set(rows.map((i) => i.typeName))].sort(),
    projects: [...new Set(rows.flatMap((i) => (i.project ? [i.project] : [])))].sort(),
    statuses: [...new Set(rows.map(workspaceStatus))].sort(),
  };
}
