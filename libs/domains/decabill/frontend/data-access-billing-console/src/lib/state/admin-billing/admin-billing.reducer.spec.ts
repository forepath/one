import {
  adminMarkPaid,
  adminMarkPaidFailure,
  adminMarkPaidSuccess,
  adminMarkUnpaidSuccess,
  adminVoidInvoice,
  adminVoidInvoiceFailure,
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
  loadAdminStatisticsByCountry,
  loadAdminStatisticsByCountryFailure,
  loadAdminStatisticsByCountrySuccess,
  loadAdminStatisticsByProduct,
  loadAdminStatisticsByProductFailure,
  loadAdminStatisticsByProductSuccess,
  loadAdminStatisticsSummary,
  loadAdminStatisticsSummaryFailure,
  loadAdminStatisticsSummarySuccess,
} from './admin-billing.actions';
import { adminBillingReducer, initialAdminBillingState } from './admin-billing.reducer';

const issuedInvoice = {
  id: 'inv-1',
  subscriptionId: 'sub-1',
  userId: 'user-1',
  status: 'issued' as const,
  createdAt: '2024-01-01',
  canPay: true,
  canDownload: true,
  canPreview: true,
};

describe('adminBillingReducer', () => {
  it('sets summary loading on loadAdminBillingSummary', () => {
    const state = adminBillingReducer(initialAdminBillingState, loadAdminBillingSummary());

    expect(state.summaryLoading).toBe(true);
    expect(state.summaryError).toBeNull();
  });

  it('stores summary on success', () => {
    const summary = {
      activeSubscriptionsCount: 2,
      openOverdueCount: 1,
      openOverdueTotal: 10,
      unbilledTotal: 5,
    };
    const state = adminBillingReducer(initialAdminBillingState, loadAdminBillingSummarySuccess({ summary }));

    expect(state.summary).toEqual(summary);
    expect(state.summaryLoading).toBe(false);
  });

  it('stores summary error on failure', () => {
    const state = adminBillingReducer(initialAdminBillingState, loadAdminBillingSummaryFailure({ error: 'fail' }));

    expect(state.summaryLoading).toBe(false);
    expect(state.summaryError).toBe('fail');
  });

  it('sets bill-now loading on billNow', () => {
    const state = adminBillingReducer(initialAdminBillingState, billNow({ dto: {} }));

    expect(state.billNowLoading).toBe(true);
    expect(state.billNowError).toBeNull();
    expect(state.billNowResult).toBeNull();
  });

  it('stores bill-now result', () => {
    const result = { queued: true, requestId: 'req-1', userCount: 1 };
    const state = adminBillingReducer(initialAdminBillingState, billNowSuccess({ result }));

    expect(state.billNowResult).toEqual(result);
    expect(state.billNowLoading).toBe(false);
  });

  it('stores bill-now error', () => {
    const state = adminBillingReducer(initialAdminBillingState, billNowFailure({ error: 'bill fail' }));

    expect(state.billNowError).toBe('bill fail');
    expect(state.billNowLoading).toBe(false);
  });

  it('stores open overdue list on success', () => {
    const state = adminBillingReducer(
      initialAdminBillingState,
      loadAdminOpenOverdueSuccess({
        items: [issuedInvoice],
        total: 1,
        limit: 10,
        offset: 0,
      }),
    );

    expect(state.openOverdueItems).toEqual([issuedInvoice]);
    expect(state.openOverdueTotal).toBe(1);
    expect(state.openOverdueLoading).toBe(false);
  });

  it('stores open overdue error on failure', () => {
    const loading = adminBillingReducer(initialAdminBillingState, loadAdminOpenOverdue());
    const state = adminBillingReducer(loading, loadAdminOpenOverdueFailure({ error: 'list fail' }));

    expect(state.openOverdueLoading).toBe(false);
    expect(state.openOverdueError).toBe('list fail');
  });

  it('removes paid invoice from open overdue list', () => {
    const withItems = adminBillingReducer(
      initialAdminBillingState,
      loadAdminOpenOverdueSuccess({
        items: [issuedInvoice],
        total: 1,
        limit: 10,
        offset: 0,
      }),
    );
    const next = adminBillingReducer(
      withItems,
      adminMarkPaidSuccess({
        invoice: { ...issuedInvoice, status: 'paid', canPay: false },
      }),
    );

    expect(next.openOverdueItems).toHaveLength(0);
  });

  it('updates existing open overdue invoice on success', () => {
    const withItems = adminBillingReducer(
      initialAdminBillingState,
      loadAdminOpenOverdueSuccess({
        items: [issuedInvoice],
        total: 1,
        limit: 10,
        offset: 0,
      }),
    );
    const updated = { ...issuedInvoice, balanceDue: 5, status: 'partially_paid' as const };
    const next = adminBillingReducer(withItems, adminMarkUnpaidSuccess({ invoice: updated }));

    expect(next.openOverdueItems).toEqual([updated]);
    expect(next.actionLoading).toBe(false);
  });

  it('sets action loading and clears action error on admin actions', () => {
    const withError = adminBillingReducer(initialAdminBillingState, adminVoidInvoiceFailure({ error: 'old error' }));
    const state = adminBillingReducer(withError, adminVoidInvoice({ invoiceRefId: 'inv-1' }));

    expect(state.actionLoading).toBe(true);
    expect(state.actionError).toBeNull();
  });

  it('stores action error on adminVoidInvoiceFailure', () => {
    const loading = adminBillingReducer(initialAdminBillingState, adminVoidInvoice({ invoiceRefId: 'inv-1' }));
    const state = adminBillingReducer(loading, adminVoidInvoiceFailure({ error: 'void fail' }));

    expect(state.actionLoading).toBe(false);
    expect(state.actionError).toBe('void fail');
  });

  it('stores action error on adminMarkPaidFailure', () => {
    const loading = adminBillingReducer(initialAdminBillingState, adminMarkPaid({ invoiceRefId: 'inv-1' }));
    const state = adminBillingReducer(loading, adminMarkPaidFailure({ error: 'paid fail' }));

    expect(state.actionError).toBe('paid fail');
  });

  it('stores statistics summary on success', () => {
    const summary = {
      series: [],
      totalGross: 100,
      paidCount: 2,
      from: '2024-01-01',
      to: '2024-01-31',
      groupBy: 'day' as const,
    };
    const loading = adminBillingReducer(initialAdminBillingState, loadAdminStatisticsSummary({ params: {} }));
    const state = adminBillingReducer(loading, loadAdminStatisticsSummarySuccess({ summary }));

    expect(state.statisticsSummary).toEqual(summary);
    expect(state.statisticsSummaryLoading).toBe(false);
  });

  it('stores statistics error on summary failure', () => {
    const state = adminBillingReducer(
      initialAdminBillingState,
      loadAdminStatisticsSummaryFailure({ error: 'stats fail' }),
    );

    expect(state.statisticsError).toBe('stats fail');
    expect(state.statisticsSummaryLoading).toBe(false);
  });

  it('stores statistics by product on success', () => {
    const byProduct = {
      items: [{ planId: 'plan-1', planName: 'Basic', totalGross: 50 }],
      totalGross: 50,
      from: '2024-01-01',
      to: '2024-01-31',
    };
    const loading = adminBillingReducer(initialAdminBillingState, loadAdminStatisticsByProduct({ params: {} }));
    const state = adminBillingReducer(loading, loadAdminStatisticsByProductSuccess({ byProduct }));

    expect(state.statisticsByProduct).toEqual(byProduct);
    expect(state.statisticsByProductLoading).toBe(false);
  });

  it('stores statistics error on by-product failure', () => {
    const state = adminBillingReducer(
      initialAdminBillingState,
      loadAdminStatisticsByProductFailure({ error: 'product fail' }),
    );

    expect(state.statisticsError).toBe('product fail');
    expect(state.statisticsByProductLoading).toBe(false);
  });

  it('stores statistics by country on success', () => {
    const byCountry = {
      items: [{ countryCode: 'DE', countryName: 'Germany', totalGross: 50 }],
      totalGross: 50,
      from: '2024-01-01',
      to: '2024-01-31',
    };
    const loading = adminBillingReducer(initialAdminBillingState, loadAdminStatisticsByCountry({ params: {} }));
    const state = adminBillingReducer(loading, loadAdminStatisticsByCountrySuccess({ byCountry }));

    expect(state.statisticsByCountry).toEqual(byCountry);
    expect(state.statisticsByCountryLoading).toBe(false);
  });

  it('stores statistics error on by-country failure', () => {
    const state = adminBillingReducer(
      initialAdminBillingState,
      loadAdminStatisticsByCountryFailure({ error: 'country fail' }),
    );

    expect(state.statisticsError).toBe('country fail');
    expect(state.statisticsByCountryLoading).toBe(false);
  });

  it('stores audit logs by invoice on success', () => {
    const logs = [
      {
        id: 'log-1',
        process: 'invoice.issue',
        level: 'info',
        message: 'Issued',
        context: {},
        createdAt: new Date('2024-01-01'),
      },
    ];
    const loading = adminBillingReducer(
      initialAdminBillingState,
      loadAdminAuditLogs({ invoiceRefId: 'inv-1', limit: 20, offset: 0 }),
    );
    const state = adminBillingReducer(
      loading,
      loadAdminAuditLogsSuccess({ invoiceRefId: 'inv-1', items: logs, total: 1 }),
    );

    expect(state.auditLogsByInvoice['inv-1']).toEqual(logs);
    expect(state.auditLogsTotalByInvoice['inv-1']).toBe(1);
    expect(state.auditLogsLoading).toBe(false);
  });

  it('stores audit logs error on failure', () => {
    const state = adminBillingReducer(initialAdminBillingState, loadAdminAuditLogsFailure({ error: 'audit fail' }));

    expect(state.auditLogsError).toBe('audit fail');
    expect(state.auditLogsLoading).toBe(false);
  });
});
