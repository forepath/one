import type { SubscriptionItemDetailResponse } from '../../types/billing.types';

import { initialServiceDetailState } from './service-detail.reducer';
import {
  selectServiceDetail,
  selectServiceDetailDisplayLabel,
  selectServiceDetailLoadingAny,
  selectServiceDetailMetersFromSocket,
} from './service-detail.selectors';

describe('serviceDetailSelectors', () => {
  const detail: SubscriptionItemDetailResponse = {
    id: 'item-1',
    subscriptionId: 'sub-1',
    serviceTypeId: 'st-1',
    serviceTypeName: 'Standard',
    displayName: 'Production',
    provisioningStatus: 'active',
  };
  const state = {
    serviceDetail: {
      ...initialServiceDetailState,
      subscriptionId: 'sub-1',
      itemId: 'item-1',
      detail,
      loadingDetail: false,
      loadingHistory: true,
      metersFromSocket: [],
    },
  };

  it('selects detail and loading state', () => {
    expect(selectServiceDetail(state)).toEqual(detail);
    expect(selectServiceDetailLoadingAny(state)).toBe(true);
    expect(selectServiceDetailMetersFromSocket(state)).toEqual([]);
  });

  it('resolves display label from detail', () => {
    expect(selectServiceDetailDisplayLabel(state)).toBe('Production');
    expect(
      selectServiceDetailDisplayLabel({
        serviceDetail: { ...initialServiceDetailState, detail: null },
      }),
    ).toBe('');
  });
});
