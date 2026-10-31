import { LOADWEAVER_CLUSTER_TAB_ID } from '@forepath/decabill/frontend/data-access-billing-console';

import { LoadweaverClusterTabComponent } from '../service-detail-page/tabs/loadweaver-cluster/loadweaver-cluster-tab.component';
import type { ContributorUiModule } from './contributor-ui.types';

/** Compile-time UI of the `loadweaver` integrated stack: the "Cluster" service-detail tab. */
export const loadweaverContributorUi: ContributorUiModule = {
  tabComponents: {
    [LOADWEAVER_CLUSTER_TAB_ID]: LoadweaverClusterTabComponent,
  },
  routes: {
    customer: [],
    admin: [],
  },
  navItems: {
    customer: [],
    admin: [],
  },
};
