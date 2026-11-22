/** `viewTenantId` of the admin overview's cross-tenant view (every configured tenant plus combined sums). */
export const ADMIN_OVERVIEW_ALL_TENANTS = 'all';

export type AdminOverviewGroupBy = 'day' | 'month';

/** Query of `GET /admin/billing/overview`. */
export interface AdminOverviewParams {
  /** Tenant to show, or {@link ADMIN_OVERVIEW_ALL_TENANTS}; omitted = the request tenant. */
  viewTenantId?: string | null;
  from?: string;
  to?: string;
  groupBy?: AdminOverviewGroupBy;
}

/** Key figures of a tenant; `*InPeriod` fields cover the requested range, the rest is the current state. */
export interface AdminOverviewMetrics {
  customerCount: number;
  subscriptionCount: number;
  activeSubscriptionCount: number;
  pendingBackorderSubscriptionCount: number;
  openReceivableCount: number;
  openReceivableTotal: number;
  overdueInvoiceCount: number;
  unbilledTotal: number;
  revenueInPeriod: number;
  paidInvoiceCountInPeriod: number;
  supplierCount: number;
  openPayableCount: number;
  openPayableTotal: number;
  expenseInPeriod: number;
  draftOfferCount: number;
  pendingOfferCount: number;
  pendingOfferTotal: number;
  acceptedOfferCountInPeriod: number;
  activeProjectCount: number;
  openTicketCount: number;
  articleCount: number;
  lowStockArticleCount: number;
  pendingWithdrawalRequestCount: number;
  openLendingCount: number;
  overdueLendingCount: number;
}

export interface AdminOverviewSeriesPoint {
  period: string;
  revenueGross: number;
  expenseGross: number;
}

export interface AdminOverviewTenant {
  tenantId: string;
  metrics: AdminOverviewMetrics;
  series: AdminOverviewSeriesPoint[];
}

export interface AdminOverviewResponse {
  scope: 'tenant' | 'all';
  from: string;
  to: string;
  groupBy: AdminOverviewGroupBy;
  tenants: AdminOverviewTenant[];
  combined: Omit<AdminOverviewTenant, 'tenantId'>;
}
