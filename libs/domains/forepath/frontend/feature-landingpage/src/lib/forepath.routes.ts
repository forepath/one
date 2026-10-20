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

import { ForepathAboutComponent } from './about/about.component';
import { blogLocaleGuard } from './blog/blog-locale.guard';
import { ForepathBlogComponent } from './blog/blog.component';
import { ForepathBlogPostComponent } from './blog/post/blog-post.component';
import { ForepathConsultingComponent } from './consulting/consulting.component';
import { ForepathContainerComponent } from './container/container.component';
import { ForepathHomeComponent } from './home/home.component';
import { FOREPATH_INDUSTRIES } from './industries/industries';
import { FOREPATH_INDUSTRY_ROUTE_DATA_KEY, ForepathIndustryComponent } from './industries/industry/industry.component';
import { ForepathItSystemsComponent } from './it-systems/it-systems.component';
import {
  FOREPATH_IT_SERVICE_ROUTE_DATA_KEY,
  ForepathItSystemsServiceComponent,
} from './it-systems/service/it-systems-service.component';
import { FOREPATH_IT_SERVICES } from './it-systems/services/it-systems-services';
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
      // One static route per IT domain, so every service page is prerendered.
      ...FOREPATH_IT_SERVICES.map(
        (service): Route => ({
          path: `it-systems/${service.id}`,
          component: ForepathItSystemsServiceComponent,
          data: { [FOREPATH_IT_SERVICE_ROUTE_DATA_KEY]: service.id },
        }),
      ),
      {
        path: 'software-development',
        component: ForepathSoftwareDevelopmentComponent,
      },
      // One static route per industry, so every industry page is prerendered.
      ...FOREPATH_INDUSTRIES.map(
        (industry): Route => ({
          path: `industries/${industry.id}`,
          component: ForepathIndustryComponent,
          data: { [FOREPATH_INDUSTRY_ROUTE_DATA_KEY]: industry.id },
        }),
      ),
      {
        path: 'one',
        component: ForepathOneComponent,
      },
      {
        path: 'about',
        component: ForepathAboutComponent,
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
        contactPerson: 'forepath',
        contactDetails: createBrandContactDetails({
          email: 'hi@forepath.io',
          websiteUrl: 'https://forepath.io',
        }),
      }),
      {
        path: 'blog',
        component: ForepathBlogComponent,
        canActivate: [blogLocaleGuard],
      },
      {
        path: 'blog/:slug',
        component: ForepathBlogPostComponent,
        canActivate: [blogLocaleGuard],
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
