import { Route } from '@angular/router';
import { createSharedContactRoute, createBrandContactDetails } from '@forepath/shared/frontend/feature-landingpage';
import {
  ServicePlansFacade,
  loadCheapestServicePlanOffering$,
  loadServicePlans$,
  loadServicePlansBatch$,
  servicePlansReducer,
} from '@forepath/decabill/frontend/data-access-portal';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { PortalComparisonChargebeeComponent } from './comparison/chargebee/chargebee.component';
import { PortalComparisonHostbillComponent } from './comparison/hostbill/hostbill.component';
import { PortalComparisonPaddleComponent } from './comparison/paddle/paddle.component';
import { PortalComparisonStripeBillingComponent } from './comparison/stripe-billing/stripe-billing.component';
import { PortalComparisonWhmcsComponent } from './comparison/whmcs/whmcs.component';
import { PortalContainerComponent } from './container/container.component';
import { PortalHomeComponent } from './home/home.component';
import { PortalLegalDisclosureComponent } from './legal/disclosure/disclosure.component';
import { PortalLegalPrivacyComponent } from './legal/privacy/privacy.component';
import { PortalLegalTermsComponent } from './legal/terms/terms.component';
import { PortalPricingComponent } from './pricing/pricing.component';

export const portalRoutes: Route[] = [
  {
    path: '',
    component: PortalContainerComponent,
    providers: [
      ServicePlansFacade,
      provideState('servicePlans', servicePlansReducer),
      provideEffects({
        loadServicePlans$,
        loadServicePlansBatch$,
        loadCheapestServicePlanOffering$,
      }),
    ],
    children: [
      {
        path: '',
        component: PortalHomeComponent,
      },
      {
        path: 'billing',
        redirectTo: '',
        pathMatch: 'full',
      },
      {
        path: 'console',
        redirectTo: '',
        pathMatch: 'full',
      },
      {
        path: 'platform',
        redirectTo: '',
        pathMatch: 'full',
      },
      {
        path: 'pricing',
        component: PortalPricingComponent,
      },
      {
        path: 'compare/whmcs',
        component: PortalComparisonWhmcsComponent,
      },
      {
        path: 'compare/hostbill',
        component: PortalComparisonHostbillComponent,
      },
      {
        path: 'compare/stripe-billing',
        component: PortalComparisonStripeBillingComponent,
      },
      {
        path: 'compare/chargebee',
        component: PortalComparisonChargebeeComponent,
      },
      {
        path: 'compare/paddle',
        component: PortalComparisonPaddleComponent,
      },
      {
        path: 'legal/disclosure',
        component: PortalLegalDisclosureComponent,
      },
      {
        path: 'legal/privacy',
        component: PortalLegalPrivacyComponent,
      },
      {
        path: 'legal/terms',
        component: PortalLegalTermsComponent,
      },
      createSharedContactRoute({
        canonicalUrl: 'https://decabill.com/contact',
        heroTheme: 'dark',
        contactDetails: createBrandContactDetails({
          email: 'hi@decabill.com',
          websiteUrl: 'https://decabill.com',
        }),
      }),
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
