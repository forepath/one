import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { AdminOffersService } from '../../services/admin-offers.service';

import {
  acceptAdminOffer,
  acceptAdminOfferFailure,
  acceptAdminOfferSuccess,
  archiveAdminOffer,
  declineAdminOffer,
  declineAdminOfferSuccess,
  archiveAdminOfferSuccess,
  loadAdminOffers,
  loadAdminOffersSuccess,
  revokeAdminOffer,
  sendAdminOffer,
  sendAdminOfferSuccess,
} from './admin-offers.actions';
import {
  acceptAdminOffer$,
  archiveAdminOffer$,
  declineAdminOffer$,
  loadAdminOffers$,
  revokeAdminOffer$,
  sendAdminOffer$,
} from './admin-offers.effects';

describe('adminOffers effects', () => {
  let actions$: Observable<unknown>;
  let service: {
    list: jest.Mock;
    archive: jest.Mock;
    send: jest.Mock;
    revoke: jest.Mock;
    accept: jest.Mock;
    decline: jest.Mock;
  };

  beforeEach(() => {
    service = {
      list: jest.fn(),
      archive: jest.fn(),
      send: jest.fn(),
      revoke: jest.fn(),
      accept: jest.fn(),
      decline: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminOffersService, useValue: service }],
    });
  });

  it('loads one page of admin offers with the total (replace-page)', (done) => {
    service.list.mockReturnValue(of({ items: [{ id: 'offer-1' }], total: 26, limit: 25, offset: 25 }));
    actions$ = of(loadAdminOffers({ page: 2 }));

    TestBed.runInInjectionContext(() => {
      loadAdminOffers$(actions$, service as never).subscribe((action) => {
        expect(action).toEqual(loadAdminOffersSuccess({ offers: [{ id: 'offer-1' }] as never, total: 26 }));
        expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 25 }));
        done();
      });
    });
  });

  it('archives with the notification choice and sends through the admin endpoints', (done) => {
    service.archive.mockReturnValue(of({ id: 'offer-1' }));
    service.send.mockReturnValue(of({ id: 'offer-1', sentAt: '2026-11-21T10:00:00Z' }));
    service.revoke.mockReturnValue(of({ id: 'offer-1' }));

    TestBed.runInInjectionContext(() => {
      archiveAdminOffer$(
        of(archiveAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false } })),
        service as never,
      ).subscribe((action) => {
        expect(action).toEqual(archiveAdminOfferSuccess({ offer: { id: 'offer-1' } as never }));
        expect(service.archive).toHaveBeenCalledWith('offer-1', { notifyCustomer: false });
      });
      revokeAdminOffer$(
        of(revokeAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false } })),
        service as never,
      ).subscribe(() => expect(service.revoke).toHaveBeenCalledWith('offer-1', { notifyCustomer: false }));
      sendAdminOffer$(of(sendAdminOffer({ id: 'offer-1' })), service as never).subscribe((action) => {
        expect(action).toEqual(
          sendAdminOfferSuccess({ offer: { id: 'offer-1', sentAt: '2026-11-21T10:00:00Z' } as never }),
        );
        expect(service.send).toHaveBeenCalledWith('offer-1');
        done();
      });
    });
  });

  it('records accept / decline through the admin endpoints and maps accept errors', (done) => {
    service.accept.mockReturnValueOnce(of({ id: 'offer-1', status: 'accepted' }));
    service.decline.mockReturnValue(of({ id: 'offer-1', status: 'declined' }));

    TestBed.runInInjectionContext(() => {
      acceptAdminOffer$(
        of(acceptAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false, notifyInvoices: true } })),
        service as never,
      ).subscribe((action) => {
        expect(action).toEqual(acceptAdminOfferSuccess({ offer: { id: 'offer-1', status: 'accepted' } as never }));
        expect(service.accept).toHaveBeenCalledWith('offer-1', { notifyCustomer: false, notifyInvoices: true });
      });
      declineAdminOffer$(
        of(declineAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false } })),
        service as never,
      ).subscribe((action) => {
        expect(action).toEqual(declineAdminOfferSuccess({ offer: { id: 'offer-1', status: 'declined' } as never }));
        expect(service.decline).toHaveBeenCalledWith('offer-1', { notifyCustomer: false });
      });

      service.accept.mockReturnValueOnce(throwError(() => new Error('Offer has expired')));
      acceptAdminOffer$(of(acceptAdminOffer({ id: 'offer-1' })), service as never).subscribe((action) => {
        expect(action).toEqual(acceptAdminOfferFailure({ error: expect.any(String) }));
        done();
      });
    });
  });

  it('maps admin offer load errors', (done) => {
    service.list.mockReturnValue(throwError(() => new Error('load failed')));
    actions$ = of(loadAdminOffers({}));

    TestBed.runInInjectionContext(() => {
      loadAdminOffers$(actions$, service as never).subscribe((action) => {
        expect(action.type).toBe('[AdminOffers] Load Offers Failure');
        done();
      });
    });
  });
});
