import type { AccessMe } from '@forepath/loadweaver/frontend/data-access-console';

import { navAudienceAllows } from './access/nav-audience';

/** What an item needs besides its audience: admin roles, global admins (users / keycloak admins, the API key), the PAT UI. */
export type ConsoleNavRequirement = 'cluster-admin' | 'user-manager' | 'global-admin' | 'pat-ui';

/** One entry of the console's sidebar. */
export interface ConsoleNavItem {
  path: string;
  icon: string;
  label: string;
  title: string;
  /** Route prefixes that mark the item active (default: `path`); the longest match across the sidebar wins. */
  activePaths?: string[];
  /** Only for cluster roles (nodes, sites, the whole cluster). */
  infrastructure?: boolean;
  /** Who may open it besides the audience (admin items, the PAT UI). */
  requires?: ConsoleNavRequirement;
  /** `member`: any cluster or project role; `admin`: cluster admins and project admins (see `navAudienceAllows`). */
  audience?: 'member' | 'admin';
  /** An attention badge next to the item (`updates`: the shared updates feature has something to look at). */
  badge?: 'updates';
  testId?: string;
}

/** A popover in the sidebar with related items (one visible item renders as a plain link). */
export interface ConsoleNavGroup {
  id: string;
  icon: string;
  label: string;
  title: string;
  items: ConsoleNavItem[];
}

export type ConsoleNavEntry = ConsoleNavItem | ConsoleNavGroup;

export function isConsoleNavGroup(entry: ConsoleNavEntry): entry is ConsoleNavGroup {
  return 'items' in entry;
}

/**
 * The sidebar, ordered by process: where things are, then setting up the cluster and access, deploying, operating,
 * observing, and the caller's own settings. A view adds its item to a group here with its route.
 */
export const CONSOLE_NAV: ConsoleNavEntry[] = [
  {
    path: '/overview',
    icon: 'bi-grid',
    label: $localize`:@@lwConsoleNav-overview:Overview`,
    title: $localize`:@@lwConsoleNav-overviewTitle:Overview`,
  },
  {
    // Cluster roles see the whole map with traffic, project members their projects' part (the API scopes it).
    path: '/topology',
    icon: 'bi-diagram-3',
    label: $localize`:@@lwConsoleNav-topology:Map`,
    title: $localize`:@@lwConsoleNav-topologyTitle:Topology map`,
  },
  {
    id: 'cluster',
    icon: 'bi-hdd-stack',
    label: $localize`:@@lwConsoleNav-groupCluster:Cluster`,
    title: $localize`:@@lwConsoleNav-groupClusterTitle:Cluster: nodes, DNS, certificates and updates`,
    items: [
      {
        path: '/nodes',
        icon: 'bi-hdd-network',
        label: $localize`:@@lwConsoleNav-nodes:Nodes`,
        title: $localize`:@@lwConsoleNav-nodesTitle:Nodes & sites`,
        infrastructure: true,
      },
      {
        path: '/imports',
        icon: 'bi-box-arrow-in-down',
        label: $localize`:@@lwConsoleNav-imports:Import hosts`,
        title: $localize`:@@lwConsoleNav-importsTitle:Import existing Docker hosts and former nodes`,
        infrastructure: true,
      },
      {
        // Cluster roles see zones, DNSSEC and failovers, project members their records (the API scopes it).
        path: '/dns',
        icon: 'bi-globe2',
        label: $localize`:@@lwConsoleNav-dns:DNS`,
        title: $localize`:@@lwConsoleNav-dnsTitle:DNS`,
      },
      {
        path: '/certificates',
        icon: 'bi-shield-lock',
        label: $localize`:@@lwConsoleNav-certificates:Certificates`,
        title: $localize`:@@lwConsoleNav-certificatesTitle:Ingress certificates`,
        infrastructure: true,
      },
      {
        // Releases, update plans and maintenance windows (3.26): cluster roles read, cluster admins act.
        path: '/updates',
        icon: 'bi-cloud-arrow-down',
        label: $localize`:@@lwConsoleNav-updates:Updates`,
        title: $localize`:@@lwConsoleNav-updatesTitle:Releases and update rollouts`,
        infrastructure: true,
      },
      {
        path: '/drift',
        icon: 'bi-shuffle',
        label: $localize`:@@lwConsoleNav-drift:Drift`,
        title: $localize`:@@lwConsoleNav-driftTitle:Drift`,
        infrastructure: true,
      },
    ],
  },
  {
    id: 'access',
    icon: 'bi-people-fill',
    label: $localize`:@@lwConsoleNav-groupAccess:Access & audit`,
    title: $localize`:@@lwConsoleNav-groupAccessTitle:Access, devices and audit`,
    items: [
      {
        // Cluster members and, per project, members, settings and cross-project requests (3.17).
        path: '/access',
        icon: 'bi-people-fill',
        label: $localize`:@@lwConsoleNav-access:Access`,
        title: $localize`:@@lwConsoleNav-accessTitle:Members, roles and project settings`,
        audience: 'member',
        // Cross-project requests live under `/projects/<name>/requests`.
        activePaths: ['/access', '/projects'],
      },
      {
        // The caller's VPN devices (all clients for infra roles, 3.31).
        path: '/devices',
        icon: 'bi-laptop',
        label: $localize`:@@lwConsoleNav-devices:Devices`,
        title: $localize`:@@lwConsoleNav-devicesTitle:Remote access devices`,
      },
      {
        // MDM / EDR integrations and device certificate trust (3.31).
        path: '/posture',
        icon: 'bi-shield-lock',
        label: $localize`:@@lwConsoleNav-posture:Device posture`,
        title: $localize`:@@lwConsoleNav-postureTitle:MDM / EDR integrations and device certificates`,
        infrastructure: true,
      },
      {
        path: '/audit',
        icon: 'bi-shield-check',
        label: $localize`:@@lwConsoleNav-audit:Audit`,
        title: $localize`:@@lwConsoleNav-auditTitle:Audit log`,
      },
    ],
  },
  {
    id: 'deploy',
    icon: 'bi-rocket-takeoff',
    label: $localize`:@@lwConsoleNav-groupDeploy:Deploy`,
    title: $localize`:@@lwConsoleNav-groupDeployTitle:Deploy: Git, resources, policies and plans`,
    items: [
      {
        // Repositories per scope (3.29): scope admins manage them, readers of the scope see them (the API scopes it).
        path: '/git',
        icon: 'bi-git',
        label: $localize`:@@lwConsoleNav-git:Git`,
        title: $localize`:@@lwConsoleNav-gitTitle:Git connections`,
        audience: 'member',
      },
      {
        // Desired state as YAML; cluster-level resources for cluster roles, project ones for members (the API scopes it).
        path: '/resources',
        icon: 'bi-file-earmark-code',
        label: $localize`:@@lwConsoleNav-resources:Resources`,
        title: $localize`:@@lwConsoleNav-resourcesTitle:Resources`,
      },
      {
        path: '/policies',
        icon: 'bi-shield-shaded',
        label: $localize`:@@lwConsoleNav-policies:Policies`,
        title: $localize`:@@lwConsoleNav-policiesTitle:Groups & policies`,
      },
      {
        path: '/plans',
        icon: 'bi-file-diff',
        label: $localize`:@@lwConsoleNav-plans:Plans`,
        title: $localize`:@@lwConsoleNav-plansTitle:Plans`,
      },
    ],
  },
  {
    id: 'operate',
    icon: 'bi-tools',
    label: $localize`:@@lwConsoleNav-groupOperate:Operate`,
    title: $localize`:@@lwConsoleNav-groupOperateTitle:Operate: terminals, files, sessions, virtual machines and backups`,
    items: [
      {
        // Replica terminals for project operators (and developers with developerExec), node shells for cluster admins.
        path: '/terminals',
        icon: 'bi-terminal',
        label: $localize`:@@lwConsoleNav-terminals:Terminals`,
        title: $localize`:@@lwConsoleNav-terminalsTitle:Terminals`,
      },
      {
        path: '/files',
        icon: 'bi-folder2-open',
        label: $localize`:@@lwConsoleNav-files:Files`,
        title: $localize`:@@lwConsoleNav-filesTitle:Files in replicas and volumes`,
      },
      {
        // Session records and recordings: auditors, cluster admins, project admins (the API scopes it).
        path: '/live',
        icon: 'bi-record-circle',
        label: $localize`:@@lwConsoleNav-sessions:Sessions`,
        title: $localize`:@@lwConsoleNav-sessionsTitle:Terminal sessions and tunnels`,
      },
      {
        // Full virtual machines (3.35): status, power, consoles and snapshots; project members see their projects.
        path: '/virtual-machines',
        icon: 'bi-pc-display',
        label: $localize`:@@lwConsoleNav-virtualMachines:Virtual machines`,
        title: $localize`:@@lwConsoleNav-virtualMachinesTitle:Virtual machines: power, consoles and snapshots`,
      },
      {
        // Catalog, restores and deletion requests (3.20): cluster roles see everything, project members their projects.
        path: '/backups',
        icon: 'bi-safe',
        label: $localize`:@@lwConsoleNav-backups:Backups`,
        title: $localize`:@@lwConsoleNav-backupsTitle:Backups, restores and the recovery kit`,
      },
    ],
  },
  {
    id: 'observe',
    icon: 'bi-activity',
    label: $localize`:@@lwConsoleNav-groupObserve:Observe`,
    title: $localize`:@@lwConsoleNav-groupObserveTitle:Observe: health, alerts, logs and metrics`,
    items: [
      {
        // Cluster roles see the whole tree, project members their projects (the API scopes it).
        path: '/health',
        icon: 'bi-heart-pulse',
        label: $localize`:@@lwConsoleNav-health:Health`,
        title: $localize`:@@lwConsoleNav-healthTitle:Health`,
      },
      {
        path: '/alerts',
        icon: 'bi-bell',
        label: $localize`:@@lwConsoleNav-alerts:Alerts`,
        title: $localize`:@@lwConsoleNav-alertsTitle:Alerts`,
      },
      {
        // Project readers see their projects' SLOs (the API scopes it).
        path: '/slos',
        icon: 'bi-speedometer',
        label: $localize`:@@lwConsoleNav-slos:SLOs`,
        title: $localize`:@@lwConsoleNav-slosTitle:Service level objectives`,
      },
      {
        path: '/status-pages',
        icon: 'bi-broadcast-pin',
        label: $localize`:@@lwConsoleNav-statusPages:Status`,
        title: $localize`:@@lwConsoleNav-statusPagesTitle:Status pages and incidents`,
      },
      {
        path: '/logs',
        icon: 'bi-journal-text',
        label: $localize`:@@lwConsoleNav-logs:Logs`,
        title: $localize`:@@lwConsoleNav-logsTitle:Logs`,
      },
      {
        path: '/metrics',
        icon: 'bi-graph-up',
        label: $localize`:@@lwConsoleNav-metrics:Metrics`,
        title: $localize`:@@lwConsoleNav-metricsTitle:Metrics and dashboards`,
      },
      {
        // Cluster reports for cluster roles, project reports for project members (the API scopes it).
        path: '/reports',
        icon: 'bi-file-earmark-bar-graph',
        label: $localize`:@@lwConsoleNav-reports:Reports`,
        title: $localize`:@@lwConsoleNav-reportsTitle:Periodic reports`,
      },
      {
        // Metered usage (3.24): project members their projects, cluster roles all projects (the API scopes it).
        path: '/usage',
        icon: 'bi-receipt',
        label: $localize`:@@lwConsoleNav-usage:Usage`,
        title: $localize`:@@lwConsoleNav-usageTitle:Metered usage per project`,
      },
      {
        // Kiosk tokens: cluster-wide for cluster admins, project ones for project admins (3.25).
        path: '/wallboards',
        icon: 'bi-display',
        label: $localize`:@@lwConsoleNav-wallboards:Wallboards`,
        title: $localize`:@@lwConsoleNav-wallboardsTitle:Wallboards`,
        audience: 'admin',
      },
    ],
  },
  {
    id: 'account',
    icon: 'bi-person-circle',
    label: $localize`:@@lwConsoleNav-groupAccount:Account`,
    title: $localize`:@@lwConsoleNav-groupAccountTitle:Your account: tokens and linked Git accounts`,
    items: [
      {
        path: '/settings/tokens',
        icon: 'bi-key',
        label: $localize`:@@lwConsoleContainer-tokens:Tokens`,
        title: $localize`:@@lwConsoleContainer-tokensTitle:Access Tokens`,
        requires: 'pat-ui',
      },
      {
        // Git accounts linked for the plan bot (3.30): the caller's own setting.
        path: '/settings/git-accounts',
        icon: 'bi-link-45deg',
        label: $localize`:@@lwConsoleContainer-gitAccounts:Git accounts`,
        title: $localize`:@@lwConsoleContainer-gitAccountsTitle:Linked Git accounts`,
        testId: 'console-git-accounts',
      },
    ],
  },
];

/** Every sidebar item (outside the admin popover), in sidebar order. */
export const CONSOLE_NAV_ITEMS: ConsoleNavItem[] = CONSOLE_NAV.flatMap((entry) =>
  isConsoleNavGroup(entry) ? entry.items : [entry],
);

/** The admin popover in the sidebar footer. */
export const CONSOLE_ADMIN_NAV_ITEMS: ConsoleNavItem[] = [
  {
    path: '/webhooks',
    requires: 'cluster-admin',
    icon: 'bi-broadcast',
    label: $localize`:@@lwConsoleNav-webhooks:Webhooks`,
    title: $localize`:@@lwConsoleNav-webhooksTitle:Webhooks`,
  },
  {
    path: '/users',
    requires: 'user-manager',
    icon: 'bi-people',
    label: $localize`:@@lwConsoleNav-users:Users`,
    title: $localize`:@@lwConsoleNav-usersTitle:User Management`,
  },
  {
    // Release announcements of the shared updates feature (global admins and the API key, see `globalAdminGuard`).
    path: '/updates/announcements',
    requires: 'global-admin',
    icon: 'bi-arrow-repeat',
    label: $localize`:@@lwConsoleNav-adminUpdates:Updates`,
    title: $localize`:@@lwConsoleNav-adminUpdatesTitle:Release announcements`,
    badge: 'updates',
  },
];

/** What the caller may see in the sidebar. */
export interface ConsoleNavContext {
  infrastructure: boolean;
  me: AccessMe | null | undefined;
  clusterAdmin: boolean;
  userManager: boolean;
  globalAdmin: boolean;
  patUi: boolean;
}

/** A rendered sidebar entry: a plain link, or a group popover with its visible items. */
export type ConsoleNavView =
  | { kind: 'link'; key: string; item: ConsoleNavItem }
  | { kind: 'group'; key: string; group: ConsoleNavGroup; items: ConsoleNavItem[] };

function requirementMet(requires: ConsoleNavRequirement | undefined, context: ConsoleNavContext): boolean {
  switch (requires) {
    case 'cluster-admin':
      return context.clusterAdmin;
    case 'user-manager':
      return context.userManager;
    case 'global-admin':
      return context.globalAdmin;
    case 'pat-ui':
      return context.patUi;
    default:
      return true;
  }
}

/** Infrastructure views for cluster roles only, the item's audience (`navAudienceAllows`) and requirement. */
export function consoleNavItemVisible(item: ConsoleNavItem, context: ConsoleNavContext): boolean {
  return (
    (context.infrastructure || !item.infrastructure) &&
    navAudienceAllows(item, context.me) &&
    requirementMet(item.requires, context)
  );
}

/** The sidebar for the caller: groups without visible items are dropped, groups with one become a plain link. */
export function visibleConsoleNav(entries: ConsoleNavEntry[], context: ConsoleNavContext): ConsoleNavView[] {
  const views: ConsoleNavView[] = [];

  for (const entry of entries) {
    if (!isConsoleNavGroup(entry)) {
      if (consoleNavItemVisible(entry, context)) views.push({ kind: 'link', key: entry.path, item: entry });

      continue;
    }

    const items = entry.items.filter((item) => consoleNavItemVisible(item, context));

    if (items.length === 1) views.push({ kind: 'link', key: items[0].path, item: items[0] });
    else if (items.length > 1) views.push({ kind: 'group', key: `group:${entry.id}`, group: entry, items });
  }

  return views;
}

/** The path of the item the URL belongs to (longest prefix match, query and locale prefix ignored), or null. */
export function activeConsoleNavPath(url: string, items: ConsoleNavItem[]): string | null {
  const path = url.split(/[?#]/)[0].replace(/^\/(de|en)(?=\/|$)/, '') || '/';
  let best: { path: string; length: number } | null = null;

  for (const item of items) {
    for (const prefix of item.activePaths ?? [item.path]) {
      const matches = path === prefix || path.startsWith(`${prefix}/`);

      if (matches && (!best || prefix.length > best.length)) best = { path: item.path, length: prefix.length };
    }
  }

  return best?.path ?? null;
}

/** Fleet mode (3.24): the fleet's own views, always first in the sidebar. */
export const FLEET_NAV_GROUP: ConsoleNavGroup = {
  id: 'fleet',
  icon: 'bi-globe2',
  label: $localize`:@@lwConsoleNav-groupFleet:Fleet`,
  title: $localize`:@@lwConsoleNav-groupFleetTitle:Fleet: all clusters, comparison and cross-cluster operations`,
  items: [
    {
      path: '/fleet',
      icon: 'bi-globe2',
      label: $localize`:@@lwConsoleNav-fleetOverview:Fleet overview`,
      title: $localize`:@@lwConsoleNav-fleetOverviewTitle:Cards, inbox and sites of every cluster`,
      testId: 'console-nav-fleet-overview',
    },
    {
      path: '/fleet/clusters',
      icon: 'bi-hdd-stack',
      label: $localize`:@@lwConsoleNav-fleetClusters:Clusters`,
      title: $localize`:@@lwConsoleNav-fleetClustersTitle:Cluster connections and grants`,
    },
    {
      path: '/fleet/compare',
      icon: 'bi-layout-split',
      label: $localize`:@@lwConsoleNav-fleetCompare:Compare`,
      title: $localize`:@@lwConsoleNav-fleetCompareTitle:Versions, capacity and policy drift side by side`,
    },
    {
      path: '/fleet/operations',
      icon: 'bi-arrow-left-right',
      label: $localize`:@@lwConsoleNav-fleetOperations:Operations`,
      title: $localize`:@@lwConsoleNav-fleetOperationsTitle:Cross-cluster restores and clones`,
    },
    {
      path: '/fleet/audit',
      icon: 'bi-shield-check',
      label: $localize`:@@lwConsoleNav-fleetAudit:Fleet audit`,
      title: $localize`:@@lwConsoleNav-fleetAuditTitle:Audit log of the fleet`,
      requires: 'global-admin',
    },
  ],
};

/**
 * The sidebar in fleet mode: the Fleet group, then — with an active cluster — the cluster's sidebar without what the
 * relay never carries (`unavailable`) and with the admin grant required where the relay asks for it (`adminOnly`).
 */
export function fleetConsoleNav(
  entries: ConsoleNavEntry[],
  activeCluster: boolean,
  unavailable: readonly string[],
  adminOnly: readonly string[],
): ConsoleNavEntry[] {
  if (!activeCluster) return [FLEET_NAV_GROUP];

  const adapt = (item: ConsoleNavItem): ConsoleNavItem | null =>
    unavailable.includes(item.path)
      ? null
      : adminOnly.includes(item.path)
        ? { ...item, requires: 'cluster-admin' }
        : item;
  const cluster: ConsoleNavEntry[] = [];

  for (const entry of entries) {
    if (isConsoleNavGroup(entry)) {
      const items = entry.items.map(adapt).filter((item): item is ConsoleNavItem => item !== null);

      if (items.length > 0) cluster.push({ ...entry, items });
    } else {
      const item = adapt(entry);

      if (item) cluster.push(item);
    }
  }

  return [FLEET_NAV_GROUP, ...cluster];
}
