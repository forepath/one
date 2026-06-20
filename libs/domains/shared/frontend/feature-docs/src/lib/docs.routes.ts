import { Route } from '@angular/router';

import { DocsLayoutComponent } from './components/docs-layout/docs-layout.component';
import { DocsPageComponent } from './pages/docs-page/docs-page.component';
import { DocsSearchPageComponent } from './pages/docs-search-page/docs-search-page.component';

export const docsRoutes: Route[] = [
  {
    path: '',
    component: DocsLayoutComponent,
    children: [
      {
        path: 'search',
        component: DocsSearchPageComponent,
      },
      {
        path: '',
        redirectTo: 'docs',
        pathMatch: 'full',
      },
      {
        path: '**',
        component: DocsPageComponent,
      },
    ],
  },
];
