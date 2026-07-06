import { Route } from '@angular/router';
import { environment } from '@forepath/shared/frontend/util-configuration';

export const appRoutes: Route[] = [
  ...(environment.production
    ? [
        {
          path: 'de',
          loadChildren: () => import('@forepath/marpdown/frontend/feature-editor').then((m) => m.marpdownRoutes),
        },
        {
          path: 'en',
          loadChildren: () => import('@forepath/marpdown/frontend/feature-editor').then((m) => m.marpdownRoutes),
        },
      ]
    : []),
  {
    path: '',
    loadChildren: () => import('@forepath/marpdown/frontend/feature-editor').then((m) => m.marpdownRoutes),
  },
];
