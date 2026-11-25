import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

import type { DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';

import { IsOptionalNotifyFlag } from './document-delivery.dto';
import { IsOptionalDocumentNote } from './document-note.dto';
import { InvoiceResponseDto } from './invoice-response.dto';
import { SubscriptionResponseDto } from './subscription-response.dto';

export class AdminBillingSummaryResponseDto {
  subscriptionsCount!: number;
  activeSubscriptionsCount!: number;
  openOverdueCount!: number;
  openOverdueTotal!: number;
  unbilledTotal!: number;
}

export class AdminBillNowDto {
  /** Bill one customer; omitted bills everyone due. */
  @IsOptional()
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
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
  /** Billing-profile name (company, else first + last name); admin lists show it instead of the email. */
  customerName?: string;
  /** When the invoice was sent to the customer; null when it was issued without notification. */
  sentAt?: string | null;
  /** How the invoice was sent: `email`, `letter` (postal provider) or `manual` (marked as sent); null while unsent. */
  sentVia?: DocumentDeliveryChannel | null;
  /** When the credit note of a voided invoice was sent to the customer; null when not sent. */
  voidDocumentSentAt?: string | null;
  /** How the credit note was sent (`email`, `letter`, `manual`); null while unsent. */
  voidDocumentSentVia?: DocumentDeliveryChannel | null;
  /** Issued (not voided) invoice that was not sent yet: the send / send-letter / mark-sent actions apply. */
  canSend?: boolean;
  /** Voided invoice whose credit note was not sent yet: the credit-note send / letter / mark-sent actions apply. */
  canSendCreditNote?: boolean;
  /** Set on send responses: the spool job delivering the document (Spooler page). */
  spoolJobId?: string;
}

export class PaginatedAdminInvoicesResponseDto {
  items!: AdminInvoiceListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class AdminSubscriptionListItemDto extends SubscriptionResponseDto {
  userEmail?: string;
  /** Billing-profile name (company, else first + last name). */
  customerName?: string;
  planName?: string;
  /** Plan billing interval, so the price cell reads like the customer's (`€5.95 / Monthly`). */
  billingIntervalType?: string;
  billingIntervalValue?: number;
}

export class PaginatedAdminSubscriptionsResponseDto {
  items!: AdminSubscriptionListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

/** Optional note printed on the credit note (void document) and embedded as invoice note (BT-22). */
export class VoidInvoiceDto {
  @IsOptionalDocumentNote()
  note?: string | null;

  /** Email the credit note to the customer right away. Default `true`; `false` voids silently (send later). */
  @IsOptionalNotifyFlag()
  notifyCustomer?: boolean;
}

export class MarkInvoicePaymentStatusDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  reason?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Paid at must be an ISO 8601 datetime' })
  paidAt?: string;

  /** Partial amount (gross, document currency); defaults to the full balance due. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must be a number with at most 2 decimals' })
  @IsPositive({ message: 'Amount must be positive' })
  amount?: number;
}

export class InvoiceSettlementResponseDto {
  id!: string;
  type!: string;
  amount!: number;
  currency!: string;
  occurredAt!: string;
  source!: string;
  processor?: string | null;
  externalId?: string | null;
  creditDocumentId?: string | null;
  relatedDocumentId?: string | null;
  note?: string | null;
  createdAt!: string;
}

/** Admin write-off of an uncollectible balance or manual refund of a customer credit. */
export class RecordInvoiceSettlementDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must be a number with at most 2 decimals' })
  @IsPositive({ message: 'Amount must be positive' })
  amount?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Date must be an ISO 8601 datetime' })
  occurredAt?: string;

  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  @MaxLength(500)
  reason?: string;
}

export class BillingAuditLogResponseDto {
  id!: string;
  process!: string;
  level!: string;
  message!: string;
  invoiceId?: string;
  offerId?: string;
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
