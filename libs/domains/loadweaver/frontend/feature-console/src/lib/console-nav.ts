import type { AccessMe } from '@forepath/loadweaver/frontend/data-access-console';

import { navAudienceAllows } from './access/nav-audience';

/**
 * What an item needs besides its audience: admin roles, global admins (users / keycloak admins, the API key), the PAT UI,
 * a fleet with at least 2 visible clusters (Compare).
 */
export type ConsoleNavRequirement = 'cluster-admin' | 'user-manager' | 'global-admin' | 'pat-ui' | 'fleet-compare';

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
  /**
   * `member`: any cluster or project role; `admin`: cluster admins and project admins; `secrets`: who may manage
   * secrets somewhere (cluster admins, project admins / operators; see `navAudienceAllows`).
   */
  audience?: 'member' | 'admin' | 'secrets';
  /**
   * An attention badge next to the item (`updates`: the shared updates feature has something to look at;
   * `backup-deletions`: the count of open backup deletion requests in the section sub-nav).
   */
  badge?: 'updates' | 'backup-deletions';
  testId?: string;
  /** Heading above the item in its section's sub-nav. */
  heading?: string;
}

/** A section of the function rail (3.37): one tile, its pages in the section's vertical sub-nav. */
export interface ConsoleSection {
  id: ConsoleSectionId;
  icon: string;
  label: string;
  title: string;
  items: ConsoleNavItem[];
}

export type ConsoleSectionId = 'setup' | 'resources' | 'activity' | 'observe' | 'operate' | 'delivery' | 'access';

/**
 * The function rail (3.37), one click per tile: Setup, Resources (default landing), Activity, Observe, Operate, Delivery,
 * Access. A
 * tile opens its section's first page the caller may see; the section's pages are its vertical sub-nav (headings
 * group them). Tiles stay stable per role: only a section without any visible page drops its tile.
 */
export const CONSOLE_SECTIONS: ConsoleSection[] = [
  {
    // The cluster's setup checklist (3.41, user 2026-10-29: "basic setup checklist for a cluster"): every external
    // provider and cluster-wide setting with its state, edit and test. First tile, cluster roles.
    id: 'setup',
    icon: 'bi-ui-checks',
    label: $localize`:@@lwConsoleIntegrations-title:Setup`,
    title: $localize`:@@lwConsoleNav-integrationsTitle:Setup: Git, DNS, backups, SIEM, certificates and the cluster's other providers`,
    items: [
      {
        path: '/setup',
        infrastructure: true,
        icon: 'bi-ui-checks',
        label: $localize`:@@lwConsoleIntegrations-title:Setup`,
        title: $localize`:@@lwConsoleNav-integrationsTitle:Setup: Git, DNS, backups, SIEM, certificates and the cluster's other providers`,
        testId: 'console-setup',
      },
    ],
  },
  {
    id: 'resources',
    icon: 'bi-diagram-3',
    label: $localize`:@@lwConsoleNav-sectionResources:Resources`,
    title: $localize`:@@lwConsoleNav-sectionResourcesTitle:Resources: the cluster, its sites, nodes, projects and everything in them`,
    items: [
      {
        // The resource tree and object pages (3.37).
        path: '/resources/cluster',
        activePaths: ['/resources'],
        icon: 'bi-diagram-3',
        label: $localize`:@@lwConsoleNav-sectionResources:Resources`,
        title: $localize`:@@lwConsoleNav-sectionResourcesTitle:Resources: the cluster, its sites, nodes, projects and everything in them`,
      },
    ],
  },
  {
    id: 'activity',
    icon: 'bi-clock-history',
    label: $localize`:@@lwConsoleNav-sectionActivity:Activity`,
    title: $localize`:@@lwConsoleNav-sectionActivityTitle:Activity: plans, drafts, tasks and the audit log`,
    items: [
      {
        path: '/activity/plans',
        icon: 'bi-file-diff',
        label: $localize`:@@lwConsoleNav-plans:Plans`,
        title: $localize`:@@lwConsoleNav-plansTitle:Plans`,
      },
      {
        path: '/activity/drafts',
        icon: 'bi-pencil-square',
        label: $localize`:@@lwConsoleNav-drafts:Drafts`,
        title: $localize`:@@lwConsoleNav-draftsTitle:Drafts: changes waiting to be submitted as plans`,
      },
      {
        path: '/activity/tasks',
        icon: 'bi-list-task',
        label: $localize`:@@lwConsoleNav-tasks:Tasks`,
        title: $localize`:@@lwConsoleNav-tasksTitle:Running and recent tasks`,
      },
      {
        path: '/activity/audit',
        icon: 'bi-shield-check',
        label: $localize`:@@lwConsoleNav-audit:Audit`,
        title: $localize`:@@lwConsoleNav-auditTitle:Audit log`,
      },
    ],
  },
  {
    id: 'observe',
    icon: 'bi-activity',
    label: $localize`:@@lwConsoleNav-sectionObserve:Observe`,
    title: $localize`:@@lwConsoleNav-sectionObserveTitle:Observe: health, alerts, logs, metrics, topology and reports`,
    items: [
      {
        path: '/observe/health',
        icon: 'bi-heart-pulse',
        label: $localize`:@@lwConsoleNav-health:Health`,
        title: $localize`:@@lwConsoleNav-healthTitle:Health`,
        heading: $localize`:@@lwConsoleNav-headingHealth:Health & alerts`,
      },
      {
        path: '/observe/alerts',
        icon: 'bi-bell',
        label: $localize`:@@lwConsoleNav-alerts:Alerts`,
        title: $localize`:@@lwConsoleNav-alertsTitle:Alerts`,
        heading: $localize`:@@lwConsoleNav-headingHealth:Health & alerts`,
      },
      {
        path: '/observe/slos',
        icon: 'bi-speedometer',
        label: $localize`:@@lwConsoleNav-slos:SLOs`,
        title: $localize`:@@lwConsoleNav-slosTitle:Service level objectives`,
        heading: $localize`:@@lwConsoleNav-headingHealth:Health & alerts`,
      },
      {
        path: '/observe/status-pages',
        icon: 'bi-broadcast-pin',
        label: $localize`:@@lwConsoleNav-statusPages:Status`,
        title: $localize`:@@lwConsoleNav-statusPagesTitle:Status pages and incidents`,
        heading: $localize`:@@lwConsoleNav-headingHealth:Health & alerts`,
      },
      {
        path: '/observe/logs',
        icon: 'bi-journal-text',
        label: $localize`:@@lwConsoleNav-logs:Logs`,
        title: $localize`:@@lwConsoleNav-logsTitle:Logs`,
        heading: $localize`:@@lwConsoleNav-headingTelemetry:Telemetry`,
      },
      {
        path: '/observe/metrics',
        icon: 'bi-graph-up',
        label: $localize`:@@lwConsoleNav-metrics:Metrics`,
        title: $localize`:@@lwConsoleNav-metricsTitle:Metrics and dashboards`,
        heading: $localize`:@@lwConsoleNav-headingTelemetry:Telemetry`,
      },
      {
        // The map (3.9 / 3.36), view-first under Observe (3.37); until P5 the Workspace map.
        path: '/observe/topology',
        icon: 'bi-bezier2',
        label: $localize`:@@lwConsoleNav-topologyMap:Topology`,
        title: $localize`:@@lwConsoleNav-topologyMapTitle:Topology map with live traffic, timeline and plan overlays`,
        heading: $localize`:@@lwConsoleNav-headingTelemetry:Telemetry`,
      },
      {
        path: '/observe/reports',
        icon: 'bi-file-earmark-bar-graph',
        label: $localize`:@@lwConsoleNav-reports:Reports`,
        title: $localize`:@@lwConsoleNav-reportsTitle:Periodic reports`,
        heading: $localize`:@@lwConsoleNav-headingReporting:Reporting`,
      },
      {
        path: '/observe/usage',
        icon: 'bi-receipt',
        label: $localize`:@@lwConsoleNav-usage:Usage`,
        title: $localize`:@@lwConsoleNav-usageTitle:Metered usage per project`,
        heading: $localize`:@@lwConsoleNav-headingReporting:Reporting`,
      },
      {
        path: '/observe/wallboards',
        icon: 'bi-display',
        label: $localize`:@@lwConsoleNav-wallboards:Wallboards`,
        title: $localize`:@@lwConsoleNav-wallboardsTitle:Wallboards`,
        audience: 'admin',
        heading: $localize`:@@lwConsoleNav-headingReporting:Reporting`,
      },
    ],
  },
  {
    id: 'operate',
    icon: 'bi-tools',
    label: $localize`:@@lwConsoleNav-sectionOperate:Operate`,
    title: $localize`:@@lwConsoleNav-sectionOperateTitle:Operate: terminals, files, sessions, backups and imports`,
    items: [
      {
        path: '/operate/terminals',
        icon: 'bi-terminal',
        label: $localize`:@@lwConsoleNav-terminals:Terminals`,
        title: $localize`:@@lwConsoleNav-terminalsTitle:Terminals`,
        heading: $localize`:@@lwConsoleNav-headingLive:Live access`,
      },
      {
        path: '/operate/files',
        icon: 'bi-folder2-open',
        label: $localize`:@@lwConsoleNav-files:Files`,
        title: $localize`:@@lwConsoleNav-filesTitle:Files in replicas and volumes`,
        heading: $localize`:@@lwConsoleNav-headingLive:Live access`,
      },
      {
        path: '/operate/sessions',
        icon: 'bi-record-circle',
        label: $localize`:@@lwConsoleNav-sessions:Sessions`,
        title: $localize`:@@lwConsoleNav-sessionsTitle:Terminal sessions and tunnels`,
        heading: $localize`:@@lwConsoleNav-headingLive:Live access`,
      },
      {
        path: '/operate/backups',
        icon: 'bi-safe',
        label: $localize`:@@lwConsoleNav-backups:Backups`,
        title: $localize`:@@lwConsoleNav-backupsTitle:Backups, restores and the recovery kit`,
        heading: $localize`:@@lwConsoleNav-headingData:Data`,
        // Backup details and the diff belong to the overview.
        activePaths: ['/operate/backups'],
      },
      {
        path: '/operate/backups/restores',
        icon: 'bi-arrow-counterclockwise',
        label: $localize`:@@lwConsoleNav-backupRestores:Restores`,
        title: $localize`:@@lwConsoleNav-backupRestoresTitle:Restores and restore tests`,
        heading: $localize`:@@lwConsoleNav-headingData:Data`,
      },
      {
        path: '/operate/backups/deletions',
        icon: 'bi-trash',
        label: $localize`:@@lwConsoleNav-backupDeletions:Deletions`,
        title: $localize`:@@lwConsoleNav-backupDeletionsTitle:Backup deletion requests`,
        heading: $localize`:@@lwConsoleNav-headingData:Data`,
        badge: 'backup-deletions',
      },
      {
        path: '/operate/backups/platform',
        icon: 'bi-database',
        label: $localize`:@@lwConsoleNav-backupPlatform:Platform`,
        title: $localize`:@@lwConsoleNav-backupPlatformTitle:Control-plane backups`,
        heading: $localize`:@@lwConsoleNav-headingData:Data`,
        infrastructure: true,
      },
      {
        path: '/operate/backups/keys',
        icon: 'bi-key',
        label: $localize`:@@lwConsoleNav-backupKeys:Recovery kit`,
        title: $localize`:@@lwConsoleNav-backupKeysTitle:Backup keys and the recovery kit`,
        heading: $localize`:@@lwConsoleNav-headingData:Data`,
        infrastructure: true,
      },
      {
        path: '/operate/imports',
        icon: 'bi-box-arrow-in-down',
        label: $localize`:@@lwConsoleNav-imports:Import hosts`,
        title: $localize`:@@lwConsoleNav-importsTitle:Import existing Docker hosts and former nodes`,
        infrastructure: true,
        heading: $localize`:@@lwConsoleNav-headingHosts:Hosts`,
      },
    ],
  },
  {
    id: 'delivery',
    icon: 'bi-rocket-takeoff',
    label: $localize`:@@lwConsoleNav-sectionDelivery:Delivery`,
    title: $localize`:@@lwConsoleNav-sectionDeliveryTitle:Delivery: Git, drift, updates, certificates and DNS`,
    items: [
      {
        path: '/delivery/git',
        icon: 'bi-git',
        label: $localize`:@@lwConsoleNav-git:Git`,
        title: $localize`:@@lwConsoleNav-gitTitle:Git connections`,
        audience: 'member',
        heading: $localize`:@@lwConsoleNav-headingSource:Source`,
      },
      {
        path: '/delivery/sops',
        icon: 'bi-key',
        label: $localize`:@@lwConsoleGit-sops:SOPS`,
        title: $localize`:@@lwConsoleNav-sopsTitle:SOPS age recipient of the cluster`,
        audience: 'member',
        heading: $localize`:@@lwConsoleNav-headingSource:Source`,
      },
      {
        path: '/delivery/secrets',
        icon: 'bi-safe',
        label: $localize`:@@lwConsoleSecrets-title:Secrets`,
        title: $localize`:@@lwConsoleNav-secretsTitle:Project secrets: set, rotate, roll out and delete values`,
        audience: 'secrets',
        heading: $localize`:@@lwConsoleNav-headingSource:Source`,
      },
      {
        path: '/delivery/drift',
        icon: 'bi-shuffle',
        label: $localize`:@@lwConsoleNav-drift:Drift`,
        title: $localize`:@@lwConsoleNav-driftTitle:Drift`,
        infrastructure: true,
        heading: $localize`:@@lwConsoleNav-headingSource:Source`,
      },
      {
        path: '/delivery/updates',
        icon: 'bi-cloud-arrow-down',
        label: $localize`:@@lwConsoleNav-updates:Updates`,
        title: $localize`:@@lwConsoleNav-updatesTitle:Releases and update rollouts`,
        infrastructure: true,
        heading: $localize`:@@lwConsoleNav-headingReleases:Releases`,
      },
      {
        path: '/delivery/certificates',
        icon: 'bi-shield-lock',
        label: $localize`:@@lwConsoleNav-certificates:Certificates`,
        title: $localize`:@@lwConsoleNav-certificatesTitle:Ingress certificates`,
        infrastructure: true,
        heading: $localize`:@@lwConsoleNav-headingEdge:Edge`,
      },
      // DNS (3.38): four entries; the longest active path wins, so `/delivery/dns` stays the records.
      {
        path: '/delivery/dns',
        icon: 'bi-signpost',
        label: $localize`:@@lwConsoleDns-recordsTab:Records`,
        title: $localize`:@@lwConsoleDns-recordsTitle:DNS records`,
        heading: $localize`:@@lwConsoleNav-dns:DNS`,
      },
      {
        path: '/delivery/dns/zones',
        icon: 'bi-globe2',
        label: $localize`:@@lwConsoleDns-zonesTab:Zones`,
        title: $localize`:@@lwConsoleDns-zonesTitle:DNS zones`,
        infrastructure: true,
        heading: $localize`:@@lwConsoleNav-dns:DNS`,
      },
      {
        path: '/delivery/dns/dnssec',
        icon: 'bi-shield-check',
        label: $localize`:@@lwConsoleDns-dnssecTab:DNSSEC`,
        title: $localize`:@@lwConsoleDns-dnssecTitle:DNSSEC`,
        infrastructure: true,
        heading: $localize`:@@lwConsoleNav-dns:DNS`,
      },
      {
        path: '/delivery/dns/failover',
        icon: 'bi-sign-turn-right',
        label: $localize`:@@lwConsoleDns-failoverTab:Failover`,
        title: $localize`:@@lwConsoleDns-failoverTitle:DNS failover`,
        infrastructure: true,
        heading: $localize`:@@lwConsoleNav-dns:DNS`,
      },
    ],
  },
  {
    id: 'access',
    icon: 'bi-people-fill',
    label: $localize`:@@lwConsoleNav-sectionAccess:Access`,
    title: $localize`:@@lwConsoleNav-sectionAccessTitle:Access: members, projects, devices and posture`,
    items: [
      {
        // Cluster members and, per project, members, settings and cross-project requests (3.17).
        path: '/access/members',
        icon: 'bi-people-fill',
        label: $localize`:@@lwConsoleNav-accessMembers:Members & projects`,
        title: $localize`:@@lwConsoleNav-accessTitle:Members, roles and project settings`,
        audience: 'member',
        activePaths: ['/access/members', '/access/requests'],
      },
      {
        path: '/access/devices',
        icon: 'bi-laptop',
        label: $localize`:@@lwConsoleNav-devices:Devices`,
        title: $localize`:@@lwConsoleNav-devicesTitle:Remote access devices`,
      },
      {
        path: '/access/posture',
        icon: 'bi-shield-lock',
        label: $localize`:@@lwConsoleNav-posture:Device posture`,
        title: $localize`:@@lwConsoleNav-postureTitle:MDM / EDR integrations and device certificates`,
        infrastructure: true,
      },
    ],
  },
];

/** Every page of the rail's sections, in rail order. */
export const CONSOLE_NAV_ITEMS: ConsoleNavItem[] = CONSOLE_SECTIONS.flatMap((section) => section.items);

/** The account popover in the sidebar footer (the caller's own settings). */
export const CONSOLE_ACCOUNT_NAV_ITEMS: ConsoleNavItem[] = [
  {
    path: '/account/tokens',
    icon: 'bi-key',
    label: $localize`:@@lwConsoleContainer-tokens:Tokens`,
    title: $localize`:@@lwConsoleContainer-tokensTitle:Access Tokens`,
    requires: 'pat-ui',
  },
  {
    path: '/account/git-accounts',
    icon: 'bi-link-45deg',
    label: $localize`:@@lwConsoleContainer-gitAccounts:Git accounts`,
    title: $localize`:@@lwConsoleContainer-gitAccountsTitle:Linked Git accounts`,
    testId: 'console-git-accounts',
  },
];

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
    // Fleets whose signed identities count for approvals through them (3.24); the cluster's own console only.
    path: '/settings/trusted-fleets',
    requires: 'cluster-admin',
    icon: 'bi-diagram-3',
    label: $localize`:@@lwConsoleNav-trustedFleets:Trusted fleets`,
    title: $localize`:@@lwConsoleNav-trustedFleetsTitle:Fleets whose approvals count their real person`,
    testId: 'console-trusted-fleets',
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
  /** The fleet has at least 2 clusters the caller can see (`fleetCompareAvailable`): Compare is offered. */
  fleetCompare?: boolean;
}

/** A tile of the function rail: a section (its first visible page) or, at the fleet root, a fleet page. */
export interface ConsoleRailTile {
  key: string;
  path: string;
  icon: string;
  label: string;
  title: string;
  /** The section's visible pages (its sub-nav); a single fleet page for fleet tiles. */
  items: ConsoleNavItem[];
  section: ConsoleSectionId | null;
  testId?: string;
}

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
    case 'fleet-compare':
      return !!context.fleetCompare;
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

/** The visible pages of `section` for the caller. */
export function visibleSectionItems(section: ConsoleSection, context: ConsoleNavContext): ConsoleNavItem[] {
  return section.items.filter((item) => consoleNavItemVisible(item, context));
}

/** The rail for the caller: one tile per section with a visible page, opening its first visible page. */
export function visibleConsoleRail(sections: readonly ConsoleSection[], context: ConsoleNavContext): ConsoleRailTile[] {
  return sections.flatMap((section) => {
    const items = visibleSectionItems(section, context);

    return items.length === 0
      ? []
      : [
          {
            key: `section:${section.id}`,
            path: items[0].path,
            icon: section.icon,
            label: section.label,
            title: section.title,
            items,
            section: section.id,
            testId: `console-nav-section-${section.id}`,
          },
        ];
  });
}

/** Fleet pages as rail tiles (the fleet root, 3.24 / 3.37). */
export function fleetRail(items: readonly ConsoleNavItem[], context: ConsoleNavContext): ConsoleRailTile[] {
  return items
    .filter((item) => consoleNavItemVisible(item, context))
    .map((item) => ({
      key: item.path,
      path: item.path,
      icon: item.icon,
      label: item.label,
      title: item.title,
      items: [item],
      section: null,
      testId: item.testId,
    }));
}

/** The section a URL belongs to (longest prefix over every section page), or null (search, admin, fleet pages). */
export function sectionForUrl(url: string, sections: readonly ConsoleSection[]): ConsoleSectionId | null {
  const path = activeConsoleNavPath(
    url,
    sections.flatMap((section) => section.items),
  );

  return path ? (sections.find((section) => section.items.some((item) => item.path === path))?.id ?? null) : null;
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

/**
 * Fleet mode (3.24): the fleet's own views, as plain sidebar items without an active cluster (with one, the container's
 * "Back" stands there).
 */
export const FLEET_NAV_ITEMS: ConsoleNavItem[] = [
  {
    path: '/fleet',
    icon: 'bi-grid',
    label: $localize`:@@lwConsoleNav-fleetOverview:Overview`,
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
    requires: 'fleet-compare',
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
    label: $localize`:@@lwConsoleNav-fleetAudit:Audit`,
    title: $localize`:@@lwConsoleNav-fleetAuditTitle:Audit log of the fleet`,
    requires: 'global-admin',
  },
];

/**
 * The cluster's sections through the fleet (3.24): without what the relay never carries (`unavailable`) and with the
 * admin grant required where the relay asks for it (`adminOnly`); sections left empty disappear.
 */
export function fleetClusterSections(
  sections: readonly ConsoleSection[],
  unavailable: readonly string[],
  adminOnly: readonly string[],
): ConsoleSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => !unavailable.includes(item.path))
        .map((item): ConsoleNavItem => (adminOnly.includes(item.path) ? { ...item, requires: 'cluster-admin' } : item)),
    }))
    .filter((section) => section.items.length > 0);
}
