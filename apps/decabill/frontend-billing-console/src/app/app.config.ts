import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { getAuthInterceptor, getUsersSessionInvalidationInterceptor } from '@forepath/identity/frontend';
import { getBillingTenantInterceptor } from '@forepath/decabill/frontend/data-access-billing-console';
import { Environment, ENVIRONMENT, environment, provideLocale } from '@forepath/decabill/frontend/util-configuration';
import { createCookieConsentConfig } from '@forepath/shared/frontend/util-cookie-consent';
import { NOTIFICATION_ADMIN_ENVIRONMENT } from '@forepath/shared/frontend/data-access-notifications';
import { UPDATES_ADMIN_ENVIRONMENT } from '@forepath/shared/frontend/data-access-updates';
import { IDENTITY_AUTH_ENVIRONMENT, LOGIN_SUCCESS_REDIRECT_TARGET, provideKeycloak } from '@forepath/identity/frontend';
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
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

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
    provideFpcTabGroupLabels({ more: $localize`:@@fpcTabGroup-more:More` }),
    provideFpcStepStripLabels({
      previous: $localize`:@@fpcStepStrip-previous:Earlier steps`,
      next: $localize`:@@fpcStepStrip-next:Later steps`,
    }),
    provideFpcListToolbarLabels({
      filters: $localize`:@@fpcListToolbar-filters:Filters`,
      clearAll: $localize`:@@fpcListToolbar-clearAll:Clear all`,
      activeFilters: $localize`:@@fpcListToolbar-activeFilters:Active filters`,
      removeFilter: $localize`:@@fpcListToolbar-removeFilter:Remove filter`,
    }),
    // Wire identity injection tokens to framework's environment and locale service.
    // IDENTITY_AUTH_ENVIRONMENT maps the full Environment to the auth-relevant subset.
    {
      provide: IDENTITY_AUTH_ENVIRONMENT,
      useFactory: (env: Environment) => ({
        productName: env.application.productName,
        authMarketing: env.authentication.marketing,
        authLayout: env.authentication.layout,
        apiUrl: env.billing.urls.restApi,
        additionalApiUrls: [],
        authentication: env.authentication.config,
        controllerApiUrl: env.billing.urls.restApi,
        termsUrl: env.cookieConsent.urls.terms,
        privacyPolicyUrl: env.cookieConsent.urls.privacyPolicy,
      }),
      deps: [ENVIRONMENT],
    },
    {
      provide: NOTIFICATION_ADMIN_ENVIRONMENT,
      useFactory: (env: Environment) => ({
        apiUrl: env.billing.urls.restApi,
        webhooksBasePath: 'admin/billing/webhooks',
        applicationId: 'decabill' as const,
        clientFilterEnabled: false,
      }),
      deps: [ENVIRONMENT],
    },
    {
      provide: UPDATES_ADMIN_ENVIRONMENT,
      useFactory: (env: Environment) => ({
        apiUrl: env.billing.urls.restApi,
        updatesBasePath: 'admin/billing/updates',
        frontendVersion: env.application.version,
      }),
      deps: [ENVIRONMENT],
    },
    {
      provide: LOGIN_SUCCESS_REDIRECT_TARGET,
      useValue: ['/dashboard'],
    },
    // Provide KeycloakService before HTTP client so interceptor can inject it
    ...(environment.authentication.config.type === 'keycloak' ? provideKeycloak() : []),
    // Provide HTTP client with auth interceptor (KeycloakService must be available)
    provideHttpClient(
      withInterceptors([getBillingTenantInterceptor(), getAuthInterceptor(), getUsersSessionInvalidationInterceptor()]),
    ),
    // NgRx Store - base store required at root level
    provideStore(),
    // NgRx Store DevTools - only enabled in non-production environments
    ...(environment.application.production
      ? []
      : [
          provideStoreDevtools({
            maxAge: 25,
          }),
        ]),
    provideRouter(
      [
        {
          path: '',
          loadChildren: () =>
            import('@forepath/decabill/frontend/feature-billing-console').then((app) => app.billingConsoleRoutes),
        },
        ...(environment.application.production
          ? [
              {
                path: 'de',
                loadChildren: () =>
                  import('@forepath/decabill/frontend/feature-billing-console').then((app) => app.billingConsoleRoutes),
              },
              {
                path: 'en',
                loadChildren: () =>
                  import('@forepath/decabill/frontend/feature-billing-console').then((app) => app.billingConsoleRoutes),
              },
            ]
          : []),
      ],
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    ...(environment.cookieConsent.enabled ? [provideNgcCookieConsent(createCookieConsentConfig(environment))] : []),
    provideLocale(),
  ],
};
