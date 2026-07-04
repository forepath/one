import { Route } from '@angular/router';
import {
  FOREPATH_LOCAL_LLM_WORKER_FACTORY,
  ForepathLocalLlmService,
  ForepathLlmMemoryProfileService,
  ProjectEstimatorFacade,
  checkDeviceCapability$,
  changeMemoryProfile$,
  estimateProject$,
  initializeEstimator$,
  preloadModel$,
  preloadModelAfterCapabilityCheck$,
  projectEstimatorReducer,
  reloadLocalModelAfterStartOver$,
  requestGpuAccess$,
} from '@forepath/forepath/frontend/data-access-project-estimator';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { createForepathLocalLlmWorker } from './workers/create-forepath-local-llm-worker';

import { createSharedContactRoute, createBrandContactDetails } from '@forepath/shared/frontend/feature-landingpage';

import { ForepathConsultingComponent } from './consulting/consulting.component';
import { ForepathContainerComponent } from './container/container.component';
import { ForepathHomeComponent } from './home/home.component';
import { ForepathItSystemsComponent } from './it-systems/it-systems.component';
import { ForepathLegalDisclosureComponent } from './legal/disclosure/disclosure.component';
import { ForepathLegalPrivacyComponent } from './legal/privacy/privacy.component';
import { ForepathLegalTermsComponent } from './legal/terms/terms.component';
import { ForepathOneComponent } from './one/one.component';
import { ForepathProjectEstimateComponent } from './pricing/estimate/project-estimate.component';
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
        path: 'pricing/estimate',
        component: ForepathProjectEstimateComponent,
        providers: [
          ProjectEstimatorFacade,
          ForepathLlmMemoryProfileService,
          ForepathLocalLlmService,
          {
            provide: FOREPATH_LOCAL_LLM_WORKER_FACTORY,
            useValue: createForepathLocalLlmWorker,
          },
          provideState('projectEstimator', projectEstimatorReducer),
          provideEffects({
            initializeEstimator$,
            requestGpuAccess$,
            checkDeviceCapability$,
            preloadModelAfterCapabilityCheck$,
            preloadModel$,
            estimateProject$,
            changeMemoryProfile$,
            reloadLocalModelAfterStartOver$,
          }),
        ],
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
      createSharedContactRoute({
        canonicalUrl: 'https://forepath.io/contact',
        heroTheme: 'forepath',
        contactDetails: createBrandContactDetails({
          email: 'hi@forepath.io',
          websiteUrl: 'https://forepath.io',
        }),
      }),
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
