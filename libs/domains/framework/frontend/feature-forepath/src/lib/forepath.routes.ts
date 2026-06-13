import { Route } from '@angular/router';

import { ForepathConsultingComponent } from './consulting/consulting.component';
import { ForepathContainerComponent } from './container/container.component';
import { ForepathHomeComponent } from './home/home.component';
import { ForepathItSystemsComponent } from './it-systems/it-systems.component';
import { ForepathLegalDisclosureComponent } from './legal/disclosure/disclosure.component';
import { ForepathLegalPrivacyComponent } from './legal/privacy/privacy.component';
import { ForepathLegalTermsComponent } from './legal/terms/terms.component';
import { ForepathOneComponent } from './one/one.component';
import { ForepathPricingComponent } from './pricing/pricing.component';
import { ForepathSoftwareDevelopmentComponent } from './software-development/software-development.component';

export const forepathRoutes: Route[] = [
  {
    path: '',
    component: ForepathContainerComponent,
    children: [
      {
        path: '',
        component: ForepathHomeComponent,
      },
      {
        path: 'consulting',
        component: ForepathConsultingComponent,
      },
      {
        path: 'it-systems',
        component: ForepathItSystemsComponent,
      },
      {
        path: 'software-development',
        component: ForepathSoftwareDevelopmentComponent,
      },
      {
        path: 'one',
        component: ForepathOneComponent,
      },
      {
        path: 'pricing',
        component: ForepathPricingComponent,
      },
      {
        path: 'legal/disclosure',
        component: ForepathLegalDisclosureComponent,
      },
      {
        path: 'legal/privacy',
        component: ForepathLegalPrivacyComponent,
      },
      {
        path: 'legal/terms',
        component: ForepathLegalTermsComponent,
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
