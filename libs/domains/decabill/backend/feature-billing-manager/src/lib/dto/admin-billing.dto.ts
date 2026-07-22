import { InvoiceStatus } from '../constants/invoice-status.constants';

import { InvoiceResponseDto } from './invoice-response.dto';
import { SubscriptionResponseDto } from './subscription-response.dto';

export class AdminBillingSummaryResponseDto {
  activeSubscriptionsCount!: number;
  openOverdueCount!: number;
  openOverdueTotal!: number;
  unbilledTotal!: number;
}

export class AdminBillNowDto {
  userId?: string;
}

export class AdminBillNowResponseDto {
  queued!: boolean;
  requestId!: string;
  userCount!: number;
}

export class AdminInvoiceListItemDto extends InvoiceResponseDto {
  userId!: string;
  userEmail?: string;
}

export class PaginatedAdminInvoicesResponseDto {
  items!: AdminInvoiceListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class AdminSubscriptionListItemDto extends SubscriptionResponseDto {
  userEmail?: string;
  planName?: string;
}

export class PaginatedAdminSubscriptionsResponseDto {
  items!: AdminSubscriptionListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class MarkInvoicePaymentStatusDto {
  reason?: string;
}

export class BillingAuditLogResponseDto {
  id!: string;
  process!: string;
  level!: string;
  message!: string;
  invoiceId?: string;
  userId?: string;
  context!: Record<string, unknown>;
  createdAt!: Date;
}

export class PaginatedBillingAuditLogsResponseDto {
  items!: BillingAuditLogResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class BillingStatisticsSeriesPointDto {
  period!: string;
  totalGross!: number;
}

export class BillingStatisticsSummaryDto {
  series!: BillingStatisticsSeriesPointDto[];
  totalGross!: number;
  paidCount!: number;
  from!: string;
  to!: string;
  groupBy!: 'day' | 'month';
}

export class BillingStatisticsByProductItemDto {
  planId!: string;
  planName!: string;
  totalGross!: number;
}

export class BillingStatisticsByProductDto {
  items!: BillingStatisticsByProductItemDto[];
  totalGross!: number;
  from!: string;
  to!: string;
}

export class BillingStatisticsByCountryItemDto {
  countryCode!: string;
  countryName!: string;
  totalGross!: number;
}

export class BillingStatisticsByCountryDto {
  items!: BillingStatisticsByCountryItemDto[];
  totalGross!: number;
  from!: string;
  to!: string;
}

export type AdminInvoiceStatus = InvoiceStatus;
