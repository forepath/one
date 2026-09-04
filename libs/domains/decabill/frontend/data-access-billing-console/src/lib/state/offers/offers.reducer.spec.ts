import {
  acceptOfferSuccess,
  loadHistoryOffersSuccess,
  loadOffersSummarySuccess,
  loadPendingOffersSuccess,
} from './offers.actions';
import { initialOffersState, offersReducer } from './offers.reducer';

describe('offersReducer', () => {
  const offer = {
    id: 'offer-1',
    status: 'archived',
    currency: 'EUR',
    totalGross: 100,
  } as const;

  it('stores summary and lane lists', () => {
    let state = offersReducer(
      initialOffersState,
      loadOffersSummarySuccess({
        summary: {
          pendingCount: 1,
          actionRequiredCount: 1,
          acceptedCount: 2,
          historyCount: 3,
        },
      }),
    );

    state = offersReducer(state, loadPendingOffersSuccess({ offers: [offer] }));
    state = offersReducer(state, loadHistoryOffersSuccess({ offers: [] }));

    expect(state.summary?.pendingCount).toBe(1);
    expect(state.pendingList).toEqual([offer]);
    expect(state.historyList).toEqual([]);
  });

  it('stores accepted offer detail', () => {
    const detail = { ...offer, subtotalNet: 84, taxTotal: 16, lineItems: [], billToOpenPositions: false };

    const state = offersReducer(initialOffersState, acceptOfferSuccess({ offer: detail as never }));

    expect(state.offerDetails['offer-1']).toEqual(detail);
    expect(state.respondingOfferId).toBeNull();
  });
});
