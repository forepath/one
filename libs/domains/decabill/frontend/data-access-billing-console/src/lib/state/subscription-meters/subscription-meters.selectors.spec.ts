import {
  selectSubscriptionMeterEntries,
  selectSubscriptionMeterSummaries,
  selectSubscriptionMetersCreating,
  selectSubscriptionMetersDeleting,
  selectSubscriptionMetersError,
  selectSubscriptionMetersLoadingAny,
  selectSubscriptionMetersLoadingEntries,
  selectSubscriptionMetersLoadingSummaries,
  selectSubscriptionMetersSubscriptionId,
  selectSubscriptionMetersUpdating,
} from './subscription-meters.selectors';
import { initialSubscriptionMetersState } from './subscription-meters.reducer';

describe('subscriptionMetersSelectors', () => {
  const state = {
    subscriptionMeters: {
      ...initialSubscriptionMetersState,
      subscriptionId: 'sub-1',
      summaries: [{ meterId: 'meter-1' } as never],
      entries: [{ id: 'entry-1' } as never],
      loadingSummaries: true,
      loadingEntries: false,
      creating: false,
      updating: false,
      deleting: false,
      error: 'Failed',
    },
  };

  it('selects subscription meter data', () => {
    expect(selectSubscriptionMetersSubscriptionId(state)).toBe('sub-1');
    expect(selectSubscriptionMeterSummaries(state)).toHaveLength(1);
    expect(selectSubscriptionMeterEntries(state)).toHaveLength(1);
    expect(selectSubscriptionMetersLoadingSummaries(state)).toBe(true);
    expect(selectSubscriptionMetersLoadingEntries(state)).toBe(false);
    expect(selectSubscriptionMetersCreating(state)).toBe(false);
    expect(selectSubscriptionMetersUpdating(state)).toBe(false);
    expect(selectSubscriptionMetersDeleting(state)).toBe(false);
    expect(selectSubscriptionMetersError(state)).toBe('Failed');
    expect(selectSubscriptionMetersLoadingAny(state)).toBe(true);
  });
});
