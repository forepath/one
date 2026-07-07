import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  clearPublicWithdrawalError,
  clearPublicWithdrawalSuccessMessage,
  confirmPublicWithdrawal,
  loadPublicWithdrawalAddressee,
  requestPublicWithdrawal,
  verifyPublicWithdrawalCode,
} from './public-withdrawal.actions';
import { PublicWithdrawalFacade } from './public-withdrawal.facade';

describe('PublicWithdrawalFacade', () => {
  let facade: PublicWithdrawalFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn().mockReturnValue(of(null)), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [PublicWithdrawalFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(PublicWithdrawalFacade);
  });

  it('should dispatch loadPublicWithdrawalAddressee', () => {
    facade.loadAddressee();
    expect(store.dispatch).toHaveBeenCalledWith(loadPublicWithdrawalAddressee());
  });

  it('should dispatch requestPublicWithdrawal', () => {
    const dto = {
      subscriptionNumber: 'SUB-000001',
      customerName: 'Jane Doe',
      email: 'jane@example.com',
      orderedOn: '2024-01-01',
    };

    facade.requestWithdrawal(dto);
    expect(store.dispatch).toHaveBeenCalledWith(requestPublicWithdrawal({ dto }));
  });

  it('should dispatch verifyPublicWithdrawalCode', () => {
    const dto = { requestId: 'req-1', code: 'ABC123' };

    facade.verifyCode(dto);
    expect(store.dispatch).toHaveBeenCalledWith(verifyPublicWithdrawalCode({ dto }));
  });

  it('should dispatch confirmPublicWithdrawal', () => {
    const dto = { requestId: 'req-1', acknowledgeWithdrawal: true as const };

    facade.confirmWithdrawal(dto);
    expect(store.dispatch).toHaveBeenCalledWith(confirmPublicWithdrawal({ dto }));
  });

  it('should dispatch clearPublicWithdrawalError', () => {
    facade.clearError();
    expect(store.dispatch).toHaveBeenCalledWith(clearPublicWithdrawalError());
  });

  it('should dispatch clearPublicWithdrawalSuccessMessage', () => {
    facade.clearSuccessMessage();
    expect(store.dispatch).toHaveBeenCalledWith(clearPublicWithdrawalSuccessMessage());
  });
});
