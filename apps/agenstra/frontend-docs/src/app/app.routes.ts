import { Route } from '@angular/router';
import { docsRoutes } from '@forepath/agenstra/frontend/feature-docs';

export const appRoutes: Route[] = [
  {
    path: '',
    children: docsRoutes,
  },
];
