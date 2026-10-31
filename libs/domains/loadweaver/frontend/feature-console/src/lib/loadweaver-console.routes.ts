import { ConsoleNavService } from './nav/console-nav.service';
import { Route } from '@angular/router';
import { authGuard, identityAuthProviders, identityAuthRoutes } from '@forepath/identity/frontend';
import {
  acknowledgeAlert$,
  CONSOLE_FEATURE_CONFIG,
  ConsoleAccessFacade,
  consoleAccessReducer,
  ConsoleAlertsFacade,
  consoleAlertsReducer,
  ConsoleDriftFacade,
  consoleDriftReducer,
  ConsoleHealthFacade,
  consoleHealthReducer,
  ConsoleOverviewFacade,
  consoleOverviewReducer,
  ConsolePlansFacade,
  consolePlansReducer,
  createSilence$,
  endSilence$,
  loadAccess$,
  loadAlert$,
  loadAlerts$,
  loadDrift$,
  loadHealthEntity$,
  loadHealthHistory$,
  loadHealthTree$,
  loadOverview$,
  loadPlan$,
  loadPlans$,
  loadSilences$,
  openProposedDriftPlan$,
  planActions$,
  plansLive$,
  proposeDriftPlan$,
  reloadPlanAfterAction$,
  reloadSelectedPlanOnPatch$,
  reloadSilencesAfterEnd$,
  ConsoleTopologyFacade,
  consoleTopologyReducer,
  loadTopology$,
  traceTopology$,
  topologyLive$,
  reloadTopologyOnStructureChange$,
  ConsoleLogsFacade,
  consoleLogsReducer,
  searchLogs$,
  logsPageNavigation$,
  loadLogsPage$,
  logsTail$,
  ConsoleMetricsFacade,
  consoleMetricsReducer,
  loadMetricNames$,
  queryMetrics$,
  loadMetricEvents$,
  ConsoleDashboardsFacade,
  consoleDashboardsReducer,
  loadDashboards$,
  runDashboard$,
  ConsoleResourcesFacade,
  consoleResourcesReducer,
  loadResources$,
  loadResource$,
  loadResourceKinds$,
  loadResourceSchema$,
  planResourceChange$,
  openResourcePlan$,
  ConsolePoliciesFacade,
  consolePoliciesReducer,
  loadPolicies$,
  loadGroupMembers$,
  ConsoleNodesFacade,
  ConsoleVirtualMachinesFacade,
  consoleVirtualMachinesReducer,
  loadVirtualMachines$,
  loadVirtualMachine$,
  virtualMachineActions$,
  loadVmSnapshots$,
  createVmSnapshot$,
  loadVmImageImports$,
  loadVmRegistryImages$,
  importVmImage$,
  consoleNodesReducer,
  loadNodes$,
  loadNode$,
  nodeActions$,
  loadJoinTokens$,
  createJoinToken$,
  revokeJoinToken$,
  ConsoleDnsFacade,
  consoleDnsReducer,
  loadDns$,
  confirmDnsFailback$,
  reloadDnsAfterFailback$,
  ConsoleLiveFacade,
  consoleLiveReducer,
  loadLiveTargets$,
  loadTerminalSessions$,
  loadTunnels$,
  ConsoleFilesFacade,
  consoleFilesReducer,
  openFilesDirectory$,
  refreshFiles$,
  runFileOperation$,
  reloadAfterFileOperation$,
  ConsoleAuditFacade,
  consoleAuditReducer,
  searchAudit$,
  auditPageNavigation$,
  loadAuditPage$,
  verifyAudit$,
  ConsoleUsageFacade,
  consoleUsageReducer,
  loadUsage$,
  ConsoleSlosFacade,
  consoleSlosReducer,
  loadSlos$,
  ConsoleStatusPagesFacade,
  consoleStatusPagesReducer,
  loadStatusPages$,
  loadIncidents$,
  createIncident$,
  updateIncident$,
  ConsoleSearchFacade,
  consoleSearchReducer,
  globalSearch$,
  loadSearchFavourites$,
  setSearchFavourite$,
  recordSearchVisit$,
  runSearchAction$,
  ConsoleReportsFacade,
  consoleReportsReducer,
  loadReports$,
  runReport$,
  reloadReportsAfterRun$,
  openReportFolder$,
  ConsoleAccessManagementFacade,
  consoleAccessManagementReducer,
  loadAccessProjects$,
  loadClusterMembers$,
  loadProjectAccess$,
  changeClusterMember$,
  changeProjectMember$,
  updateProjectSettings$,
  acceptCrossProjectRequest$,
  exportAccess$,
  importAccess$,
  ConsoleRemoteAccessFacade,
  consoleRemoteAccessReducer,
  loadDevices$,
  revokeDevice$,
  ConsoleWallboardsFacade,
  consoleWallboardsReducer,
  loadWallboards$,
  createWallboard$,
  revokeWallboard$,
  loadKiosk$,
  ConsoleGitFacade,
  consoleGitReducer,
  loadGitConnections$,
  loadGitCommits$,
  createGitConnection$,
  updateGitConnection$,
  deleteGitConnection$,
  runGitConnectionAction$,
  reloadAfterGitAction$,
  revealGitWebhookSecret$,
  rotateGitWebhookSecret$,
  loadGitSopsRecipient$,
  ConsoleGitAccountsFacade,
  consoleGitAccountsReducer,
  loadGitAccounts$,
  linkGitAccount$,
  followGitAccountAuthorize$,
  unlinkGitAccount$,
  loadPendingGitLink$,
  confirmPendingGitLink$,
  reloadAfterGitLinkConfirmed$,
  cancelPendingGitLink$,
  ConsoleUpdatesFacade,
  consoleUpdatesReducer,
  loadUpdates$,
  loadRollout$,
  downloadRelease$,
  uploadBundle$,
  createRollout$,
  openCreatedRollout$,
  rolloutActions$,
  reloadUpdatesAfterChange$,
  ConsoleBackupsFacade,
  consoleBackupsReducer,
  loadBackups$,
  loadBackup$,
  loadBackupFiles$,
  loadBackupDiff$,
  loadRestores$,
  loadDeletions$,
  backupNow$,
  startRestoreTest$,
  requestBackupDeletion$,
  backupDeletionActions$,
  reloadBackupsAfterChange$,
  planRestore$,
  openRestorePlan$,
  ConsoleBackupKeysFacade,
  consoleBackupKeysReducer,
  loadBackupKeys$,
  backupKeyActions$,
  reloadBackupKeysAfterAction$,
  ConsoleFleetFacade,
  consoleFleetReducer,
  FLEET_FEATURE_CONFIG,
  loadFleetClusters$,
  saveFleetCluster$,
  deleteFleetCluster$,
  testFleetConnection$,
  pollFleetCluster$,
  loadFleetGrants$,
  putFleetGrant$,
  deleteFleetGrant$,
  reloadFleetGrants$,
  loadFleetCards$,
  loadFleetInbox$,
  loadFleetSites$,
  loadFleetComparison$,
  loadFleetOperations$,
  createFleetOperation$,
  cancelFleetOperation$,
  loadFleetCloudStatus$,
  searchFleetAudit$,
  fleetAuditPageNavigation$,
  loadFleetAuditPage$,
  openFleetCluster$,
  leaveFleetClusterOnLogout$,
} from '@forepath/loadweaver/frontend/data-access-console';
import { buildPageTitle } from '@forepath/loadweaver/frontend/util-configuration';
import {
  createNotificationAdminRoutes,
  notificationAdminProviders,
} from '@forepath/shared/frontend/feature-notifications';
import { createUpdatesAdminRoutes, updatesAdminProviders } from '@forepath/shared/frontend/feature-updates';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';
import { provideMonacoEditor } from 'ngx-monaco-editor-v2';

import { LoadweaverAlertDetailPageComponent } from './alerts/alert-detail-page.component';
import { LoadweaverAlertsPageComponent } from './alerts/alerts-page.component';
import { LoadweaverCertificateDetailPageComponent } from './certificates/certificate-detail-page.component';
import { LoadweaverCertificatesPageComponent } from './certificates/certificates-page.component';
import { LoadweaverCertificatesStore } from './certificates/certificates-store';
import { LoadweaverConsoleContainerComponent } from './container/container.component';
import { LoadweaverDriftPageComponent } from './drift/drift-page.component';
import { LoadweaverImportPageComponent } from './import/import-page.component';
import { LoadweaverImportsPageComponent } from './import/imports-page.component';
import { clusterAdminGuard } from './guards/cluster-admin.guard';
import { clusterRoleGuard } from './guards/cluster-role.guard';
import { globalAdminGuard } from './guards/global-admin.guard';
import { LoadweaverHealthDetailPageComponent } from './health/health-detail-page.component';
import { healthEntityMatcher } from './health/health-format';
import { LoadweaverHealthPageComponent } from './health/health-page.component';
import { LoadweaverPlanDetailPageComponent } from './plans/plan-detail-page.component';
import { LoadweaverPlansPageComponent } from './plans/plans-page.component';
import { LoadweaverSectionPageComponent } from './section/section-page.component';
import { LoadweaverObjectPageComponent } from './objects/object-page.component';
import { LoadweaverTasksPageComponent } from './nav/tasks-page.component';
import { LoadweaverResourcesShellComponent } from './objects/resources-shell.component';
import { landingGuard } from './guards/landing.guard';
import {
  LoadweaverMasterDetailComponent,
  LoadweaverMasterDetailEmptyComponent,
  type MasterDetailData,
} from './section/master-detail.component';
import { LoadweaverAlertSilencesLaneComponent } from './alerts/alert-silences-lane.component';
import { LoadweaverTopologyMapComponent } from './topology/topology-map.component';
import { ResourcesContextService } from './objects/resources-context.service';
import { LoadweaverLogsPageComponent } from './logs/logs-page.component';
import { LoadweaverMetricsPageComponent } from './metrics/metrics-page.component';
import { openCreateModalGuard } from './objects/resource-modal.service';
import { LoadweaverDnsPageComponent } from './dns/dns-page.component';
import { LoadweaverTerminalsPageComponent } from './terminals/terminals-page.component';
import { LoadweaverFilesPageComponent } from './files/files-page.component';
import { LoadweaverSessionsPageComponent } from './sessions/sessions-page.component';
import { LoadweaverAuditPageComponent } from './audit/audit-page.component';
import { LoadweaverUsagePageComponent } from './usage/usage-page.component';
import { LoadweaverSlosPageComponent } from './slos/slos-page.component';
import { LoadweaverStatusPagesPageComponent } from './status-pages/status-pages-page.component';
import { LoadweaverSearchPageComponent } from './search/search-page.component';
import { LoadweaverReportsPageComponent } from './reports/reports-page.component';
import { LoadweaverAccessPageComponent } from './access/access-page.component';
import { LoadweaverProjectRequestsPageComponent } from './access/project-requests-page.component';
import { LoadweaverDevicesPageComponent } from './devices/devices-page.component';
import { LoadweaverPosturePageComponent } from './posture/posture-page.component';
import { LoadweaverWallboardsPageComponent } from './wallboards/wallboards-page.component';
import { LoadweaverKioskPageComponent } from './wallboards/kiosk-page.component';
import { LoadweaverGitConnectionPageComponent } from './git/git-connection-page.component';
import { LoadweaverGitPageComponent } from './git/git-page.component';
import { LoadweaverGitSopsPageComponent } from './git/git-sops-page.component';
import { LoadweaverSecretAdminPageComponent } from './secret-admin/secret-admin-page.component';
import { LoadweaverDraftDetailPageComponent } from './drafts/draft-detail-page.component';
import { LoadweaverDraftsPageComponent } from './drafts/drafts-page.component';
import { LoadweaverGitAccountsPageComponent } from './settings/git-accounts-page.component';
import { LoadweaverTrustedFleetsPageComponent } from './settings/trusted-fleets-page.component';
import { LoadweaverIntegrationsPageComponent } from './settings/integrations-page.component';
import { LoadweaverUpdateDetailPageComponent } from './updates/update-detail-page.component';
import { LoadweaverUpdatesPageComponent } from './updates/updates-page.component';
import { LoadweaverUpdatesPlanner } from './updates/updates-planner';
import { LoadweaverUpdatesSummaryComponent } from './updates/updates-summary.component';
import { LoadweaverBackupsPageComponent } from './backups/backups-page.component';
import { LoadweaverBackupsOverviewComponent } from './backups/backups-overview.component';
import { LoadweaverBackupsSummaryComponent } from './backups/backups-summary.component';
import { LoadweaverBackupDetailPageComponent } from './backups/backup-detail-page.component';
import { LoadweaverBackupDiffPageComponent } from './backups/backup-diff-page.component';
import { LoadweaverBackupRestoresPageComponent } from './backups/backup-restores-page.component';
import { LoadweaverBackupDeletionsPageComponent } from './backups/backup-deletions-page.component';
import { LoadweaverBackupKeysPageComponent } from './backups/backup-keys-page.component';
import { LoadweaverPlatformBackupsPageComponent } from './backups/platform-backups-page.component';
import { LoadweaverFleetAuditPageComponent } from './fleet/fleet-audit-page.component';
import { LoadweaverFleetClusterDetailPageComponent } from './fleet/fleet-cluster-detail-page.component';
import { LoadweaverFleetClustersPageComponent } from './fleet/fleet-clusters-page.component';
import { LoadweaverFleetComparePageComponent } from './fleet/fleet-compare-page.component';
import { LoadweaverFleetOperationsPageComponent } from './fleet/fleet-operations-page.component';
import { LoadweaverFleetOverviewPageComponent } from './fleet/fleet-overview-page.component';
import { LoadweaverFleetUnavailablePageComponent } from './fleet/fleet-unavailable-page.component';
import {
  fleetClusterEntryGuard,
  fleetClusterLinkMatcher,
  fleetConsoleGuard,
  fleetModeOnlyGuard,
} from './guards/fleet-mode.guard';
import { fleetCompareGuard } from './guards/fleet-compare.guard';

/** The identity lib's personal access token route; the console mounts it at `/account/tokens` (3.37). */
const IDENTITY_TOKENS_PATH = 'settings/tokens';

export const loadweaverConsoleRoutes: Route[] = [
  {
    path: '',
    component: LoadweaverConsoleContainerComponent,
    // Fleet mode (3.24): cluster views need an active cluster, unrelayed views show a notice (see the guard).
    canActivateChild: [fleetConsoleGuard],
    children: [
      // Landing (3.37): Resources → Cluster → Summary; project members their first project's Summary.
      { path: '', pathMatch: 'full', canActivate: [authGuard, landingGuard], children: [] },
      // Personal access tokens live under Account (3.37: `/account/tokens`, below); the identity lib's own path is dropped.
      ...identityAuthRoutes.filter((route) => route.path !== IDENTITY_TOKENS_PATH),
      {
        path: 'fleet',
        component: LoadweaverFleetOverviewPageComponent,
        canActivate: [authGuard, fleetModeOnlyGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleFleetOverview-title:Fleet overview`),
      },
      {
        path: 'fleet/clusters',
        component: LoadweaverFleetClustersPageComponent,
        canActivate: [authGuard, fleetModeOnlyGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleFleetClusters-title:Clusters`),
      },
      {
        path: 'fleet/clusters/:id',
        component: LoadweaverFleetClusterDetailPageComponent,
        canActivate: [authGuard, fleetModeOnlyGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleFleetCluster-title:Cluster`),
      },
      {
        path: 'fleet/compare',
        component: LoadweaverFleetComparePageComponent,
        canActivate: [authGuard, fleetModeOnlyGuard, fleetCompareGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleFleetCompare-title:Compare clusters`),
      },
      {
        path: 'fleet/operations',
        component: LoadweaverFleetOperationsPageComponent,
        canActivate: [authGuard, fleetModeOnlyGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleFleetOps-title:Fleet operations`),
      },
      {
        path: 'fleet/audit',
        component: LoadweaverFleetAuditPageComponent,
        canActivate: [authGuard, fleetModeOnlyGuard, globalAdminGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleFleetAudit-title:Fleet audit log`),
      },
      {
        path: 'fleet/unavailable',
        component: LoadweaverFleetUnavailablePageComponent,
        canActivate: [authGuard, fleetModeOnlyGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleFleetUnavailable-title:Not available through the fleet`),
      },
      {
        // `/clusters/<id>/<path>`: links of fleet cards and the merged inbox (the guard redirects into the cluster).
        matcher: fleetClusterLinkMatcher,
        canActivate: [authGuard, fleetClusterEntryGuard],
        children: [],
      },
      ...createNotificationAdminRoutes([authGuard, clusterAdminGuard]),
      {
        // Resources (3.37): the resource tree beside the object pages (`?tab=`); `-` = cluster-level resources.
        path: 'resources',
        component: LoadweaverResourcesShellComponent,
        canActivate: [authGuard],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'cluster' },
          {
            path: 'cluster',
            component: LoadweaverObjectPageComponent,
            data: { objectKind: 'cluster' },
            title: () => buildPageTitle($localize`:@@lwConsoleResources-cluster:Cluster`),
          },
          {
            path: 'site/:name',
            component: LoadweaverObjectPageComponent,
            data: { objectKind: 'site' },
            title: () => buildPageTitle($localize`:@@lwConsoleObject-siteTitle:Site`),
          },
          {
            path: 'node/:name',
            component: LoadweaverObjectPageComponent,
            data: { objectKind: 'node' },
            title: () => buildPageTitle($localize`:@@lwConsoleNodeDetail-title:Node`),
          },
          {
            path: 'project/:name',
            component: LoadweaverObjectPageComponent,
            data: { objectKind: 'project' },
            title: () => buildPageTitle($localize`:@@lwConsoleObject-projectTitle:Project`),
          },
          {
            path: ':kind/:project/:name',
            component: LoadweaverObjectPageComponent,
            title: () => buildPageTitle($localize`:@@lwConsoleResourceDetail-title:Resource`),
          },
        ],
      },
      {
        // Create deep links (search actions, bookmarks; 2026-10-29): `/create[/<kind>][?project=]` opens the create
        // modal over its parent page (the project page, else the cluster page) — creation itself is a modal.
        path: 'create',
        canActivate: [authGuard, openCreateModalGuard],
        children: [],
      },
      {
        path: 'create/:kind',
        canActivate: [authGuard, openCreateModalGuard],
        children: [],
      },
      // Release announcements of the shared updates feature (global admins and the API key).
      ...createUpdatesAdminRoutes([authGuard, globalAdminGuard], 'updates/announcements'),

      {
        // Activity section (3.37): its pages behind the section's vertical sub-nav.
        path: 'activity',
        component: LoadweaverSectionPageComponent,
        canActivate: [authGuard],
        data: { section: 'activity' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'plans' },

          {
            // Master-detail lanes (3.37 P6): list | detail at ≥ xl; `plans/:id` stays the deep link.
            path: 'plans',
            component: LoadweaverMasterDetailComponent,
            canActivate: [authGuard],
            data: { list: LoadweaverPlansPageComponent, emptyIcon: 'file-diff' } satisfies MasterDetailData,
            title: () => buildPageTitle($localize`:@@lwConsolePlans-title:Plans`),
            children: [
              { path: '', component: LoadweaverMasterDetailEmptyComponent },
              {
                path: ':id',
                component: LoadweaverPlanDetailPageComponent,
                title: () => buildPageTitle($localize`:@@lwConsolePlanDetail-title:Plan`),
              },
            ],
          },

          {
            // Server-side drafts (3.36 / 3.37): list | detail lanes at ≥ xl; `drafts/:id` is the deep link.
            path: 'drafts',
            component: LoadweaverMasterDetailComponent,
            canActivate: [authGuard],
            data: { list: LoadweaverDraftsPageComponent, emptyIcon: 'pencil-square' } satisfies MasterDetailData,
            title: () => buildPageTitle($localize`:@@lwConsoleDrafts-title:Drafts`),
            children: [
              { path: '', component: LoadweaverMasterDetailEmptyComponent },
              {
                path: ':id',
                component: LoadweaverDraftDetailPageComponent,
                title: () => buildPageTitle($localize`:@@lwConsoleDrafts-detailTitle:Draft`),
              },
            ],
          },

          {
            // Running and recent tasks (3.37 P4): the task dock's list in full.
            path: 'tasks',
            component: LoadweaverTasksPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleNav-tasks:Tasks`),
          },

          {
            path: 'audit',
            component: LoadweaverAuditPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleAudit-title:Audit log`),
          },
        ],
      },
      {
        // Observe section (3.37): its pages behind the section's vertical sub-nav.
        path: 'observe',
        component: LoadweaverSectionPageComponent,
        canActivate: [authGuard],
        data: { section: 'observe' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'health' },
          {
            // The map, view-first (3.37): model, actions and draft through the Resources context (not started here:
            // the page drives the topology loads per mode itself).
            path: 'topology',
            component: LoadweaverTopologyMapComponent,
            providers: [ResourcesContextService],
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleObserve-topologyTitle:Topology`),
          },

          {
            path: 'health',
            component: LoadweaverHealthPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleHealth-title:Health`),
          },

          {
            // `/health/<key>`: keys contain slashes (`deployment/shop/store`).
            matcher: healthEntityMatcher,
            component: LoadweaverHealthDetailPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleHealth-title:Health`),
          },

          {
            // Master-detail lanes (3.37 P6): alert list | alert detail, or the current silences while none is open.
            path: 'alerts',
            component: LoadweaverMasterDetailComponent,
            canActivate: [authGuard],
            data: {
              list: LoadweaverAlertsPageComponent,
              empty: LoadweaverAlertSilencesLaneComponent,
            } satisfies MasterDetailData,
            title: () => buildPageTitle($localize`:@@lwConsoleAlerts-title:Alerts`),
            children: [
              { path: '', component: LoadweaverMasterDetailEmptyComponent },
              {
                path: ':id',
                component: LoadweaverAlertDetailPageComponent,
                title: () => buildPageTitle($localize`:@@lwConsoleAlertDetail-title:Alert`),
              },
            ],
          },

          {
            path: 'slos',
            component: LoadweaverSlosPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleSlos-title:SLOs`),
          },

          {
            // `?project=&tab=incidents`: the project and tab shown.
            path: 'status-pages',
            component: LoadweaverStatusPagesPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleStatusPages-title:Status pages`),
          },

          {
            path: 'logs',
            component: LoadweaverLogsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleLogs-title:Logs`),
          },

          {
            path: 'metrics',
            component: LoadweaverMetricsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleMetrics-title:Metrics`),
          },

          {
            path: 'reports',
            component: LoadweaverReportsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleReports-title:Reports`),
          },

          {
            path: 'usage',
            component: LoadweaverUsagePageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleUsage-title:Usage`),
          },

          {
            path: 'wallboards',
            component: LoadweaverWallboardsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleWallboards-title:Wallboards`),
          },
        ],
      },
      {
        // Operate section (3.37): its pages behind the section's vertical sub-nav.
        path: 'operate',
        component: LoadweaverSectionPageComponent,
        canActivate: [authGuard],
        data: { section: 'operate' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'terminals' },

          {
            path: 'terminals',
            component: LoadweaverTerminalsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleTerminals-title:Terminals`),
          },

          {
            path: 'files',
            component: LoadweaverFilesPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleFiles-title:Files`),
          },

          {
            path: 'sessions',
            component: LoadweaverSessionsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleSessions-title:Sessions and tunnels`),
          },

          {
            // `?project=&tab=tests`.
            path: 'backups/restores',
            component: LoadweaverBackupRestoresPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleBackupRestores-pageTitle:Restores`),
          },

          {
            path: 'backups/deletions',
            component: LoadweaverBackupDeletionsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleBackupDeletions-pageTitle:Backup deletion requests`),
          },

          {
            // The backup key and recovery kit: cluster admins.
            path: 'backups/keys',
            component: LoadweaverBackupKeysPageComponent,
            canActivate: [authGuard, clusterAdminGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleBackupKeys-pageTitle:Recovery kit`),
          },

          {
            // Control-plane backups, point-in-time recovery / cut-over and disaster recovery: cluster roles read.
            path: 'backups/platform',
            component: LoadweaverPlatformBackupsPageComponent,
            canActivate: [authGuard, clusterRoleGuard],
            title: () => buildPageTitle($localize`:@@lwConsolePlatformBackups-pageTitle:Platform backups`),
          },

          {
            // `?from=&to=`: two backups of the same volume.
            path: 'backups/diff',
            component: LoadweaverBackupDiffPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleBackupDiff-pageTitle:Compare backups`),
          },

          {
            // Backups (3.20): catalog / timeline per volume (`?project=`) | a backup (`:id`, `?path=`) as
            // master-detail lanes (3.37 P6). Keep after the fixed `backups/…` routes.
            path: 'backups',
            component: LoadweaverMasterDetailComponent,
            canActivate: [authGuard],
            data: {
              list: LoadweaverBackupsPageComponent,
              emptyIcon: 'safe',
              // 3.38: header + pins + KPI bar span the row; usage | targets lanes while no backup is open.
              summary: LoadweaverBackupsSummaryComponent,
              empty: LoadweaverBackupsOverviewComponent,
            } satisfies MasterDetailData,
            title: () => buildPageTitle($localize`:@@lwConsoleBackups-pageTitle:Backups`),
            children: [
              { path: '', component: LoadweaverMasterDetailEmptyComponent },
              {
                path: ':id',
                component: LoadweaverBackupDetailPageComponent,
                title: () => buildPageTitle($localize`:@@lwConsoleBackupDetail-pageTitle:Backup`),
              },
            ],
          },

          {
            path: 'imports',
            component: LoadweaverImportsPageComponent,
            canActivate: [authGuard, clusterRoleGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleImport-listTitle:Import hosts`),
          },

          {
            path: 'imports/:node',
            component: LoadweaverImportPageComponent,
            canActivate: [authGuard, clusterRoleGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleImport-pageTitle:Import wizard`),
          },
        ],
      },
      {
        // Delivery section (3.37): its pages behind the section's vertical sub-nav.
        path: 'delivery',
        component: LoadweaverSectionPageComponent,
        canActivate: [authGuard],
        data: { section: 'delivery' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'git' },

          {
            // Git connections per scope (3.29); `/git/<id>` (inbox links) shows one, `?connection=<id>` redirects
            // there. 3.38: the master-detail shell (connections | the open connection).
            path: 'git',
            component: LoadweaverMasterDetailComponent,
            canActivate: [authGuard],
            data: { list: LoadweaverGitPageComponent, emptyIcon: 'git' } satisfies MasterDetailData,
            title: () => buildPageTitle($localize`:@@lwConsoleGit-title:Git`),
            children: [
              { path: '', component: LoadweaverMasterDetailEmptyComponent },
              { path: ':id', component: LoadweaverGitConnectionPageComponent },
            ],
          },

          {
            // The cluster's SOPS age recipient (3.38: its own page, was a panel under the Git list).
            path: 'sops',
            component: LoadweaverGitSopsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleGit-sops:SOPS`),
          },
          {
            // Secrets administration (3.40): every secret the caller may manage, natively and through the fleet.
            path: 'secrets',
            component: LoadweaverSecretAdminPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleSecrets-title:Secrets`),
          },

          {
            path: 'drift',
            component: LoadweaverDriftPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleDrift-title:Drift`),
          },
          {
            // Updates (3.26), cluster roles. 3.38: the master-detail shell, page head + KPIs as its `summary`, lanes
            // Releases | Update plans | Maintenance windows as a `fill` list (old `?tab=` picks the phone lane), an
            // update plan (`rollouts/:id`) as the detail beside the Update plans lane.
            path: 'updates',
            component: LoadweaverMasterDetailComponent,
            canActivate: [authGuard, clusterRoleGuard],
            providers: [LoadweaverUpdatesPlanner],
            data: {
              list: LoadweaverUpdatesPageComponent,
              summary: LoadweaverUpdatesSummaryComponent,
              fill: true,
              emptyIcon: 'list-check',
            } satisfies MasterDetailData,
            title: () => buildPageTitle($localize`:@@lwConsoleUpdates-pageTitle:Updates`),
            children: [
              { path: '', component: LoadweaverMasterDetailEmptyComponent },
              {
                path: 'rollouts/:id',
                component: LoadweaverUpdateDetailPageComponent,
                canActivate: [authGuard, clusterRoleGuard],
                title: () => buildPageTitle($localize`:@@lwConsoleUpdateDetail-pageTitle:Update plan`),
              },
            ],
          },

          {
            // Ingress certificates (cluster roles); `/certificates/<id>` is where inbox / overview items link.
            // 3.38: the master-detail shell (list lane | detail route), one load via the route's store.
            path: 'certificates',
            component: LoadweaverMasterDetailComponent,
            canActivate: [authGuard, clusterRoleGuard],
            providers: [LoadweaverCertificatesStore],
            data: { list: LoadweaverCertificatesPageComponent, emptyIcon: 'shield-lock' } satisfies MasterDetailData,
            title: () => buildPageTitle($localize`:@@lwConsoleCertificates-title:Certificates`),
            children: [
              { path: '', component: LoadweaverMasterDetailEmptyComponent },
              { path: ':id', component: LoadweaverCertificateDetailPageComponent },
            ],
          },

          {
            // DNS (3.38): four sub-nav entries Records (`/dns`) | Zones | DNSSEC | Failover, one view per page.
            path: 'dns',
            component: LoadweaverDnsPageComponent,
            canActivate: [authGuard],
            data: { dnsView: 'records' },
            title: () => buildPageTitle($localize`:@@lwConsoleDns-recordsTitle:DNS records`),
          },
          {
            path: 'dns/zones',
            component: LoadweaverDnsPageComponent,
            canActivate: [authGuard, clusterRoleGuard],
            data: { dnsView: 'zones' },
            title: () => buildPageTitle($localize`:@@lwConsoleDns-zonesTitle:DNS zones`),
          },
          {
            path: 'dns/dnssec',
            component: LoadweaverDnsPageComponent,
            canActivate: [authGuard, clusterRoleGuard],
            data: { dnsView: 'dnssec' },
            title: () => buildPageTitle($localize`:@@lwConsoleDns-dnssecTitle:DNSSEC`),
          },
          {
            path: 'dns/failover',
            component: LoadweaverDnsPageComponent,
            canActivate: [authGuard, clusterRoleGuard],
            data: { dnsView: 'failover' },
            title: () => buildPageTitle($localize`:@@lwConsoleDns-failoverTitle:DNS failover`),
          },
        ],
      },
      {
        // Access section (3.37): its pages behind the section's vertical sub-nav.
        path: 'access',
        component: LoadweaverSectionPageComponent,
        canActivate: [authGuard],
        data: { section: 'access' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'members' },

          {
            // `?project=`: the project shown.
            path: 'members',
            component: LoadweaverAccessPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleAccess-title:Access`),
          },

          {
            // Where the overview's cross-project request items lead.
            path: 'requests/:project',
            component: LoadweaverProjectRequestsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleProjectRequests-title:Requests from other projects`),
          },

          {
            path: 'devices',
            component: LoadweaverDevicesPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleDevices-title:Remote access`),
          },

          {
            // Posture integrations (MDM / EDR) and device certificate trust (3.31); the API enforces infra / admin.
            path: 'posture',
            component: LoadweaverPosturePageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsolePosture-title:Device posture`),
          },
        ],
      },

      {
        // `?q=`: the query.
        path: 'search',
        component: LoadweaverSearchPageComponent,
        canActivate: [authGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleSearch-title:Search`),
      },
      {
        // Account (3.37): the caller's own tokens and linked Git accounts (sidebar footer "Account").
        path: 'account',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'git-accounts' },
          // The identity lib's token manager (same guards and title), mounted here instead of `/settings/tokens`.
          ...identityAuthRoutes
            .filter((route) => route.path === IDENTITY_TOKENS_PATH)
            .map((route): Route => ({ ...route, path: 'tokens' })),
          {
            // The caller's linked Git accounts (3.30); the OAuth callback returns here with `?confirm=` or `?error=`.
            path: 'git-accounts',
            component: LoadweaverGitAccountsPageComponent,
            canActivate: [authGuard],
            title: () => buildPageTitle($localize`:@@lwConsoleGitAccounts-title:Linked Git accounts`),
          },
        ],
      },
      {
        // Setup (3.41): the cluster's external providers and settings with state, edit / test; cluster roles (the page
        // gates actions). First rail tile.
        path: 'setup',
        component: LoadweaverIntegrationsPageComponent,
        canActivate: [authGuard, clusterRoleGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleIntegrations-title:Setup`),
      },
      { path: 'settings/integrations', redirectTo: 'setup', pathMatch: 'full' },
      {
        // Trusted fleets (3.24): the fleets whose signed identities count for approvals; native only (not relayed).
        path: 'settings/trusted-fleets',
        component: LoadweaverTrustedFleetsPageComponent,
        canActivate: [authGuard, clusterAdminGuard],
        title: () => buildPageTitle($localize`:@@lwConsoleTrustedFleets-pageTitle:Trusted fleets`),
      },
      {
        // No login: the wallboard token in the URL fragment (`/kiosk#<token>`) is the only credential.
        path: 'kiosk',
        component: LoadweaverKioskPageComponent,
        title: () => buildPageTitle($localize`:@@lwConsoleKiosk-title:Wallboard`),
      },
      { path: '**', redirectTo: '' },
    ],
    providers: [
      ...identityAuthProviders,
      ...notificationAdminProviders,
      ConsoleAccessFacade,
      ConsoleNavService,
      ConsoleOverviewFacade,
      ConsolePlansFacade,
      ConsoleHealthFacade,
      ConsoleAlertsFacade,
      ConsoleDriftFacade,
      ConsoleTopologyFacade,
      ConsoleLogsFacade,
      ConsoleMetricsFacade,
      ConsoleDashboardsFacade,
      ConsoleResourcesFacade,
      ConsolePoliciesFacade,
      ConsoleNodesFacade,
      ConsoleVirtualMachinesFacade,
      ConsoleDnsFacade,
      ConsoleLiveFacade,
      ConsoleFilesFacade,
      ConsoleAuditFacade,
      ConsoleUsageFacade,
      ConsoleSlosFacade,
      ConsoleStatusPagesFacade,
      ConsoleSearchFacade,
      ConsoleReportsFacade,
      provideState('consoleSlos', consoleSlosReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleStatusPages', consoleStatusPagesReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleSearch', consoleSearchReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleReports', consoleReportsReducer, CONSOLE_FEATURE_CONFIG),
      ConsoleAccessManagementFacade,
      ConsoleRemoteAccessFacade,
      ConsoleWallboardsFacade,
      provideState('consoleAccessManagement', consoleAccessManagementReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleRemoteAccess', consoleRemoteAccessReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleWallboards', consoleWallboardsReducer, CONSOLE_FEATURE_CONFIG),
      ...updatesAdminProviders,
      ConsoleUpdatesFacade,
      provideState('consoleUpdates', consoleUpdatesReducer, CONSOLE_FEATURE_CONFIG),
      ConsoleBackupsFacade,
      ConsoleBackupKeysFacade,
      provideState('consoleBackups', consoleBackupsReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleBackupKeys', consoleBackupKeysReducer, CONSOLE_FEATURE_CONFIG),
      ConsoleGitFacade,
      ConsoleGitAccountsFacade,
      provideState('consoleGit', consoleGitReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleGitAccounts', consoleGitAccountsReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleLive', consoleLiveReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleFiles', consoleFilesReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleAudit', consoleAuditReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleUsage', consoleUsageReducer, CONSOLE_FEATURE_CONFIG),
      // The resource editor (Monaco, served from `assets/monaco/min/vs` by the app build).
      provideMonacoEditor({ baseUrl: './assets/monaco/min/vs' }),
      provideState('consoleResources', consoleResourcesReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consolePolicies', consolePoliciesReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleNodes', consoleNodesReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleVirtualMachines', consoleVirtualMachinesReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleDns', consoleDnsReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleTopology', consoleTopologyReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleLogs', consoleLogsReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleMetrics', consoleMetricsReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleDashboards', consoleDashboardsReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleAccess', consoleAccessReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleOverview', consoleOverviewReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consolePlans', consolePlansReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleHealth', consoleHealthReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleAlerts', consoleAlertsReducer, CONSOLE_FEATURE_CONFIG),
      provideState('consoleDrift', consoleDriftReducer, CONSOLE_FEATURE_CONFIG),
      // The fleet's own views outlive cluster switches (reset on logout only).
      ConsoleFleetFacade,
      provideState('consoleFleet', consoleFleetReducer, FLEET_FEATURE_CONFIG),
      provideEffects({
        loadFleetClusters$,
        saveFleetCluster$,
        deleteFleetCluster$,
        testFleetConnection$,
        pollFleetCluster$,
        loadFleetGrants$,
        putFleetGrant$,
        deleteFleetGrant$,
        reloadFleetGrants$,
        loadFleetCards$,
        loadFleetInbox$,
        loadFleetSites$,
        loadFleetComparison$,
        loadFleetOperations$,
        createFleetOperation$,
        cancelFleetOperation$,
        loadFleetCloudStatus$,
        searchFleetAudit$,
        fleetAuditPageNavigation$,
        loadFleetAuditPage$,
        openFleetCluster$,
        leaveFleetClusterOnLogout$,
      }),
      provideEffects({
        loadAccess$,
        loadOverview$,
        loadPlans$,
        loadPlan$,
        planActions$,
        reloadPlanAfterAction$,
        plansLive$,
        reloadSelectedPlanOnPatch$,
        loadHealthTree$,
        loadHealthEntity$,
        loadHealthHistory$,
        loadAlerts$,
        loadAlert$,
        acknowledgeAlert$,
        loadSilences$,
        createSilence$,
        endSilence$,
        reloadSilencesAfterEnd$,
        loadDrift$,
        proposeDriftPlan$,
        openProposedDriftPlan$,
        loadTopology$,
        traceTopology$,
        topologyLive$,
        reloadTopologyOnStructureChange$,
        searchLogs$,
        logsPageNavigation$,
        loadLogsPage$,
        logsTail$,
        loadMetricNames$,
        queryMetrics$,
        loadMetricEvents$,
        loadDashboards$,
        runDashboard$,
        loadResources$,
        loadResource$,
        loadResourceKinds$,
        loadResourceSchema$,
        planResourceChange$,
        openResourcePlan$,
        loadPolicies$,
        loadGroupMembers$,
        loadNodes$,
        loadNode$,
        nodeActions$,
        loadJoinTokens$,
        createJoinToken$,
        revokeJoinToken$,
        loadVirtualMachines$,
        loadVirtualMachine$,
        virtualMachineActions$,
        loadVmSnapshots$,
        createVmSnapshot$,
        loadVmImageImports$,
        loadVmRegistryImages$,
        importVmImage$,
        loadDns$,
        confirmDnsFailback$,
        reloadDnsAfterFailback$,
        loadLiveTargets$,
        loadTerminalSessions$,
        loadTunnels$,
        openFilesDirectory$,
        refreshFiles$,
        runFileOperation$,
        reloadAfterFileOperation$,
        searchAudit$,
        auditPageNavigation$,
        loadAuditPage$,
        verifyAudit$,
        loadUsage$,
        loadSlos$,
        loadStatusPages$,
        loadIncidents$,
        createIncident$,
        updateIncident$,
        globalSearch$,
        loadSearchFavourites$,
        setSearchFavourite$,
        recordSearchVisit$,
        runSearchAction$,
        loadReports$,
        runReport$,
        reloadReportsAfterRun$,
        openReportFolder$,
        loadAccessProjects$,
        loadClusterMembers$,
        loadProjectAccess$,
        changeClusterMember$,
        changeProjectMember$,
        updateProjectSettings$,
        acceptCrossProjectRequest$,
        exportAccess$,
        importAccess$,
        loadDevices$,
        revokeDevice$,
        loadWallboards$,
        createWallboard$,
        revokeWallboard$,
        loadKiosk$,
        loadGitConnections$,
        loadGitCommits$,
        createGitConnection$,
        updateGitConnection$,
        deleteGitConnection$,
        runGitConnectionAction$,
        reloadAfterGitAction$,
        revealGitWebhookSecret$,
        rotateGitWebhookSecret$,
        loadGitSopsRecipient$,
        loadGitAccounts$,
        linkGitAccount$,
        followGitAccountAuthorize$,
        unlinkGitAccount$,
        loadPendingGitLink$,
        confirmPendingGitLink$,
        reloadAfterGitLinkConfirmed$,
        cancelPendingGitLink$,
        loadUpdates$,
        loadRollout$,
        downloadRelease$,
        uploadBundle$,
        createRollout$,
        openCreatedRollout$,
        rolloutActions$,
        reloadUpdatesAfterChange$,
        loadBackups$,
        loadBackup$,
        loadBackupFiles$,
        loadBackupDiff$,
        loadRestores$,
        loadDeletions$,
        backupNow$,
        startRestoreTest$,
        requestBackupDeletion$,
        backupDeletionActions$,
        reloadBackupsAfterChange$,
        planRestore$,
        openRestorePlan$,
        loadBackupKeys$,
        backupKeyActions$,
        reloadBackupKeysAfterAction$,
      }),
    ],
  },
];
