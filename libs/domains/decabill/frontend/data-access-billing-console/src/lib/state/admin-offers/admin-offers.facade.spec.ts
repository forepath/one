import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';

import {
  acceptAdminOffer,
  archiveAdminOffer,
  declineAdminOffer,
  loadAdminOffers,
  revokeAdminOffer,
  sendAdminOffer,
  markAdminOfferSent,
} from './admin-offers.actions';
import { AdminOffersFacade } from './admin-offers.facade';

describe('AdminOffersFacade', () => {
  let facade: AdminOffersFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [AdminOffersFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(AdminOffersFacade);
  });

  it('dispatches loadOffers', () => {
    facade.loadOffers({ search: 'abc' });
    expect(store.dispatch).toHaveBeenCalledWith(loadAdminOffers({ search: 'abc', userId: undefined }));
  });

  it('dispatches archiveOffer', () => {
    facade.archiveOffer('offer-1');
    expect(store.dispatch).toHaveBeenCalledWith(archiveAdminOffer({ id: 'offer-1' }));
  });

  it('dispatches archive / revoke with the notification choice, and send', () => {
    facade.archiveOffer('offer-1', { notifyCustomer: false, notifyOnExpiry: false });
    facade.sendOffer('offer-1');
    facade.revokeOffer('offer-1', { notifyCustomer: false });

    expect(store.dispatch).toHaveBeenCalledWith(
      archiveAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false, notifyOnExpiry: false } }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(sendAdminOffer({ id: 'offer-1', channel: 'email' }));
    expect(store.dispatch).toHaveBeenCalledWith(revokeAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false } }));
  });

  it('dispatches letter sends, archive-then-letter and mark-sent', () => {
    facade.sendOffer('offer-1', 'letter');
    facade.archiveOffer('offer-1', { notifyOnExpiry: true }, true);
    facade.markOfferSent('offer-1', { sentAt: '2026-11-20' });

    expect(store.dispatch).toHaveBeenCalledWith(sendAdminOffer({ id: 'offer-1', channel: 'letter' }));
    expect(store.dispatch).toHaveBeenCalledWith(
      archiveAdminOffer({ id: 'offer-1', dto: { notifyOnExpiry: true }, sendLetter: true }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(markAdminOfferSent({ id: 'offer-1', dto: { sentAt: '2026-11-20' } }));
  });

  it('dispatches accept / decline with the notification choice', () => {
    facade.acceptOffer('offer-1', { notifyCustomer: false, notifyInvoices: false });
    facade.declineOffer('offer-1', { notifyCustomer: true });

    expect(store.dispatch).toHaveBeenCalledWith(
      acceptAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false, notifyInvoices: false } }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(declineAdminOffer({ id: 'offer-1', dto: { notifyCustomer: true } }));
  });
});
