import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { getAuthInterceptor, getUsersSessionInvalidationInterceptor } from '@forepath/identity/frontend';
import { getBillingTenantInterceptor } from '@forepath/decabill/frontend/data-access-billing-console';
import { Environment, ENVIRONMENT, environment, provideLocale } from '@forepath/shared/frontend/util-configuration';
import { cookieConfig } from '@forepath/shared/frontend/util-cookie-consent';
import { IDENTITY_AUTH_ENVIRONMENT, LOGIN_SUCCESS_REDIRECT_TARGET, provideKeycloak } from '@forepath/identity/frontend';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Wire identity injection tokens to framework's environment and locale service.
    // IDENTITY_AUTH_ENVIRONMENT maps the full Environment to the auth-relevant subset.
    {
      provide: IDENTITY_AUTH_ENVIRONMENT,
      useFactory: (env: Environment) => ({
        productName: env.productName,
        authMarketing: env.authMarketing,
        apiUrl: env.billing.restApiUrl,
        additionalApiUrls: [],
        authentication: env.authentication,
        controllerApiUrl: env.controller.restApiUrl,
        termsUrl: env.cookieConsent.termsUrl,
        privacyPolicyUrl: env.cookieConsent.privacyPolicyUrl,
      }),
      deps: [ENVIRONMENT],
    },
    {
      provide: LOGIN_SUCCESS_REDIRECT_TARGET,
      useValue: ['/dashboard'],
    },
    // Provide KeycloakService before HTTP client so interceptor can inject it
    ...(environment.authentication.type === 'keycloak' ? provideKeycloak() : []),
    // Provide HTTP client with auth interceptor (KeycloakService must be available)
    provideHttpClient(
      withInterceptors([getBillingTenantInterceptor(), getAuthInterceptor(), getUsersSessionInvalidationInterceptor()]),
    ),
    // NgRx Store - base store required at root level
    provideStore(),
    // NgRx Store DevTools - only enabled in non-production environments
    ...(environment.production
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
        ...(environment.production
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
    ...(environment.cookieConsent.enabled ? [provideNgcCookieConsent(cookieConfig)] : []),
    provideLocale(),
  ],
};
