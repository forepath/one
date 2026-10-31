import { Route } from '@angular/router';
import { createBrandContactDetails, createSharedContactRoute } from '@forepath/shared/frontend/feature-landingpage';

import { PortalAppsComponent } from './apps/apps.component';
import { PortalCloudComponent } from './cloud/cloud.component';
import { PortalComparisonComponent } from './comparison/shared/layout/comparison-layout.component';
import { PORTAL_COMPARISON_NAV_ITEMS } from './comparison/shared/misc/comparison-nav.items';
import { COMPARISON_SLUG_DATA_KEY } from './comparison/shared/misc/comparison-page.model';
import { PortalContainerComponent } from './container/container.component';
import { PortalHomeComponent } from './home/home.component';
import { PortalHowItWorksComponent } from './how-it-works/how-it-works.component';
import { PortalLegalDisclosureComponent } from './legal/disclosure/disclosure.component';
import { PortalLegalPrivacyComponent } from './legal/privacy/privacy.component';
import { PortalLegalTermsComponent } from './legal/terms/terms.component';
import { PortalPricingComponent } from './pricing/pricing.component';
import { PortalRemoteAccessComponent } from './remote-access/remote-access.component';

export const portalRoutes: Route[] = [
  {
    path: '',
    component: PortalContainerComponent,
    children: [
      { path: '', component: PortalHomeComponent },
      { path: 'how-it-works', component: PortalHowItWorksComponent },
      { path: 'apps', component: PortalAppsComponent },
      { path: 'remote-access', component: PortalRemoteAccessComponent },
      { path: 'cloud', component: PortalCloudComponent },
      { path: 'pricing', component: PortalPricingComponent },
      ...PORTAL_COMPARISON_NAV_ITEMS.map(
        (item): Route => ({
          path: `compare/${item.slug}`,
          component: PortalComparisonComponent,
          data: { [COMPARISON_SLUG_DATA_KEY]: item.slug },
        }),
      ),
      { path: 'legal/disclosure', component: PortalLegalDisclosureComponent },
      { path: 'legal/privacy', component: PortalLegalPrivacyComponent },
      { path: 'legal/terms', component: PortalLegalTermsComponent },
      createSharedContactRoute({
        canonicalUrl: 'https://loadweaver.com/contact',
        heroTheme: 'dark',
        contactPerson: 'loadweaver',
        contactDetails: createBrandContactDetails({
          email: 'hi@loadweaver.com',
          websiteUrl: 'https://loadweaver.com',
        }),
      }),
      { path: '**', redirectTo: '' },
    ],
  },
];
