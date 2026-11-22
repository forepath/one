/** Grouping of the overview's period series. */
export type AdminOverviewGroupBy = 'day' | 'month';

/** Tenant scope of an overview response: one tenant, or every configured tenant plus the combined numbers. */
export type AdminOverviewScope = 'tenant' | 'all';

/**
 * Key figures of one tenant (or the sum over tenants). Counts are plain numbers, amounts are gross in the billing
 * currency. `*InPeriod` fields cover the requested `from`–`to` range; all other fields are the current state.
 */
export interface AdminOverviewMetricsDto {
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

/** Revenue (issued customer invoices) and expenses (supplier invoices) of one period bucket. */
export interface AdminOverviewSeriesPointDto {
  /** `YYYY-MM-DD` (day) or first day of the month (`YYYY-MM-01`). */
  period: string;
  revenueGross: number;
  expenseGross: number;
}

export interface AdminOverviewTenantDto {
  tenantId: string;
  metrics: AdminOverviewMetricsDto;
  series: AdminOverviewSeriesPointDto[];
}

export interface AdminOverviewResponseDto {
  scope: AdminOverviewScope;
  from: string;
  to: string;
  groupBy: AdminOverviewGroupBy;
  /** One entry per tenant in scope (a single one for `scope: 'tenant'`). */
  tenants: AdminOverviewTenantDto[];
  /** Sum over `tenants` (equal to the single tenant for `scope: 'tenant'`). */
  combined: Omit<AdminOverviewTenantDto, 'tenantId'>;
}
