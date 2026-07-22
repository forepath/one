import { CustomerTrustLevel } from './trust-score.types';

export const CUSTOMER_TRUST_SCORE_BASE = 100;
export const CUSTOMER_TRUST_SCORE_MIN = 0;
export const CUSTOMER_TRUST_SCORE_MAX = 200;
export const CUSTOMER_TRUST_SCORE_SNAPSHOT_TTL_MS = 60 * 60 * 1000;

export const CUSTOMER_TRUST_SCORE_THRESHOLDS: Record<CustomerTrustLevel, number> = {
  [CustomerTrustLevel.GREEN]: 120,
  [CustomerTrustLevel.YELLOW]: 70,
  [CustomerTrustLevel.RED]: 0,
};

export const CUSTOMER_TRUST_SCORE_FACTOR_CONFIG = {
  profileComplete: {
    id: 'profile_complete',
    points: 10,
  },
  activeOrPastSubscription: {
    id: 'active_or_past_subscription',
    points: 15,
  },
  multiPeriodTenure: {
    id: 'multi_period_tenure',
    points: 20,
  },
  onTimePayments: {
    id: 'on_time_payments',
    points: 5,
    cap: 5,
  },
  autoBillingReady: {
    id: 'auto_billing_ready',
    points: 10,
  },
  noWithdrawal: {
    id: 'no_withdrawal',
    points: 10,
  },
  overdueInvoices: {
    id: 'overdue_invoices',
    points: -15,
    cap: 5,
  },
  failedPayments: {
    id: 'failed_payments',
    points: -10,
    cap: 5,
  },
  autoPaymentExhausted: {
    id: 'auto_payment_exhausted',
    points: -20,
  },
  productWithdrawal: {
    id: 'product_withdrawal',
    points: -25,
  },
  backorderFailures: {
    id: 'backorder_failures',
    points: -5,
    cap: 3,
  },
} as const;
