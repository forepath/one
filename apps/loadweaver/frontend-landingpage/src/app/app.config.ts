import { ViewportScroller } from '@angular/common';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling, withRouterConfig } from '@angular/router';
import { environment, provideLocale } from '@forepath/loadweaver/frontend/util-configuration';
import { createCookieConsentConfig } from '@forepath/shared/frontend/util-cookie-consent';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

import { ViewportScrollerOffset } from './viewport-scroller-offset.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // NgRx Store - base store required at root level (the shared contact route adds its feature state)
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
            import('@forepath/loadweaver/frontend/feature-landingpage').then((app) => app.portalRoutes),
        },
      ],
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    // Custom ViewportScroller with 80px offset for fixed navbar
    { provide: ViewportScroller, useClass: ViewportScrollerOffset },
    provideHttpClient(withFetch()),
    provideNgcCookieConsent(createCookieConsentConfig(environment)),
    provideLocale(),
  ],
};
