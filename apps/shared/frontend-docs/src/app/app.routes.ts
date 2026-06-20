import { Route } from '@angular/router';
import { docsRoutes } from '@forepath/shared/frontend/feature-docs';

export const appRoutes: Route[] = [
  {
    path: '',
    children: docsRoutes,
  },
];
