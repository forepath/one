import {
  CONTAINER_MANAGER_TAB_ID,
  ContainerManagerFacade,
  containerManagerReducer,
  loadContainerManagerContainers$,
  loadContainerManagerLogs$,
  loadContainerManagerNetworks$,
  loadContainerManagerStatsHistory$,
  loadLogsAfterContainers$,
  loadLogsOnSelect$,
  loadStatsHistoryAfterContainers$,
  loadStatsHistoryOnSelect$,
  pollContainerManagerLogs$,
  pollContainerManagerStatsHistory$,
} from '@forepath/decabill/frontend/data-access-billing-console';
import type { ActionReducer } from '@ngrx/store';

import { ContainerManagerTabComponent } from '../service-detail-page/tabs/container-manager/container-manager-tab.component';

import type { ContributorUiModule } from './contributor-ui.types';

export const containerManagerContributorUi: ContributorUiModule = {
  tabComponents: {
    [CONTAINER_MANAGER_TAB_ID]: ContainerManagerTabComponent,
  },
  ngrx: {
    facades: [ContainerManagerFacade],
    states: [{ name: 'containerManager', reducer: containerManagerReducer as ActionReducer<unknown> }],
    effects: {
      loadContainerManagerContainers$,
      loadContainerManagerNetworks$,
      loadStatsHistoryOnSelect$,
      loadStatsHistoryAfterContainers$,
      loadContainerManagerStatsHistory$,
      loadLogsOnSelect$,
      loadLogsAfterContainers$,
      loadContainerManagerLogs$,
      pollContainerManagerLogs$,
      pollContainerManagerStatsHistory$,
    },
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
