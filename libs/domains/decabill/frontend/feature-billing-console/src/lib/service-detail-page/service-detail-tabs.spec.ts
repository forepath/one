import { CONTAINER_MANAGER_TAB_ID } from '@forepath/decabill/frontend/data-access-billing-console';

import { collectContributorTabComponents } from '../contributors/contributor-ui.registry';
import { FIRST_PARTY_CONTRIBUTOR_UI_MODULES } from '../contributors/first-party-contributor-ui.modules';

import { SERVICE_DETAIL_TAB_REGISTRY } from './service-detail-addon-tab.registry';
import { DETAILS_TAB_ID, resolveServiceDetailTabLabel } from './service-detail-tabs';

describe('service detail contributor UI host merge', () => {
  it('registers Container Manager from first-party contributor modules', () => {
    expect(SERVICE_DETAIL_TAB_REGISTRY[CONTAINER_MANAGER_TAB_ID]).toBeDefined();
    expect(collectContributorTabComponents(FIRST_PARTY_CONTRIBUTOR_UI_MODULES)[CONTAINER_MANAGER_TAB_ID]).toBe(
      SERVICE_DETAIL_TAB_REGISTRY[CONTAINER_MANAGER_TAB_ID],
    );
  });

  it('uses i18n only for the details tab and API labels for contributors', () => {
    expect(resolveServiceDetailTabLabel({ id: DETAILS_TAB_ID, label: 'Details from API' }, 'Details')).toBe('Details');
    expect(resolveServiceDetailTabLabel({ id: CONTAINER_MANAGER_TAB_ID, label: 'Container Manager' }, 'Details')).toBe(
      'Container Manager',
    );
    expect(resolveServiceDetailTabLabel({ id: 'acme-ops', label: 'Acme Ops' }, 'Details')).toBe('Acme Ops');
  });
});
