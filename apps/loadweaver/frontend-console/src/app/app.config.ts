import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import {
  getAuthInterceptor,
  getUsersSessionInvalidationInterceptor,
  IDENTITY_AUTH_ENVIRONMENT,
  LOGIN_SUCCESS_REDIRECT_TARGET,
  provideKeycloak,
} from '@forepath/identity/frontend';
import {
  ENVIRONMENT,
  environment,
  fleetRelayErrorInterceptor,
  isFleetConsole,
  provideLocale,
  type LoadweaverConsoleEnvironment,
} from '@forepath/loadweaver/frontend/util-configuration';
import {
  clusterScopedApiEnvironment,
  ConsoleEndpointService,
  fleetWriteGuardInterceptor,
} from '@forepath/loadweaver/frontend/data-access-console';
import { NOTIFICATION_ADMIN_ENVIRONMENT } from '@forepath/shared/frontend/data-access-notifications';
import { UPDATES_ADMIN_ENVIRONMENT } from '@forepath/shared/frontend/data-access-updates';
import {
  provideFpcDataTableLabels,
  provideFpcListToolbarLabels,
  provideFpcStepStripLabels,
  provideFpcTabGroupLabels,
  provideFpcDensity,
  provideFpcOverlayPortal,
} from '@forepath/shared/frontend/ui-components';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

/** The build swaps `environment` for the console's (fileReplacements), so it has the console's shape. */
const consoleEnvironment = environment as unknown as LoadweaverConsoleEnvironment;

const consoleRoutes = () =>
  import('@forepath/loadweaver/frontend/feature-console').then((m) => m.loadweaverConsoleRoutes);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Modals / context menus / `appendTo="body"` dropdowns render at <body> level (z-index scale).
    provideFpcOverlayPortal(),
    provideFpcDensity(),
    // Data tables (3.38 D1–D4): localized once; a table's own `labels` still win.
    provideFpcDataTableLabels({
      search: $localize`:@@fpcDataTable-search:Search`,
      filters: $localize`:@@fpcDataTable-filters:Filters`,
      views: $localize`:@@fpcDataTable-views:Views`,
      saveView: $localize`:@@fpcDataTable-saveView:Save current view…`,
      deleteView: $localize`:@@fpcDataTable-deleteView:Delete view`,
      noViews: $localize`:@@fpcDataTable-noViews:No saved views`,
      columns: $localize`:@@fpcDataTable-columns:Columns`,
      refresh: $localize`:@@fpcDataTable-refresh:Refresh`,
      selectAll: $localize`:@@fpcDataTable-selectAll:Select all`,
      selectRow: $localize`:@@fpcDataTable-selectRow:Select row`,
      selected: $localize`:@@fpcDataTable-selected:{count} selected`,
      clearSelection: $localize`:@@fpcDataTable-clearSelection:Clear selection`,
      more: $localize`:@@fpcDataTable-more:More`,
      empty: $localize`:@@fpcDataTable-empty:Nothing to show`,
      noMatches: $localize`:@@fpcDataTable-noMatches:No matches`,
      noMatchesHint: $localize`:@@fpcDataTable-noMatchesHint:Nothing matches the search or filters.`,
      rowActions: $localize`:@@fpcDataTable-rowActions:Row actions`,
      sortAscending: $localize`:@@fpcDataTable-sortAscending:Sorted ascending`,
      sortDescending: $localize`:@@fpcDataTable-sortDescending:Sorted descending`,
      changed: $localize`:@@fpcDataTable-changed:Changed in the draft`,
      state: $localize`:@@fpcDataTable-state:State`,
      pagination: $localize`:@@fpcDataTable-pagination:Pagination`,
      previousPage: $localize`:@@fpcDataTable-previousPage:Previous page`,
      nextPage: $localize`:@@fpcDataTable-nextPage:Next page`,
      pageSize: $localize`:@@fpcDataTable-pageSize:Rows per page`,
      range: $localize`:@@fpcDataTable-range:{from}–{to} of {total}`,
      rangeOpen: $localize`:@@fpcDataTable-rangeOpen:{from}–{to}`,
      loadingMore: $localize`:@@fpcDataTable-loadingMore:Loading more…`,
      collapseGroup: $localize`:@@fpcDataTable-collapseGroup:Collapse group`,
      expandGroup: $localize`:@@fpcDataTable-expandGroup:Expand group`,
      previousColumns: $localize`:@@fpcDataTable-previousColumns:Previous columns`,
      nextColumns: $localize`:@@fpcDataTable-nextColumns:Next columns`,
    }),
    // List toolbar strip (search + filter drawer, 3.38 R12): localized once for every list.
    provideFpcListToolbarLabels({
      filters: $localize`:@@fpcListToolbar-filters:Filters`,
      clearAll: $localize`:@@fpcListToolbar-clearAll:Clear all`,
      activeFilters: $localize`:@@fpcListToolbar-activeFilters:Active filters`,
      removeFilter: $localize`:@@fpcListToolbar-removeFilter:Remove filter`,
    }),
    // Tab bars: trailing overflow item of a horizontal bar (LW-11).
    provideFpcTabGroupLabels({ more: $localize`:@@fpcTabGroup-more:More` }),
    provideFpcStepStripLabels({
      previous: $localize`:@@fpcStepStrip-previous:Earlier steps`,
      next: $localize`:@@fpcStepStrip-next:Later steps`,
    }),
    {
      provide: IDENTITY_AUTH_ENVIRONMENT,
      useFactory: (env: LoadweaverConsoleEnvironment) => {
        // Fleet mode (3.24): users sign in once at the fleet; the relay URLs start with its API, so they carry the token.
        const fleet = isFleetConsole(env);
        const apiUrl = fleet ? (env.fleet?.apiUrl ?? '') : env.console.urls.restApi;

        return {
          productName: env.application.productName,
          authMarketing: env.authentication.marketing,
          authLayout: env.authentication.layout,
          apiUrl,
          additionalApiUrls: [],
          authentication: env.authentication.config,
          controllerApiUrl: apiUrl,
          termsUrl: env.cookieConsent.urls.terms,
          privacyPolicyUrl: env.cookieConsent.urls.privacyPolicy,
          // One-time admin claim of a fresh cluster (Loadweaver Cloud): the register form asks for the token while
          // needed. Not at the fleet (it has no install endpoints).
          adminClaimStatusUrl: fleet
            ? undefined
            : `${env.console.urls.restApi.replace(/\/$/, '')}/install/claim-status`,
        };
      },
      deps: [ENVIRONMENT],
    },
    {
      // Webhooks of the shared notifications feature: the control plane, or the active cluster's relay (fleet mode).
      provide: NOTIFICATION_ADMIN_ENVIRONMENT,
      useFactory: (endpoints: ConsoleEndpointService) =>
        clusterScopedApiEnvironment(endpoints, {
          webhooksBasePath: 'admin/webhooks',
          applicationId: 'loadweaver' as const,
          clientFilterEnabled: false,
        }),
      deps: [ConsoleEndpointService],
    },
    {
      // Release announcements of the shared updates feature (`/api/updates/announcements`).
      provide: UPDATES_ADMIN_ENVIRONMENT,
      useFactory: (endpoints: ConsoleEndpointService) =>
        clusterScopedApiEnvironment(endpoints, { updatesBasePath: 'updates/announcements' }),
      deps: [ConsoleEndpointService],
    },
    // In fleet mode the console's routing sends `/overview` without an active cluster on to the fleet overview.
    { provide: LOGIN_SUCCESS_REDIRECT_TARGET, useValue: ['/overview'] },
    // KeycloakService before the HTTP client, so the interceptor can inject it.
    ...(consoleEnvironment.authentication.config.type === 'keycloak' ? provideKeycloak() : []),
    provideHttpClient(
      withInterceptors([
        getAuthInterceptor(),
        getUsersSessionInvalidationInterceptor(),
        // Fleet mode only: no changes to the active cluster while it is unreachable / read-only (3.43, a no-op otherwise).
        fleetWriteGuardInterceptor,
        // Fleet mode only: clear messages for requests the fleet's relay refuses (a no-op otherwise).
        fleetRelayErrorInterceptor,
      ]),
    ),
    provideStore(),
    ...(consoleEnvironment.application.production ? [] : [provideStoreDevtools({ maxAge: 25 })]),
    provideRouter(
      [
        { path: '', loadChildren: consoleRoutes },
        ...(consoleEnvironment.application.production
          ? [
              { path: 'de', loadChildren: consoleRoutes },
              { path: 'en', loadChildren: consoleRoutes },
            ]
          : []),
      ],
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    provideLocale(),
  ],
};
