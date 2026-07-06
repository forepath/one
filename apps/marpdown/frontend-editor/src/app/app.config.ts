import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import {
  getAuthInterceptor,
  getUsersSessionInvalidationInterceptor,
} from '@forepath/marpdown/frontend/data-access-editor';
import { Environment, ENVIRONMENT, environment, provideLocale } from '@forepath/shared/frontend/util-configuration';
import { IDENTITY_AUTH_ENVIRONMENT, LOGIN_SUCCESS_REDIRECT_TARGET, provideKeycloak } from '@forepath/identity/frontend';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    {
      provide: IDENTITY_AUTH_ENVIRONMENT,
      useFactory: (env: Environment) => ({
        productName: env.productName,
        authMarketing: env.authMarketing,
        apiUrl: env.marpdown?.restApiUrl ?? '',
        authentication: env.authentication,
        controllerApiUrl: env.marpdown?.restApiUrl ?? '',
        termsUrl: env.cookieConsent.termsUrl,
        privacyPolicyUrl: env.cookieConsent.privacyPolicyUrl,
      }),
      deps: [ENVIRONMENT],
    },
    {
      provide: LOGIN_SUCCESS_REDIRECT_TARGET,
      useValue: ['/presentations'],
    },
    ...(environment.authentication.type === 'keycloak' ? provideKeycloak() : []),
    provideHttpClient(withInterceptors([getAuthInterceptor(), getUsersSessionInvalidationInterceptor()])),
    provideStore(),
    ...(environment.production
      ? []
      : [
          provideStoreDevtools({
            maxAge: 25,
          }),
        ]),
    provideRouter(appRoutes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideLocale(),
  ],
};
