import { ViewportScroller } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling, withRouterConfig } from '@angular/router';
import { getBillingTenantInterceptor } from '@forepath/decabill/frontend/data-access-billing-console';
import { environment, provideLocale } from '@forepath/decabill/frontend/util-configuration';
import { createCookieConsentConfig } from '@forepath/shared/frontend/util-cookie-consent';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

import { ViewportScrollerOffset } from './viewport-scroller-offset.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideStore(),
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
          loadChildren: () => import('@forepath/decabill/frontend/feature-landingpage').then((app) => app.portalRoutes),
        },
      ],
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    { provide: ViewportScroller, useClass: ViewportScrollerOffset },
    provideHttpClient(withFetch(), withInterceptors([getBillingTenantInterceptor()])),
    provideNgcCookieConsent(createCookieConsentConfig(environment)),
    provideLocale(),
  ],
};
