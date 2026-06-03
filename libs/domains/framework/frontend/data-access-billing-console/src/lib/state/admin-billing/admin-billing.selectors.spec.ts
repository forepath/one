import type { AdminBillingState } from './admin-billing.reducer';
import { selectAdminBillingSummary, selectAdminOpenOverdueItems, selectBillNowResult } from './admin-billing.selectors';

describe('adminBillingSelectors', () => {
  const state: AdminBillingState = {
    summary: { activeSubscriptionsCount: 1, openOverdueCount: 2, openOverdueTotal: 20, unbilledTotal: 5 },
    summaryLoading: false,
    summaryError: null,
    billNowLoading: false,
    billNowResult: { usersProcessed: 1, invoicesCreated: 1, usersSkipped: 0, errors: [] },
    billNowError: null,
    openOverdueItems: [],
    openOverdueTotal: 0,
    openOverdueLimit: 10,
    openOverdueOffset: 0,
    openOverdueLoading: false,
    openOverdueError: null,
    actionLoading: false,
    actionError: null,
    statisticsSummary: null,
    statisticsSummaryLoading: false,
    statisticsByProduct: null,
    statisticsByProductLoading: false,
    statisticsError: null,
    auditLogsByInvoice: {},
    auditLogsTotalByInvoice: {},
    auditLogsLoading: false,
    auditLogsError: null,
  };

  it('selectAdminBillingSummary', () => {
    expect(selectAdminBillingSummary.projector(state)?.openOverdueCount).toBe(2);
  });

  it('selectBillNowResult', () => {
    expect(selectBillNowResult.projector(state)?.invoicesCreated).toBe(1);
  });

  it('selectAdminOpenOverdueItems', () => {
    expect(selectAdminOpenOverdueItems.projector(state)).toEqual([]);
  });
});
