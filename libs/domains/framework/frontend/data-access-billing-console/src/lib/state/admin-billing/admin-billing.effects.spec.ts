import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  billNow,
  billNowFailure,
  billNowSuccess,
  loadAdminBillingSummary,
  loadAdminBillingSummaryFailure,
  loadAdminBillingSummarySuccess,
} from './admin-billing.actions';
import { billNow$, loadAdminBillingSummary$ } from './admin-billing.effects';

describe('AdminBillingEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<AdminBillingService>;

  beforeEach(() => {
    service = {
      getSummary: jest.fn(),
      billNow: jest.fn(),
      listOpenOverdue: jest.fn(),
      voidInvoice: jest.fn(),
      markPaid: jest.fn(),
      markUnpaid: jest.fn(),
      listAuditLogs: jest.fn(),
      getStatisticsSummary: jest.fn(),
      getStatisticsByProduct: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminBillingService, useValue: service }],
    });
  });

  it('loadAdminBillingSummary$ emits success', (done) => {
    const summary = { activeSubscriptionsCount: 1, openOverdueCount: 0, openOverdueTotal: 0, unbilledTotal: 0 };

    service.getSummary.mockReturnValue(of(summary));
    actions$ = of(loadAdminBillingSummary());

    TestBed.runInInjectionContext(() => {
      loadAdminBillingSummary$().subscribe((action) => {
        expect(action).toEqual(loadAdminBillingSummarySuccess({ summary }));
        done();
      });
    });
  });

  it('loadAdminBillingSummary$ emits failure', (done) => {
    service.getSummary.mockReturnValue(throwError(() => new Error('fail')));
    actions$ = of(loadAdminBillingSummary());

    TestBed.runInInjectionContext(() => {
      loadAdminBillingSummary$().subscribe((action) => {
        expect(action).toEqual(loadAdminBillingSummaryFailure({ error: 'fail' }));
        done();
      });
    });
  });

  it('billNow$ emits success', (done) => {
    const result = { usersProcessed: 1, invoicesCreated: 1, usersSkipped: 0, errors: [] };

    service.billNow.mockReturnValue(of(result));
    actions$ = of(billNow({ dto: {} }));

    TestBed.runInInjectionContext(() => {
      billNow$().subscribe((action) => {
        expect(action).toEqual(billNowSuccess({ result }));
        done();
      });
    });
  });

  it('billNow$ emits failure', (done) => {
    service.billNow.mockReturnValue(throwError(() => new Error('bill fail')));
    actions$ = of(billNow({ dto: {} }));

    TestBed.runInInjectionContext(() => {
      billNow$().subscribe((action) => {
        expect(action).toEqual(billNowFailure({ error: 'bill fail' }));
        done();
      });
    });
  });
});
