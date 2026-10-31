import type { BuiltinControlPlaneMember } from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcTreeNode, FpcTreeStatus } from '@forepath/shared/frontend/ui-components';

import type { WorkspaceItem, WorkspaceItemKind, WorkspaceModel } from '../workspace/workspace-model';
import { workspaceHealthLabel } from '../workspace/workspace-format';
import type { SearchDocument } from '../list-search';
import { CLUSTER_ROUTE, objectRoute, type ObjectRoute } from './object-route';

/** The resource tree's views (3.37): where things run, by project, by kind, by label. */
export type ResourceTreeView = 'placement' | 'projects' | 'kind' | 'labels';

export const RESOURCE_TREE_VIEWS: readonly ResourceTreeView[] = ['placement', 'projects', 'kind', 'labels'];

/** What a tree node stands for: a Workspace item (with its object page) or a grouping node. */
export interface ResourceTreeData {
  item: WorkspaceItem | null;
  route: ObjectRoute | null;
  /** Fleet root (3.37 P7): a fleet cluster node — activating / expanding it makes that cluster the active one. */
  clusterId?: string;
}

export type ResourceTreeNode = FpcTreeNode<ResourceTreeData>;

export interface ResourceTreeOptions {
  /** Item ids with a pending draft change (● mark). */
  changed?: ReadonlySet<string>;
  /** Item ids pinned on top ("Favourites"). */
  favourites?: readonly string[];
  /** Localized group labels. */
  labels: ResourceTreeLabels;
  /** The built-in control-plane member's read-only entry (3.39), from `builtinMemberEntry()`; placement view only. */
  builtin?: BuiltinMemberEntry | null;
}

/** The read-only "Control plane (built-in)" entry next to the nodes (3.39): never a node, never schedulable. */
export interface BuiltinMemberEntry {
  label: string;
  hint: string;
  status: FpcTreeStatus;
  statusLabel: string;
}

export interface BuiltinMemberLabels {
  label: string;
  active: string;
  standby: string;
  participant: string;
  problem: string;
  activeHint: string;
  standbyHint: string;
  participantHint: string;
  problemHint: string;
}

/** The entry for the cluster summary's built-in member; null when it is off / unknown (older clusters). */
export function builtinMemberEntry(
  builtin: BuiltinControlPlaneMember | null | undefined,
  labels: BuiltinMemberLabels,
): BuiltinMemberEntry | null {
  if (!builtin || builtin.mode === 'off') return null;

  if (builtin.state !== 'ok')
    return { label: labels.label, hint: labels.problemHint, status: 'danger', statusLabel: labels.problem };

  switch (builtin.role) {
    case 'active':
      return { label: labels.label, hint: labels.activeHint, status: 'success', statusLabel: labels.active };
    case 'participant':
      return { label: labels.label, hint: labels.participantHint, status: 'success', statusLabel: labels.participant };
    case 'standby':
      return { label: labels.label, hint: labels.standbyHint, status: 'secondary', statusLabel: labels.standby };
    default:
      return null;
  }
}

/** Tree node id of the built-in member's entry (no object page: activating it does nothing). */
export const BUILTIN_MEMBER_TREE_ID = 'builtin:control-plane';

export interface ResourceTreeLabels {
  cluster: string;
  unplaced: string;
  projects: string;
  clusterLevel: string;
  favourites: string;
  noLabels: string;
  changed: string;
}

/** Default view per role (decided 2026-10-27): Placement for cluster roles, Projects for project members. */
export function defaultTreeView(infrastructure: boolean): ResourceTreeView {
  return infrastructure ? 'placement' : 'projects';
}

/** Tree kinds that are objects of their own (logical services and replicas live on their deployment's page). */
const LISTED_KINDS: ReadonlySet<WorkspaceItemKind> = new Set([
  'site',
  'node',
  'deployment',
  'vm',
  'volume',
  'group',
  'hostname',
  'policy',
  'resource',
]);

const ICONS: Partial<Record<WorkspaceItemKind, string>> = {
  site: 'geo-alt',
  node: 'hdd-network',
  deployment: 'box-seam',
  stack: 'box',
  service: 'box',
  vm: 'pc-display',
  volume: 'hdd',
  group: 'collection',
  hostname: 'globe2',
  policy: 'shield-shaded',
  resource: 'file-earmark-code',
};

/** The tree's health dot for a model health state. */
export function treeStatus(health: string | null | undefined): FpcTreeStatus | null {
  switch (health) {
    case 'healthy':
      return 'success';
    case 'degraded':
    case 'warning':
      return 'warning';
    case 'unhealthy':
    case 'critical':
      return 'danger';
    case 'unknown':
      return 'secondary';
    default:
      return null;
  }
}

function byLabel(a: { label: string }, b: { label: string }): number {
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
}

function group(id: string, label: string, icon: string, children: ResourceTreeNode[]): ResourceTreeNode {
  return { id, label, icon, badge: children.length, children, data: { item: null, route: null } };
}

function leaf(
  item: WorkspaceItem,
  options: ResourceTreeOptions,
  id = item.id,
  children?: ResourceTreeNode[],
): ResourceTreeNode {
  const changed = options.changed?.has(item.id) ?? false;

  return {
    id,
    label: item.label,
    icon: ICONS[item.kind] ?? 'circle',
    status: treeStatus(item.health),
    statusLabel: workspaceHealthLabel(item.health),
    mark: changed,
    markLabel: changed ? options.labels.changed : undefined,
    hint: item.kind === 'resource' ? item.typeName : null,
    children: children && children.length > 0 ? children : undefined,
    badge: children && children.length > 0 ? children.length : null,
    data: { item, route: objectRoute(item) },
  };
}

function listed(model: WorkspaceModel): WorkspaceItem[] {
  return model.items.filter((item) => LISTED_KINDS.has(item.kind));
}

/** Cluster → Sites → Nodes → services (stacks) / VMs / volumes; unplaced and cluster-level items at the end. */
function placementTree(model: WorkspaceModel, options: ResourceTreeOptions): ResourceTreeNode[] {
  const contained = (parent: string): WorkspaceItem[] =>
    model.items.filter(
      (item) => item.parent === parent && (item.kind === 'stack' || item.kind === 'vm' || item.kind === 'volume'),
    );
  const nodeTree = (node: WorkspaceItem): ResourceTreeNode =>
    leaf(
      node,
      options,
      node.id,
      contained(node.id)
        .sort(byLabel)
        .map((item) => leaf(item, options)),
    );
  const sites = model.items.filter((item) => item.kind === 'site').sort(byLabel);
  const nodes = model.items.filter((item) => item.kind === 'node').sort(byLabel);
  const siteNodes = sites.map((site) =>
    leaf(site, options, site.id, nodes.filter((node) => node.parent === site.id).map(nodeTree)),
  );
  const loose = nodes.filter((node) => !node.parent || !model.byId.has(node.parent)).map(nodeTree);
  const unplaced = model.tray.filter(
    (item) => LISTED_KINDS.has(item.kind) && item.kind !== 'site' && item.kind !== 'node',
  );
  const children = [...siteNodes, ...loose];

  if (options.builtin)
    children.unshift({
      id: BUILTIN_MEMBER_TREE_ID,
      label: options.builtin.label,
      icon: 'shield-lock',
      status: options.builtin.status,
      statusLabel: options.builtin.statusLabel,
      hint: options.builtin.hint,
      data: { item: null, route: null },
    });

  if (unplaced.length > 0) {
    children.push(
      group(
        'group:unplaced',
        options.labels.unplaced,
        'inbox',
        unplaced.sort(byLabel).map((item) => leaf(item, options)),
      ),
    );
  }

  // The built-in member's entry isn't a placement child (no node, no workload): the Cluster badge doesn't count it.
  const counted = children.filter((child) => child.id !== BUILTIN_MEMBER_TREE_ID).length;

  return [
    {
      ...group('cluster', options.labels.cluster, 'hdd-stack', children),
      badge: counted,
      data: { item: null, route: CLUSTER_ROUTE },
    },
  ];
}

function kindGroups(items: WorkspaceItem[], options: ResourceTreeOptions, prefix: string): ResourceTreeNode[] {
  const kinds = new Map<string, WorkspaceItem[]>();

  for (const item of items) kinds.set(item.typeName, [...(kinds.get(item.typeName) ?? []), item]);

  return [...kinds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, list]) =>
      group(
        `${prefix}kind:${kind}`,
        kind,
        ICONS[list[0].kind] ?? 'folder',
        list.sort(byLabel).map((item) => leaf(item, options, `${prefix}${item.id}`)),
      ),
    );
}

/** Projects → kinds → items, plus the cluster-level items. */
function projectsTree(model: WorkspaceModel, options: ResourceTreeOptions): ResourceTreeNode[] {
  const items = listed(model);
  const projects = new Map<string, WorkspaceItem[]>();

  for (const item of items) {
    if (item.project) projects.set(item.project, [...(projects.get(item.project) ?? []), item]);
  }

  // A declared Project resource is the project's own node (its object page).
  const projectNodes: ResourceTreeNode[] = [...projects.keys()].sort().map((project) => ({
    ...group(
      `project:${project}`,
      project,
      'folder',
      kindGroups(projects.get(project) ?? [], options, `project:${project}/`),
    ),
    data: { item: null, route: ['/resources', 'project', project] as ObjectRoute },
  }));
  const declared = items.filter(
    (item) => item.kind === 'resource' && item.typeName === 'Project' && !projects.has(item.label),
  );

  for (const item of declared) {
    projectNodes.push({
      ...group(`project:${item.label}`, item.label, 'folder', []),
      data: { item, route: ['/resources', 'project', item.label] },
    });
  }
  projectNodes.sort(byLabel);

  const clusterLevel = items.filter(
    (item) => !item.project && !(item.kind === 'resource' && item.typeName === 'Project'),
  );
  const roots: ResourceTreeNode[] = [group('group:projects', options.labels.projects, 'folder2', projectNodes)];

  if (clusterLevel.length > 0) {
    roots.push({
      ...group(
        'group:cluster-level',
        options.labels.clusterLevel,
        'hdd-stack',
        kindGroups(clusterLevel, options, 'cluster/'),
      ),
      data: { item: null, route: CLUSTER_ROUTE },
    });
  }

  return roots;
}

/** Kinds → items. */
function kindTree(model: WorkspaceModel, options: ResourceTreeOptions): ResourceTreeNode[] {
  return kindGroups(listed(model), options, '');
}

/** `key=value` labels → items; items without labels at the end. */
function labelsTree(model: WorkspaceModel, options: ResourceTreeOptions): ResourceTreeNode[] {
  const groups = new Map<string, WorkspaceItem[]>();
  const none: WorkspaceItem[] = [];

  for (const item of listed(model)) {
    const labels = item.data['labels'];
    const entries =
      labels && typeof labels === 'object'
        ? Object.entries(labels as Record<string, unknown>).filter(([, v]) => typeof v === 'string')
        : [];

    if (entries.length === 0) none.push(item);

    for (const [key, value] of entries) {
      const name = `${key}=${value as string}`;
      groups.set(name, [...(groups.get(name) ?? []), item]);
    }
  }

  const roots = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) =>
      group(
        `label:${name}`,
        name,
        'tag',
        list.sort(byLabel).map((item) => leaf(item, options, `label:${name}/${item.id}`)),
      ),
    );

  if (none.length > 0) {
    roots.push(
      group(
        'label:-',
        options.labels.noLabels,
        'tag',
        none.sort(byLabel).map((item) => leaf(item, options, `label:-/${item.id}`)),
      ),
    );
  }

  return roots;
}

/** The resource tree for a view, favourites pinned on top. Built client-side from `workspaceModel()` (3.37). */
export function buildResourceTree(
  model: WorkspaceModel,
  view: ResourceTreeView,
  options: ResourceTreeOptions,
): ResourceTreeNode[] {
  const roots =
    view === 'projects'
      ? projectsTree(model, options)
      : view === 'kind'
        ? kindTree(model, options)
        : view === 'labels'
          ? labelsTree(model, options)
          : placementTree(model, options);
  const favourites = (options.favourites ?? [])
    .map((id) => model.byId.get(id))
    .filter((item): item is WorkspaceItem => !!item)
    .map((item) => leaf(item, options, `fav:${item.id}`));

  return favourites.length > 0
    ? [group('group:favourites', options.labels.favourites, 'star', favourites), ...roots]
    : roots;
}

/** The tree node ids an item appears under in a view (to reveal / select it). */
export function treeNodeIdsFor(itemId: string, nodes: readonly ResourceTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: readonly ResourceTreeNode[]): void => {
    for (const node of list) {
      if (node.data?.item?.id === itemId) ids.push(node.id);
      if (node.children) walk(node.children);
    }
  };

  walk(nodes);

  return ids;
}

/** Fields the tree / Contents search knows (`kind:VirtualMachine project:shop status:degraded node:n1`). */
export const RESOURCE_SEARCH_FIELDS = ['kind', 'project', 'status', 'health', 'node', 'site', 'label'] as const;

/** What the search sees of an item: its name, kind, project, health / status and placement. */
export function itemSearchDocument(item: WorkspaceItem): SearchDocument {
  const labels = item.data['labels'];
  const labelValues =
    labels && typeof labels === 'object'
      ? Object.entries(labels as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`)
      : [];

  return {
    text: [item.label, item.typeName],
    fields: {
      kind: item.typeName,
      project: item.project,
      status: item.status ?? item.health,
      health: item.health,
      node: item.kind === 'node' ? item.label : item.placement,
      site: item.kind === 'site' ? item.label : item.kind === 'node' ? item.placement : null,
      label: labelValues,
    },
  };
}

/** A fleet cluster as the tree shows it. */
export interface FleetTreeCluster {
  id: string;
  name: string;
  health: string;
}

export interface FleetTreeLabels {
  fleet: string;
  clusters: string;
}

const FLEET_STATUS: Record<string, 'success' | 'warning' | 'danger' | 'secondary'> = {
  healthy: 'success',
  degraded: 'warning',
  unreachable: 'danger',
  'credential-rejected': 'danger',
};

/** Ids to expand so the active cluster's own tree shows under the fleet root. */
export function fleetTreeExpanded(activeClusterId: string | null): string[] {
  return ['fleet', 'fleet:clusters', ...(activeClusterId ? [`fleet-cluster:${activeClusterId}`] : [])];
}

/**
 * The fleet root of the resource tree (3.37 P7): Fleet → Clusters → each cluster; the active cluster (the one the relay
 * works on) carries the cluster's own tree, the others load on demand (expanding one = switching to it). Only one
 * cluster is expanded at a time because only one is active.
 */
export function fleetTreeRoots(
  clusters: readonly FleetTreeCluster[],
  activeClusterId: string | null,
  clusterRoots: readonly ResourceTreeNode[],
  labels: FleetTreeLabels,
): ResourceTreeNode[] {
  const clusterNodes: ResourceTreeNode[] = [...clusters]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cluster) => {
      const active = cluster.id === activeClusterId;

      return {
        id: `fleet-cluster:${cluster.id}`,
        label: cluster.name,
        icon: 'hdd-network',
        status: FLEET_STATUS[cluster.health] ?? 'secondary',
        statusLabel: cluster.health,
        ...(active ? { children: clusterRoots } : { hasChildren: true }),
        data: { item: null, route: null, clusterId: cluster.id },
      };
    });

  return [
    {
      id: 'fleet',
      label: labels.fleet,
      icon: 'globe2',
      data: { item: null, route: ['/fleet'] },
      children: [
        {
          id: 'fleet:clusters',
          label: labels.clusters,
          icon: 'collection',
          badge: clusters.length,
          data: { item: null, route: ['/fleet', 'clusters'] },
          children: clusterNodes,
        },
      ],
    },
  ];
}
