import type { AdminBillingState } from './admin-billing.reducer';
import {
  selectAdminActionError,
  selectAdminActionLoading,
  selectAdminAuditLogsByInvoice,
  selectAdminAuditLogsError,
  selectAdminAuditLogsLoading,
  selectAdminBillingSummary,
  selectAdminBillingSummaryError,
  selectAdminBillingSummaryLoading,
  selectAdminOpenOverdueError,
  selectAdminOpenOverdueItems,
  selectAdminOpenOverdueLoading,
  selectAdminOpenOverdueTotal,
  selectAdminStatisticsByCountry,
  selectAdminStatisticsByCountryLoading,
  selectAdminStatisticsByProduct,
  selectAdminStatisticsByProductLoading,
  selectAdminStatisticsError,
  selectAdminStatisticsSummary,
  selectAdminStatisticsSummaryLoading,
  selectBillNowError,
  selectBillNowLoading,
  selectBillNowResult,
} from './admin-billing.selectors';

describe('adminBillingSelectors', () => {
  const state: AdminBillingState = {
    summary: { activeSubscriptionsCount: 1, openOverdueCount: 2, openOverdueTotal: 20, unbilledTotal: 5 },
    summaryLoading: true,
    summaryError: 'summary err',
    billNowLoading: true,
    billNowResult: { queued: true, requestId: 'req-1', userCount: 1 },
    billNowError: 'bill err',
    openOverdueItems: [],
    openOverdueTotal: 3,
    openOverdueLimit: 10,
    openOverdueOffset: 0,
    openOverdueLoading: true,
    openOverdueError: 'list err',
    actionLoading: true,
    actionError: 'action err',
    statisticsSummary: {
      series: [],
      totalGross: 100,
      paidCount: 1,
      from: '2024-01-01',
      to: '2024-01-31',
      groupBy: 'day',
    },
    statisticsSummaryLoading: true,
    statisticsByProduct: { items: [], totalGross: 0, from: '2024-01-01', to: '2024-01-31' },
    statisticsByProductLoading: true,
    statisticsByCountry: {
      items: [{ countryCode: 'DE', countryName: 'Germany', totalGross: 40 }],
      totalGross: 40,
      from: '2024-01-01',
      to: '2024-01-31',
    },
    statisticsByCountryLoading: true,
    statisticsError: 'stats err',
    auditLogsByInvoice: { 'inv-1': [] },
    auditLogsTotalByInvoice: { 'inv-1': 0 },
    auditLogsLoading: true,
    auditLogsError: 'audit err',
  };

  it('selects summary slice', () => {
    expect(selectAdminBillingSummary.projector(state)?.openOverdueCount).toBe(2);
    expect(selectAdminBillingSummaryLoading.projector(state)).toBe(true);
    expect(selectAdminBillingSummaryError.projector(state)).toBe('summary err');
  });

  it('selects bill-now slice', () => {
    expect(selectBillNowResult.projector(state)?.userCount).toBe(1);
    expect(selectBillNowLoading.projector(state)).toBe(true);
    expect(selectBillNowError.projector(state)).toBe('bill err');
  });

  it('selects open overdue slice', () => {
    expect(selectAdminOpenOverdueItems.projector(state)).toEqual([]);
    expect(selectAdminOpenOverdueTotal.projector(state)).toBe(3);
    expect(selectAdminOpenOverdueLoading.projector(state)).toBe(true);
    expect(selectAdminOpenOverdueError.projector(state)).toBe('list err');
  });

  it('selects action slice', () => {
    expect(selectAdminActionLoading.projector(state)).toBe(true);
    expect(selectAdminActionError.projector(state)).toBe('action err');
  });

  it('selects statistics slice', () => {
    expect(selectAdminStatisticsSummary.projector(state)?.totalGross).toBe(100);
    expect(selectAdminStatisticsSummaryLoading.projector(state)).toBe(true);
    expect(selectAdminStatisticsByProduct.projector(state)?.totalGross).toBe(0);
    expect(selectAdminStatisticsByProductLoading.projector(state)).toBe(true);
    expect(selectAdminStatisticsByCountry.projector(state)?.totalGross).toBe(40);
    expect(selectAdminStatisticsByCountryLoading.projector(state)).toBe(true);
    expect(selectAdminStatisticsError.projector(state)).toBe('stats err');
  });

  it('selects audit logs slice', () => {
    expect(selectAdminAuditLogsByInvoice.projector(state)).toEqual({ 'inv-1': [] });
    expect(selectAdminAuditLogsLoading.projector(state)).toBe(true);
    expect(selectAdminAuditLogsError.projector(state)).toBe('audit err');
  });
});
