/** One tab of an object page (3.37); the id is the `?tab=` value. */
export interface ObjectTab {
  id: ObjectTabId;
  label: string;
  icon: string;
}

export type ObjectTabId =
  | 'summary'
  | 'contents'
  | 'topology'
  | 'policies'
  | 'permissions'
  | 'network'
  | 'workloads'
  | 'volumes'
  | 'health'
  | 'metrics'
  | 'logs'
  | 'shell'
  | 'updates'
  | 'replicas'
  | 'spec'
  | 'terminal'
  | 'files'
  | 'backups'
  | 'autoscaling'
  | 'console'
  | 'hardware'
  | 'snapshots'
  | 'members'
  | 'secrets'
  | 'requests'
  | 'slos'
  | 'usage'
  | 'git'
  | 'images'
  | 'tokens'
  | 'history';

/** Object kinds with their own tab set; everything else gets Summary, Spec and Task history. */
export type ObjectPageKind =
  | 'cluster'
  | 'site'
  | 'node'
  | 'deployment'
  | 'virtualmachine'
  | 'volume'
  | 'project'
  | 'policy'
  | 'workloadgroup'
  | 'other';

/** What the caller may do, for hiding tabs like today's links (3.17 / 3.24). */
export interface ObjectTabAccess {
  /** Cluster roles (nodes, sites, the whole cluster). */
  infrastructure: boolean;
  clusterAdmin: boolean;
  /** Fleet mode: the file browser needs the admin grant; shells / consoles follow the relay rules. */
  fleetMode: boolean;
  /** May list / create / revoke join tokens (3.21: infra operators and admins; fleet: cluster-wide admin grant). */
  joinNodes?: boolean;
  /** May manage this project's secrets (3.40: project admins / operators, cluster admins). */
  secrets?: boolean;
}

const TAB: Record<ObjectTabId, Omit<ObjectTab, 'id'>> = {
  summary: { label: $localize`:@@lwConsoleObject-tabSummary:Summary`, icon: 'info-circle' },
  contents: { label: $localize`:@@lwConsoleObject-tabContents:Contents`, icon: 'list-ul' },
  topology: { label: $localize`:@@lwConsoleObject-tabTopology:Topology`, icon: 'bezier2' },
  policies: { label: $localize`:@@lwConsoleObject-tabPolicies:Policies`, icon: 'shield-shaded' },
  permissions: { label: $localize`:@@lwConsoleObject-tabPermissions:Permissions`, icon: 'people' },
  network: { label: $localize`:@@lwConsoleObject-tabNetwork:Network`, icon: 'diagram-2' },
  workloads: { label: $localize`:@@lwConsoleObject-tabWorkloads:Workloads`, icon: 'box-seam' },
  volumes: { label: $localize`:@@lwConsoleObject-tabVolumes:Volumes`, icon: 'hdd' },
  health: { label: $localize`:@@lwConsoleObject-tabHealth:Health`, icon: 'heart-pulse' },
  metrics: { label: $localize`:@@lwConsoleObject-tabMetrics:Metrics`, icon: 'graph-up' },
  logs: { label: $localize`:@@lwConsoleObject-tabLogs:Logs`, icon: 'journal-text' },
  shell: { label: $localize`:@@lwConsoleObject-tabShell:Shell`, icon: 'terminal' },
  updates: { label: $localize`:@@lwConsoleObject-tabUpdates:Updates`, icon: 'cloud-arrow-down' },
  replicas: { label: $localize`:@@lwConsoleObject-tabReplicas:Replicas`, icon: 'layers' },
  spec: { label: $localize`:@@lwConsoleObject-tabSpec:Spec`, icon: 'file-earmark-code' },
  terminal: { label: $localize`:@@lwConsoleObject-tabTerminal:Terminal`, icon: 'terminal' },
  files: { label: $localize`:@@lwConsoleObject-tabFiles:Files`, icon: 'folder2-open' },
  backups: { label: $localize`:@@lwConsoleObject-tabBackups:Backups`, icon: 'safe' },
  autoscaling: { label: $localize`:@@lwConsoleObject-tabAutoscaling:Autoscaling`, icon: 'arrows-angle-expand' },
  console: { label: $localize`:@@lwConsoleObject-tabConsole:Console`, icon: 'display' },
  hardware: { label: $localize`:@@lwConsoleObject-tabHardware:Hardware`, icon: 'cpu' },
  snapshots: { label: $localize`:@@lwConsoleObject-tabSnapshots:Snapshots`, icon: 'camera' },
  members: { label: $localize`:@@lwConsoleObject-tabMembers:Members`, icon: 'people' },
  secrets: { label: $localize`:@@lwConsoleSecrets-title:Secrets`, icon: 'safe' },
  requests: { label: $localize`:@@lwConsoleObject-tabRequests:Requests`, icon: 'envelope' },
  slos: { label: $localize`:@@lwConsoleObject-tabSlos:SLOs`, icon: 'speedometer' },
  usage: { label: $localize`:@@lwConsoleObject-tabUsage:Usage`, icon: 'receipt' },
  git: { label: $localize`:@@lwConsoleObject-tabGit:Git`, icon: 'git' },
  images: { label: $localize`:@@lwConsoleObject-tabImages:VM images`, icon: 'hdd-stack' },
  tokens: { label: $localize`:@@lwConsoleObject-tabTokens:Join tokens`, icon: 'key' },
  history: { label: $localize`:@@lwConsoleObject-tabHistory:Task history`, icon: 'clock-history' },
};

/** The full tab set per kind (decided 2026-10-27, 3.37), in display order. */
export const OBJECT_TAB_SETS: Record<ObjectPageKind, readonly ObjectTabId[]> = {
  // No Options tab (user, 2026-10-29): the Cluster resource is edited like every resource (More ▾ › Edit in draft, `e`).
  cluster: ['summary', 'contents', 'topology', 'policies', 'permissions', 'tokens', 'history'],
  site: ['summary', 'contents', 'topology', 'network', 'tokens', 'history'],
  node: ['summary', 'workloads', 'volumes', 'health', 'metrics', 'logs', 'shell', 'updates', 'history'],
  deployment: [
    'summary',
    'replicas',
    'spec',
    'health',
    'logs',
    'metrics',
    'terminal',
    'files',
    'backups',
    'autoscaling',
    'network',
    'history',
  ],
  virtualmachine: [
    'summary',
    'console',
    'hardware',
    'spec',
    'snapshots',
    'backups',
    'health',
    'metrics',
    'logs',
    'history',
  ],
  volume: ['summary', 'backups', 'files', 'history'],
  project: [
    'summary',
    'contents',
    'topology',
    'images',
    'members',
    'secrets',
    'requests',
    'slos',
    'usage',
    'git',
    'history',
  ],
  policy: ['summary', 'members', 'spec', 'history'],
  workloadgroup: ['summary', 'members', 'spec', 'history'],
  other: ['summary', 'spec', 'history'],
};

/** The page kind of a resource kind (`VirtualMachine` → `virtualmachine`; unknown kinds → `other`). */
export function objectPageKind(kind: string): ObjectPageKind {
  const key = kind.toLowerCase();

  return key in OBJECT_TAB_SETS ? (key as ObjectPageKind) : 'other';
}

/** Tabs that need more than reading the object (hidden like today's links). */
function tabAllowed(kind: ObjectPageKind, tab: ObjectTabId, access: ObjectTabAccess): boolean {
  switch (tab) {
    // Cluster-wide settings and node internals: cluster roles.
    // Node shells: cluster admins only, like the cluster enforces it (infra operators were always refused).
    case 'shell':
      return access.clusterAdmin;
    case 'updates':
      return access.infrastructure;
    case 'permissions':
      return access.clusterAdmin;
    case 'tokens':
      return !!access.joinNodes;
    case 'secrets':
      return !!access.secrets;
    // The relay carries file browsing only for the admin grant (fleet parity, 3.24).
    case 'files':
      return !access.fleetMode || access.clusterAdmin;
    case 'network':
      return kind !== 'site' || access.infrastructure;
    default:
      return true;
  }
}

/** The visible tabs of an object page (Decabill-style registry). */
export function objectTabs(kind: string, access: ObjectTabAccess): ObjectTab[] {
  const pageKind = objectPageKind(kind);

  return OBJECT_TAB_SETS[pageKind].filter((id) => tabAllowed(pageKind, id, access)).map((id) => ({ id, ...TAB[id] }));
}

/** The tab to show for `?tab=`: the requested one when visible, else Summary. */
export function resolveObjectTab(tabs: readonly ObjectTab[], requested: string | null | undefined): ObjectTabId {
  return tabs.find((tab) => tab.id === requested)?.id ?? 'summary';
}
