import {
  archiveAdminOfferSuccess,
  createAdminOfferSuccess,
  loadAdminOffersSuccess,
  loadAdminOfferStatisticsSuccess,
} from './admin-offers.actions';
import { adminOffersReducer, initialAdminOffersState } from './admin-offers.reducer';

describe('adminOffersReducer', () => {
  const offer = {
    id: 'offer-1',
    userId: 'user-1',
    status: 'draft',
    currency: 'EUR',
    totalGross: 100,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  } as const;

  it('stores loaded offers and statistics', () => {
    let state = adminOffersReducer(initialAdminOffersState, loadAdminOffersSuccess({ offers: [offer] }));

    state = adminOffersReducer(
      state,
      loadAdminOfferStatisticsSuccess({
        statistics: {
          draftCount: 1,
          pendingCount: 0,
          pendingGross: 0,
          acceptedCount: 0,
          acceptedGross: 0,
          declinedCount: 0,
          expiredCount: 0,
          revokedCount: 0,
          series: [],
          from: '2024-01-01',
          to: '2024-01-31',
          groupBy: 'day',
        },
      }),
    );

    expect(state.offers).toEqual([offer]);
    expect(state.statistics?.draftCount).toBe(1);
  });

  it('tracks create and archive lifecycle', () => {
    const created = adminOffersReducer(initialAdminOffersState, createAdminOfferSuccess({ offer: offer as never }));
    expect(created.offers[0]).toEqual(offer);

    const archived = adminOffersReducer(
      created,
      archiveAdminOfferSuccess({ offer: { ...offer, status: 'archived' } as never }),
    );
    expect(archived.offers[0].status).toBe('archived');
  });
});
