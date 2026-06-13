import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  adminMarkPaid,
  adminMarkPaidFailure,
  adminMarkPaidSuccess,
  adminMarkUnpaid,
  adminMarkUnpaidFailure,
  adminMarkUnpaidSuccess,
  adminVoidInvoice,
  adminVoidInvoiceFailure,
  adminVoidInvoiceSuccess,
  billNow,
  billNowFailure,
  billNowSuccess,
  loadAdminAuditLogs,
  loadAdminAuditLogsFailure,
  loadAdminAuditLogsSuccess,
  loadAdminBillingSummary,
  loadAdminBillingSummaryFailure,
  loadAdminBillingSummarySuccess,
  loadAdminOpenOverdue,
  loadAdminOpenOverdueFailure,
  loadAdminOpenOverdueSuccess,
  loadAdminStatisticsByProduct,
  loadAdminStatisticsByProductFailure,
  loadAdminStatisticsByProductSuccess,
  loadAdminStatisticsSummary,
  loadAdminStatisticsSummaryFailure,
  loadAdminStatisticsSummarySuccess,
} from './admin-billing.actions';
import {
  adminMarkPaid$,
  adminMarkUnpaid$,
  adminVoidInvoice$,
  billNow$,
  loadAdminAuditLogs$,
  loadAdminBillingSummary$,
  loadAdminOpenOverdue$,
  loadAdminStatisticsByProduct$,
  loadAdminStatisticsSummary$,
} from './admin-billing.effects';

describe('AdminBillingEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<AdminBillingService>;
  const invoice = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    userId: 'user-1',
    status: 'issued' as const,
    createdAt: '2024-01-01',
    canPay: true,
    canDownload: true,
    canPreview: true,
  };

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
    const result = { queued: true, requestId: 'req-1', userCount: 1 };

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

  it('loadAdminOpenOverdue$ emits success', (done) => {
    service.listOpenOverdue.mockReturnValue(of({ items: [invoice], total: 1, limit: 10, offset: 0 }));
    actions$ = of(loadAdminOpenOverdue({ params: { limit: 10, offset: 0 } }));

    TestBed.runInInjectionContext(() => {
      loadAdminOpenOverdue$().subscribe((action) => {
        expect(action).toEqual(loadAdminOpenOverdueSuccess({ items: [invoice], total: 1, limit: 10, offset: 0 }));
        done();
      });
    });
  });

  it('loadAdminOpenOverdue$ emits failure', (done) => {
    service.listOpenOverdue.mockReturnValue(throwError(() => new Error('list fail')));
    actions$ = of(loadAdminOpenOverdue({ params: {} }));

    TestBed.runInInjectionContext(() => {
      loadAdminOpenOverdue$().subscribe((action) => {
        expect(action).toEqual(loadAdminOpenOverdueFailure({ error: 'list fail' }));
        done();
      });
    });
  });

  it('adminVoidInvoice$ emits success', (done) => {
    service.voidInvoice.mockReturnValue(of({ ...invoice, status: 'voided' }));
    actions$ = of(adminVoidInvoice({ invoiceRefId: 'inv-1' }));

    TestBed.runInInjectionContext(() => {
      adminVoidInvoice$().subscribe((action) => {
        expect(action).toEqual(adminVoidInvoiceSuccess({ invoice: { ...invoice, status: 'voided' } }));
        done();
      });
    });
  });

  it('adminVoidInvoice$ emits failure', (done) => {
    service.voidInvoice.mockReturnValue(throwError(() => new Error('void fail')));
    actions$ = of(adminVoidInvoice({ invoiceRefId: 'inv-1' }));

    TestBed.runInInjectionContext(() => {
      adminVoidInvoice$().subscribe((action) => {
        expect(action).toEqual(adminVoidInvoiceFailure({ error: 'void fail' }));
        done();
      });
    });
  });

  it('adminMarkPaid$ emits success', (done) => {
    service.markPaid.mockReturnValue(of({ ...invoice, status: 'paid' }));
    actions$ = of(adminMarkPaid({ invoiceRefId: 'inv-1', dto: { reason: 'manual' } }));

    TestBed.runInInjectionContext(() => {
      adminMarkPaid$().subscribe((action) => {
        expect(action).toEqual(adminMarkPaidSuccess({ invoice: { ...invoice, status: 'paid' } }));
        done();
      });
    });
  });

  it('adminMarkPaid$ emits failure', (done) => {
    service.markPaid.mockReturnValue(throwError(() => new Error('paid fail')));
    actions$ = of(adminMarkPaid({ invoiceRefId: 'inv-1' }));

    TestBed.runInInjectionContext(() => {
      adminMarkPaid$().subscribe((action) => {
        expect(action).toEqual(adminMarkPaidFailure({ error: 'paid fail' }));
        done();
      });
    });
  });

  it('adminMarkUnpaid$ emits success', (done) => {
    service.markUnpaid.mockReturnValue(of({ ...invoice, status: 'issued' }));
    actions$ = of(adminMarkUnpaid({ invoiceRefId: 'inv-1' }));

    TestBed.runInInjectionContext(() => {
      adminMarkUnpaid$().subscribe((action) => {
        expect(action).toEqual(adminMarkUnpaidSuccess({ invoice: { ...invoice, status: 'issued' } }));
        done();
      });
    });
  });

  it('adminMarkUnpaid$ emits failure', (done) => {
    service.markUnpaid.mockReturnValue(throwError(() => new Error('unpaid fail')));
    actions$ = of(adminMarkUnpaid({ invoiceRefId: 'inv-1' }));

    TestBed.runInInjectionContext(() => {
      adminMarkUnpaid$().subscribe((action) => {
        expect(action).toEqual(adminMarkUnpaidFailure({ error: 'unpaid fail' }));
        done();
      });
    });
  });

  it('loadAdminStatisticsSummary$ emits success', (done) => {
    const summary = {
      series: [],
      totalGross: 100,
      paidCount: 1,
      from: '2024-01-01',
      to: '2024-01-31',
      groupBy: 'day' as const,
    };

    service.getStatisticsSummary.mockReturnValue(of(summary));
    actions$ = of(loadAdminStatisticsSummary({ params: { from: '2024-01-01' } }));

    TestBed.runInInjectionContext(() => {
      loadAdminStatisticsSummary$().subscribe((action) => {
        expect(action).toEqual(loadAdminStatisticsSummarySuccess({ summary }));
        done();
      });
    });
  });

  it('loadAdminStatisticsSummary$ emits failure', (done) => {
    service.getStatisticsSummary.mockReturnValue(throwError(() => new Error('stats fail')));
    actions$ = of(loadAdminStatisticsSummary({ params: {} }));

    TestBed.runInInjectionContext(() => {
      loadAdminStatisticsSummary$().subscribe((action) => {
        expect(action).toEqual(loadAdminStatisticsSummaryFailure({ error: 'stats fail' }));
        done();
      });
    });
  });

  it('loadAdminStatisticsByProduct$ emits success', (done) => {
    const byProduct = {
      items: [],
      totalGross: 0,
      from: '2024-01-01',
      to: '2024-01-31',
    };

    service.getStatisticsByProduct.mockReturnValue(of(byProduct));
    actions$ = of(loadAdminStatisticsByProduct({ params: {} }));

    TestBed.runInInjectionContext(() => {
      loadAdminStatisticsByProduct$().subscribe((action) => {
        expect(action).toEqual(loadAdminStatisticsByProductSuccess({ byProduct }));
        done();
      });
    });
  });

  it('loadAdminStatisticsByProduct$ emits failure', (done) => {
    service.getStatisticsByProduct.mockReturnValue(throwError(() => new Error('product fail')));
    actions$ = of(loadAdminStatisticsByProduct({ params: {} }));

    TestBed.runInInjectionContext(() => {
      loadAdminStatisticsByProduct$().subscribe((action) => {
        expect(action).toEqual(loadAdminStatisticsByProductFailure({ error: 'product fail' }));
        done();
      });
    });
  });

  it('loadAdminAuditLogs$ emits success', (done) => {
    const logs = {
      items: [
        {
          id: 'log-1',
          process: 'invoice.issue',
          level: 'info',
          message: 'Issued',
          context: {},
          createdAt: new Date('2024-01-01'),
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    };

    service.listAuditLogs.mockReturnValue(of(logs));
    actions$ = of(loadAdminAuditLogs({ invoiceRefId: 'inv-1', limit: 20, offset: 0 }));

    TestBed.runInInjectionContext(() => {
      loadAdminAuditLogs$().subscribe((action) => {
        expect(action).toEqual(
          loadAdminAuditLogsSuccess({ invoiceRefId: 'inv-1', items: logs.items, total: logs.total }),
        );
        done();
      });
    });
  });

  it('loadAdminAuditLogs$ emits failure', (done) => {
    service.listAuditLogs.mockReturnValue(throwError(() => new Error('audit fail')));
    actions$ = of(loadAdminAuditLogs({ invoiceRefId: 'inv-1' }));

    TestBed.runInInjectionContext(() => {
      loadAdminAuditLogs$().subscribe((action) => {
        expect(action).toEqual(loadAdminAuditLogsFailure({ error: 'audit fail' }));
        done();
      });
    });
  });
});
