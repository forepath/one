/** One entry of the console's sidebar. */
export interface ConsoleNavItem {
  path: string;
  icon: string;
  label: string;
  title: string;
  /** Only for cluster roles (nodes, sites, the whole cluster). */
  infrastructure?: boolean;
  /** Admin items: who may open them. */
  requires?: 'cluster-admin' | 'user-manager';
  /** `member`: any cluster or project role; `admin`: cluster admins and project admins (see `navAudienceAllows`). */
  audience?: 'member' | 'admin';
}

/** The sidebar, in order; a view adds its entry here with its route. */
export const CONSOLE_NAV_ITEMS: ConsoleNavItem[] = [
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
    path: '/plans',
    icon: 'bi-file-diff',
    label: $localize`:@@lwConsoleNav-plans:Plans`,
    title: $localize`:@@lwConsoleNav-plansTitle:Plans`,
  },
  {
    // Desired state as YAML; cluster-level resources for cluster roles, project ones for members (the API scopes it).
    path: '/resources',
    icon: 'bi-file-earmark-code',
    label: $localize`:@@lwConsoleNav-resources:Resources`,
    title: $localize`:@@lwConsoleNav-resourcesTitle:Resources`,
  },
  {
    // Repositories per scope (3.29): scope admins manage them, readers of the scope see them (the API scopes it).
    path: '/git',
    icon: 'bi-git',
    label: $localize`:@@lwConsoleNav-git:Git`,
    title: $localize`:@@lwConsoleNav-gitTitle:Git connections`,
    audience: 'member',
  },
  {
    path: '/policies',
    icon: 'bi-shield-shaded',
    label: $localize`:@@lwConsoleNav-policies:Policies`,
    title: $localize`:@@lwConsoleNav-policiesTitle:Groups & policies`,
  },
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
    path: '/audit',
    icon: 'bi-shield-check',
    label: $localize`:@@lwConsoleNav-audit:Audit`,
    title: $localize`:@@lwConsoleNav-auditTitle:Audit log`,
  },
  {
    // Cluster reports for cluster roles, project reports for project members (the API scopes it).
    path: '/reports',
    icon: 'bi-file-earmark-bar-graph',
    label: $localize`:@@lwConsoleNav-reports:Reports`,
    title: $localize`:@@lwConsoleNav-reportsTitle:Periodic reports`,
  },
  {
    path: '/drift',
    icon: 'bi-shuffle',
    label: $localize`:@@lwConsoleNav-drift:Drift`,
    title: $localize`:@@lwConsoleNav-driftTitle:Drift`,
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
    path: '/nodes',
    icon: 'bi-hdd-network',
    label: $localize`:@@lwConsoleNav-nodes:Nodes`,
    title: $localize`:@@lwConsoleNav-nodesTitle:Nodes & sites`,
    infrastructure: true,
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
    // Catalog, restores and deletion requests (3.20): cluster roles see everything, project members their projects.
    path: '/backups',
    icon: 'bi-safe',
    label: $localize`:@@lwConsoleNav-backups:Backups`,
    title: $localize`:@@lwConsoleNav-backupsTitle:Backups, restores and the recovery kit`,
  },
  {
    // Cluster roles see zones, DNSSEC and failovers, project members their records (the API scopes it).
    path: '/dns',
    icon: 'bi-globe2',
    label: $localize`:@@lwConsoleNav-dns:DNS`,
    title: $localize`:@@lwConsoleNav-dnsTitle:DNS`,
  },
  {
    // Cluster members and, per project, members, settings and cross-project requests (3.17).
    path: '/access',
    icon: 'bi-people-fill',
    label: $localize`:@@lwConsoleNav-access:Access`,
    title: $localize`:@@lwConsoleNav-accessTitle:Members, roles and project settings`,
    audience: 'member',
  },
  {
    // The caller's VPN devices (all clients for infra roles, 3.31).
    path: '/devices',
    icon: 'bi-laptop',
    label: $localize`:@@lwConsoleNav-devices:Devices`,
    title: $localize`:@@lwConsoleNav-devicesTitle:Remote access devices`,
  },
  {
    // Kiosk tokens: cluster-wide for cluster admins, project ones for project admins (3.25).
    path: '/wallboards',
    icon: 'bi-display',
    label: $localize`:@@lwConsoleNav-wallboards:Wallboards`,
    title: $localize`:@@lwConsoleNav-wallboardsTitle:Wallboards`,
    audience: 'admin',
  },
];

/** The admin popover (cluster admins). */
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
];
