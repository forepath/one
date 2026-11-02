import {
  CONTAINER_MANAGER_TAB_ID,
  ContainerManagerFacade,
  LOADWEAVER_CLUSTER_TAB_ID,
} from '@forepath/decabill/frontend/data-access-billing-console';

import { LoadweaverClusterTabComponent } from '../service-detail-page/tabs/loadweaver-cluster/loadweaver-cluster-tab.component';

import {
  collectContributorNgrx,
  collectContributorRoutes,
  collectContributorTabComponents,
} from './contributor-ui.registry';
import { FIRST_PARTY_CONTRIBUTOR_UI_MODULES } from './first-party-contributor-ui.modules';

describe('FIRST_PARTY_CONTRIBUTOR_UI_MODULES', () => {
  it('registers Container Manager tab, NgRx, and empty extra routes/nav', () => {
    const tabs = collectContributorTabComponents(FIRST_PARTY_CONTRIBUTOR_UI_MODULES);
    const ngrx = collectContributorNgrx(FIRST_PARTY_CONTRIBUTOR_UI_MODULES);
    const routes = collectContributorRoutes(FIRST_PARTY_CONTRIBUTOR_UI_MODULES);

    expect(tabs[CONTAINER_MANAGER_TAB_ID]).toBeDefined();
    expect(tabs[LOADWEAVER_CLUSTER_TAB_ID]).toBe(LoadweaverClusterTabComponent);
    expect(ngrx.facades).toContain(ContainerManagerFacade);
    expect(ngrx.states.map((state) => state.name)).toContain('containerManager');
    expect(routes.customer).toEqual([]);
    expect(routes.admin).toEqual([]);
  });

  it('includes empty first-party stack UI modules without extra routes', () => {
    expect(FIRST_PARTY_CONTRIBUTOR_UI_MODULES).toHaveLength(7);
    const routes = collectContributorRoutes(FIRST_PARTY_CONTRIBUTOR_UI_MODULES);
    expect(routes.customer).toEqual([]);
    expect(routes.admin).toEqual([]);
  });
});
