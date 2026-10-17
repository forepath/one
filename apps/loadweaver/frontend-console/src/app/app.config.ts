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
      useFactory: (env: LoadweaverConsoleEnvironment) => ({
        productName: env.application.productName,
        authMarketing: env.authentication.marketing,
        authLayout: env.authentication.layout,
        apiUrl: env.console.urls.restApi,
        additionalApiUrls: [],
        authentication: env.authentication.config,
        controllerApiUrl: env.console.urls.restApi,
        termsUrl: env.cookieConsent.urls.terms,
        privacyPolicyUrl: env.cookieConsent.urls.privacyPolicy,
      }),
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
    { provide: LOGIN_SUCCESS_REDIRECT_TARGET, useValue: ['/overview'] },
    // KeycloakService before the HTTP client, so the interceptor can inject it.
    ...(consoleEnvironment.authentication.config.type === 'keycloak' ? provideKeycloak() : []),
    provideHttpClient(withInterceptors([getAuthInterceptor(), getUsersSessionInvalidationInterceptor()])),
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
