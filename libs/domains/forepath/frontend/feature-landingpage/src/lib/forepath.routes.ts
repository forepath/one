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

import {
  CONTENT_REPORT_FEATURE_KEY,
  ContentReportFacade,
  submitContentReport$,
  contentReportReducer,
  VULNERABILITY_REPORT_FEATURE_KEY,
  VulnerabilityReportFacade,
  submitVulnerabilityReport$,
  vulnerabilityReportReducer,
} from '@forepath/shared/frontend/data-access-communication';
import { createSharedContactRoute, createBrandContactDetails } from '@forepath/shared/frontend/feature-landingpage';

import { ForepathBlogComponent } from './blog/blog.component';
import { ForepathBlogPostComponent } from './blog/post/blog-post.component';
import { ForepathConsultingComponent } from './consulting/consulting.component';
import { ForepathContainerComponent } from './container/container.component';
import { ForepathHomeComponent } from './home/home.component';
import { ForepathItSystemsComponent } from './it-systems/it-systems.component';
import { ForepathLegalContentReportComponent } from './legal/content-report/content-report.component';
import { ForepathLegalDisclosureComponent } from './legal/disclosure/disclosure.component';
import { ForepathLegalPrivacyComponent } from './legal/privacy/privacy.component';
import { ForepathLegalTermsComponent } from './legal/terms/terms.component';
import { ForepathLegalVulnerabilityDisclosureComponent } from './legal/vulnerability-disclosure/vulnerability-disclosure.component';
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
      {
        path: 'legal/vulnerability-disclosure',
        component: ForepathLegalVulnerabilityDisclosureComponent,
        providers: [
          VulnerabilityReportFacade,
          provideState(VULNERABILITY_REPORT_FEATURE_KEY, vulnerabilityReportReducer),
          provideEffects({ submitVulnerabilityReport$ }),
        ],
      },
      {
        path: 'legal/content-report',
        component: ForepathLegalContentReportComponent,
        providers: [
          ContentReportFacade,
          provideState(CONTENT_REPORT_FEATURE_KEY, contentReportReducer),
          provideEffects({ submitContentReport$ }),
        ],
      },
      createSharedContactRoute({
        canonicalUrl: 'https://forepath.io/contact',
        heroTheme: 'dark',
        contactDetails: createBrandContactDetails({
          email: 'hi@forepath.io',
          websiteUrl: 'https://forepath.io',
        }),
      }),
      {
        path: 'blog',
        component: ForepathBlogComponent,
      },
      {
        path: 'blog/:slug',
        component: ForepathBlogPostComponent,
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
