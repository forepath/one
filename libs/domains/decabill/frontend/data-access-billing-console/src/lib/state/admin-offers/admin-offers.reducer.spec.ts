import {
  archiveAdminOfferSuccess,
  createAdminOfferSuccess,
  loadAdminOffersSuccess,
  loadAdminOfferStatisticsSuccess,
  sendAdminOffer,
  sendAdminOfferFailure,
  sendAdminOfferSuccess,
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
    let state = adminOffersReducer(initialAdminOffersState, loadAdminOffersSuccess({ offers: [offer], total: 1 }));

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

  it('tracks the send lifecycle (sending flag, upsert, error)', () => {
    const loaded = adminOffersReducer(
      initialAdminOffersState,
      loadAdminOffersSuccess({ offers: [{ ...offer, status: 'archived', sentAt: null, canSend: true }], total: 1 }),
    );
    const sending = adminOffersReducer(loaded, sendAdminOffer({ id: 'offer-1' }));

    expect(sending.sending).toBe(true);

    const sent = adminOffersReducer(
      sending,
      sendAdminOfferSuccess({
        offer: { ...offer, status: 'archived', sentAt: '2026-11-21T10:00:00Z', canSend: false } as never,
      }),
    );

    expect(sent.sending).toBe(false);
    expect(sent.offers[0]).toEqual(expect.objectContaining({ sentAt: '2026-11-21T10:00:00Z', canSend: false }));

    const failed = adminOffersReducer(sending, sendAdminOfferFailure({ error: 'no billing email' }));

    expect(failed).toEqual(expect.objectContaining({ sending: false, error: 'no billing email' }));
  });
});
