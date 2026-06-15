import { Route } from '@angular/router';
import {
  ServicePlansFacade,
  loadCheapestServicePlanOffering$,
  loadServicePlans$,
  loadServicePlansBatch$,
  servicePlansReducer,
} from '@forepath/agenstra/frontend/data-access-portal';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { PortalAgentCtxComponent } from './agentctx/agentctx.component';
import { PortalCloudComponent } from './cloud/cloud.component';
import { PortalComparisonCodeiumWindsurfComponent } from './comparison/codeium-windsurf/codeium-windsurf.component';
import { PortalComparisonCursorComponent } from './comparison/cursor/cursor.component';
import { PortalComparisonDevinComponent } from './comparison/devin/devin.component';
import { PortalComparisonGithubCopilotComponent } from './comparison/github-copilot/github-copilot.component';
import { PortalComparisonOrqAiComponent } from './comparison/orq-ai/orq-ai.component';
import { PortalComparisonPortkeyComponent } from './comparison/portkey/portkey.component';
import { PortalComparisonTabnineEnterpriseComponent } from './comparison/tabnine-enterprise/tabnine-enterprise.component';
import { PortalContainerComponent } from './container/container.component';
import { PortalDesktopComponent } from './desktop/desktop.component';
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
        path: 'agentctx',
        component: PortalAgentCtxComponent,
      },
      {
        path: 'desktop',
        component: PortalDesktopComponent,
      },
      {
        path: 'cloud',
        component: PortalCloudComponent,
      },
      {
        path: 'pricing',
        component: PortalPricingComponent,
      },
      {
        path: 'compare/devin',
        component: PortalComparisonDevinComponent,
      },
      {
        path: 'compare/cursor',
        component: PortalComparisonCursorComponent,
      },
      {
        path: 'compare/github-copilot',
        component: PortalComparisonGithubCopilotComponent,
      },
      {
        path: 'compare/codeium-windsurf',
        component: PortalComparisonCodeiumWindsurfComponent,
      },
      {
        path: 'compare/tabnine-enterprise',
        component: PortalComparisonTabnineEnterpriseComponent,
      },
      {
        path: 'compare/portkey',
        component: PortalComparisonPortkeyComponent,
      },
      {
        path: 'compare/orq-ai',
        component: PortalComparisonOrqAiComponent,
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
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
