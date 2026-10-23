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
import { NOTIFICATION_ADMIN_ENVIRONMENT } from '@forepath/shared/frontend/data-access-notifications';
import { UPDATES_ADMIN_ENVIRONMENT } from '@forepath/shared/frontend/data-access-updates';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

/** The build swaps `environment` for the console's (fileReplacements), so it has the console's shape. */
const consoleEnvironment = environment as unknown as LoadweaverConsoleEnvironment;

const consoleRoutes = () =>
  import('@forepath/loadweaver/frontend/feature-console').then((m) => m.loadweaverConsoleRoutes);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
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
      provide: NOTIFICATION_ADMIN_ENVIRONMENT,
      useFactory: (env: LoadweaverConsoleEnvironment) => ({
        apiUrl: env.console.urls.restApi,
        webhooksBasePath: 'admin/webhooks',
        applicationId: 'loadweaver' as const,
        clientFilterEnabled: false,
      }),
      deps: [ENVIRONMENT],
    },
    {
      // Release announcements of the shared updates feature (`/api/updates/announcements`).
      provide: UPDATES_ADMIN_ENVIRONMENT,
      useFactory: (env: LoadweaverConsoleEnvironment) => ({
        apiUrl: env.console.urls.restApi.replace(/\/$/, ''),
        updatesBasePath: 'updates/announcements',
      }),
      deps: [ENVIRONMENT],
    },
    // In fleet mode the console's routing sends `/overview` without an active cluster on to the fleet overview.
    { provide: LOGIN_SUCCESS_REDIRECT_TARGET, useValue: ['/overview'] },
    // KeycloakService before the HTTP client, so the interceptor can inject it.
    ...(consoleEnvironment.authentication.config.type === 'keycloak' ? provideKeycloak() : []),
    provideHttpClient(
      withInterceptors([
        getAuthInterceptor(),
        getUsersSessionInvalidationInterceptor(),
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
