import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type { DocumentDeliveryChannel } from '../../constants/document-delivery.constants';
import { DeliveryTermsCode } from '../../constants/document-terms.constants';
import { TaxCategory } from '../../constants/tax-category.constants';
import { CreateSubscriptionDto } from '../../dto/create-subscription.dto';
import { IsOptionalNotifyFlag } from '../../dto/document-delivery.dto';
import { IsOptionalDocumentNote } from '../../dto/document-note.dto';
import { DocumentTermsInputDto, EffectiveDocumentTermsResponseDto } from '../../dto/document-terms.dto';
import { ProjectPricingModel } from '../../projects/entities/project.enums';
import { OfferLineType } from '../constants/offer-line-type.constants';
import { OfferStatus } from '../constants/offer-status.constants';

export class OfferStandardLineDto {
  @IsString()
  description!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsNumber()
  unitPriceNet!: number;

  @IsOptional()
  @IsString()
  unitLabel?: string;

  @IsOptional()
  @IsEnum(TaxCategory)
  taxCategory?: TaxCategory;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}

export class OfferProjectTemplateLineDto {
  @IsString()
  description!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  projectDescription?: string;

  @IsNumber()
  @Min(0)
  hourlyRateNet!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  targetHours?: number;

  /** `hourly` (default), `capped` (hourly up to `priceLimitNet`) or `fixed` (`priceLimitNet` is the fixed price). */
  @IsOptional()
  @IsEnum(ProjectPricingModel)
  pricingModel?: ProjectPricingModel;

  /** Maximum price (`capped`) or fixed price (`fixed`), net. Required for those models. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  @Max(99_999_999)
  priceLimitNet?: number;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}

export class OfferPlanTemplateLineDto extends CreateSubscriptionDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}

/** Billed like a standard line; accepting the offer raises a withdrawal request for `quantity` of the article. */
export class OfferArticleLineDto extends OfferStandardLineDto {
  @IsUUID('4')
  inventoryArticleId!: string;
}

const OFFER_LINE_PAYLOAD_TYPES: Record<OfferLineType, new () => object> = {
  [OfferLineType.STANDARD]: OfferStandardLineDto,
  [OfferLineType.ARTICLE]: OfferArticleLineDto,
  [OfferLineType.PROJECT_TEMPLATE]: OfferProjectTemplateLineDto,
  [OfferLineType.PLAN_TEMPLATE]: OfferPlanTemplateLineDto,
};

export class OfferLineInputDto {
  @IsEnum(OfferLineType)
  lineType!: OfferLineType;

  /**
   * The payload class is picked from the sibling `lineType` (a class-transformer discriminator would look for
   * `lineType` inside the payload, leave it a plain object and reject every field under `forbidNonWhitelisted`).
   */
  @IsObject()
  @ValidateNested()
  @Type((options) => {
    const lineType = (options?.object as { lineType?: unknown } | undefined)?.lineType;

    return OFFER_LINE_PAYLOAD_TYPES[lineType as OfferLineType] ?? Object;
  })
  payload!: OfferStandardLineDto | OfferArticleLineDto | OfferProjectTemplateLineDto | OfferPlanTemplateLineDto;
}

/**
 * Payment / delivery terms (inherited from `DocumentTermsInputDto`): null/omitted uses the global default; the resolved
 * terms are frozen onto the offer when it is archived and carry over to the invoice on acceptance.
 */
export class CreateAdminOfferDto extends DocumentTermsInputDto {
  @IsUUID('4')
  userId!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  billToOpenPositions?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OfferLineInputDto)
  lineItems!: OfferLineInputDto[];

  /**
   * Optional document note printed on the offer and embedded as document note (BT-22). Offer notes stay on the
   * offer; they do not carry over to the invoice created on acceptance.
   */
  @IsOptionalDocumentNote()
  note?: string | null;
}

export class UpdateAdminOfferDto extends CreateAdminOfferDto {}

export class AdminOfferLineResponseDto {
  id!: string;
  position!: number;
  lineType!: OfferLineType;
  description!: string;
  quantity!: number;
  unitLabel?: string | null;
  unitPriceNet!: number;
  taxCategory!: TaxCategory;
  taxRate!: number;
  lineNet!: number;
  lineTax!: number;
  lineGross!: number;
  scheduledAt?: string | null;
  fulfillmentStatus!: string;
  planId?: string | null;
  planNameSnapshot?: string | null;
  projectTemplatePayload?: Record<string, unknown> | null;
  /** Admin responses only: article of an `article` line. */
  inventoryArticleId?: string | null;
  pricingSnapshot?: Record<string, unknown> | null;
  requestedConfig?: Record<string, unknown>;
  addonIds?: string[];
  addonConfigs?: Record<string, Record<string, string>>;
}

export class AdminOfferListItemDto {
  id!: string;
  userId!: string;
  userEmail?: string;
  /** Billing-profile name (company, else first + last name). */
  customerName?: string;
  offerNumber?: string | null;
  status!: OfferStatus;
  currency!: string;
  totalGross!: number;
  expiresAt?: string | null;
  createdAt!: string;
  updatedAt!: string;
  /** `false` for drafts (no document yet), like invoices. */
  canPreview!: boolean;
  /** `false` for drafts and while no PDF is stored. */
  canDownload!: boolean;
  /** When the offer was sent to the customer; null for drafts and offers archived without notification. */
  sentAt!: string | null;
  /** How the offer was sent: `email`, `letter` (postal provider) or `manual` (marked as sent); null while unsent. */
  sentVia!: DocumentDeliveryChannel | null;
  /** `true` for archived offers not yet sent (and not past their expiry): send / send-letter / mark-sent apply. */
  canSend!: boolean;
  /** Whether the customer is emailed when the offer expires. */
  notifyOnExpiry!: boolean;
  /** `true` while the customer could accept it (archived, not past its expiry): an admin may record the acceptance. */
  canAccept!: boolean;
  /** `true` while the customer could decline it (archived): an admin may record the decline. */
  canDecline!: boolean;
}

/** `POST /admin/billing/offers/:id/archive`: finalize the draft, optionally without sending it yet. */
export class ArchiveAdminOfferDto {
  /** Email the offer (PDF attached) to the customer right away. Default `true`. */
  @IsOptionalNotifyFlag()
  notifyCustomer?: boolean;

  /** Email the customer when the offer expires. Default `true`. */
  @IsOptionalNotifyFlag('notifyOnExpiry')
  notifyOnExpiry?: boolean;
}

/** `POST /admin/billing/offers/:id/revoke`: like a void, the customer is emailed unless suppressed. */
export class RevokeAdminOfferDto {
  /** Email the customer that the offer was withdrawn. Default `true`. */
  @IsOptionalNotifyFlag()
  notifyCustomer?: boolean;
}

/**
 * `POST /admin/billing/offers/:id/accept`: records the customer's acceptance (e.g. given by phone or in writing) with
 * the same checks and fulfillment as the customer accepting it themselves.
 */
export class AcceptAdminOfferDto {
  /** Email the customer the acceptance confirmation. Default `true`. */
  @IsOptionalNotifyFlag()
  notifyCustomer?: boolean;

  /** Email the invoices the acceptance issues right away (they can be sent later otherwise). Default `true`. */
  @IsOptionalNotifyFlag('notifyInvoices')
  notifyInvoices?: boolean;
}

/** `POST /admin/billing/offers/:id/decline`: records the customer's decline. */
export class DeclineAdminOfferDto {
  /** Email the customer the decline confirmation. Default `true`. */
  @IsOptionalNotifyFlag()
  notifyCustomer?: boolean;
}

export class AdminOfferDetailResponseDto extends AdminOfferListItemDto {
  /** Set on send responses: the spool job delivering the offer (Spooler page). */
  spoolJobId?: string;
  subtotalNet!: number;
  taxTotal!: number;
  billToOpenPositions!: boolean;
  lineItems!: AdminOfferLineResponseDto[];
  taxMode?: string | null;
  taxNote?: string | null;
  /** Stored terms: overrides on drafts (null = global default), frozen terms once archived. */
  paymentDueDays!: number | null;
  deliveryTermsCode!: DeliveryTermsCode | null;
  deliveryTermsPlace!: string | null;
  deliveryTermsText!: string | null;
  /** Terms printed on the offer / applied to its invoice (stored terms, else global default). */
  effectiveDocumentTerms!: EffectiveDocumentTermsResponseDto;
  /** Free-text document note printed on the offer; null when none. */
  note!: string | null;
}

export class PaginatedAdminOffersResponseDto {
  items!: AdminOfferListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class OfferStatisticsResponseDto {
  draftCount!: number;
  pendingCount!: number;
  pendingGross!: number;
  acceptedCount!: number;
  acceptedGross!: number;
  declinedCount!: number;
  expiredCount!: number;
  revokedCount!: number;
  series!: { period: string; archivedCount: number; acceptedCount: number; declinedCount: number }[];
  from!: string;
  to!: string;
  groupBy!: 'day' | 'month';
}

export class OffersSummaryResponseDto {
  pendingCount!: number;
  actionRequiredCount!: number;
  acceptedCount!: number;
  historyCount!: number;
}

export class CustomerOfferListItemDto {
  id!: string;
  offerNumber?: string | null;
  status!: OfferStatus;
  currency!: string;
  totalGross!: number;
  expiresAt?: string | null;
  archivedAt?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
}

/** One page of the caller's own offers (`GET /offers/pending|history?limit&offset&search`). */
export class PaginatedCustomerOffersResponseDto {
  items!: CustomerOfferListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class CustomerOfferDetailResponseDto extends CustomerOfferListItemDto {
  subtotalNet!: number;
  taxTotal!: number;
  lineItems!: AdminOfferLineResponseDto[];
  billToOpenPositions!: boolean;
  /** Payment / delivery terms of this offer (also applied to the invoice created on acceptance). */
  paymentDueDays!: number;
  deliveryTermsCode!: DeliveryTermsCode | null;
  deliveryTermsPlace!: string | null;
  deliveryTermsText!: string | null;
  /** Free-text document note printed on the offer; null when none. */
  note!: string | null;
}
