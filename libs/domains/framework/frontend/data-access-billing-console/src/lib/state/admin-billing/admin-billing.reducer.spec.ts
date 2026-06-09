import {
  adminMarkPaidSuccess,
  billNowSuccess,
  loadAdminBillingSummarySuccess,
  loadAdminOpenOverdueSuccess,
} from './admin-billing.actions';
import { adminBillingReducer, initialAdminBillingState } from './admin-billing.reducer';

describe('adminBillingReducer', () => {
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

  it('stores bill-now result', () => {
    const result = { queued: true, requestId: 'req-1', userCount: 1 };
    const state = adminBillingReducer(initialAdminBillingState, billNowSuccess({ result }));

    expect(state.billNowResult).toEqual(result);
  });

  it('removes paid invoice from open overdue list', () => {
    const withItems = adminBillingReducer(
      initialAdminBillingState,
      loadAdminOpenOverdueSuccess({
        items: [
          {
            id: 'inv-1',
            subscriptionId: 'sub-1',
            userId: 'user-1',
            status: 'issued',
            createdAt: '2024-01-01',
            canPay: true,
            canDownload: true,
            canPreview: true,
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      }),
    );
    const next = adminBillingReducer(
      withItems,
      adminMarkPaidSuccess({
        invoice: {
          id: 'inv-1',
          subscriptionId: 'sub-1',
          userId: 'user-1',
          status: 'paid',
          createdAt: '2024-01-01',
          canPay: false,
          canDownload: true,
          canPreview: true,
        },
      }),
    );

    expect(next.openOverdueItems).toHaveLength(0);
  });
});
