import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { AdminOffersService } from '../../services/admin-offers.service';

import {
  archiveAdminOffer,
  archiveAdminOfferSuccess,
  loadAdminOffers,
  loadAdminOffersSuccess,
  revokeAdminOffer,
  sendAdminOffer,
  sendAdminOfferSuccess,
} from './admin-offers.actions';
import { archiveAdminOffer$, loadAdminOffers$, revokeAdminOffer$, sendAdminOffer$ } from './admin-offers.effects';

describe('adminOffers effects', () => {
  let actions$: Observable<unknown>;
  let service: { list: jest.Mock; archive: jest.Mock; send: jest.Mock; revoke: jest.Mock };

  beforeEach(() => {
    service = { list: jest.fn(), archive: jest.fn(), send: jest.fn(), revoke: jest.fn() };

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
