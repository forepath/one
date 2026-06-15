import { ViewportScroller } from '@angular/common';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling, withRouterConfig } from '@angular/router';
import { environment, provideLocale } from '@forepath/shared/frontend/util-configuration';
import { cookieConfig } from '@forepath/shared/frontend/util-cookie-consent';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideNgcCookieConsent } from 'ngx-cookieconsent';

import { ViewportScrollerOffset } from './viewport-scroller-offset.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideStore(),
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
          loadChildren: () => import('@forepath/forepath/frontend/feature-forepath').then((app) => app.forepathRoutes),
        },
      ],
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    { provide: ViewportScroller, useClass: ViewportScrollerOffset },
    provideHttpClient(withFetch()),
    provideNgcCookieConsent(cookieConfig),
    provideLocale(),
  ],
};
