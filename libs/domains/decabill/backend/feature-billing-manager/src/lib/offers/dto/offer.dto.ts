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
  Min,
  ValidateNested,
} from 'class-validator';

import { TaxCategory } from '../../constants/tax-category.constants';
import { CreateSubscriptionDto } from '../../dto/create-subscription.dto';
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

export class OfferLineInputDto {
  @IsEnum(OfferLineType)
  lineType!: OfferLineType;

  @ValidateNested()
  @Type(() => Object, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'lineType',
      subTypes: [
        { value: OfferStandardLineDto, name: OfferLineType.STANDARD },
        { value: OfferProjectTemplateLineDto, name: OfferLineType.PROJECT_TEMPLATE },
        { value: OfferPlanTemplateLineDto, name: OfferLineType.PLAN_TEMPLATE },
      ],
    },
  })
  payload!: OfferStandardLineDto | OfferProjectTemplateLineDto | OfferPlanTemplateLineDto;
}

export class CreateAdminOfferDto {
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
  pricingSnapshot?: Record<string, unknown> | null;
  requestedConfig?: Record<string, unknown>;
  addonIds?: string[];
  addonConfigs?: Record<string, Record<string, string>>;
}

export class AdminOfferListItemDto {
  id!: string;
  userId!: string;
  userEmail?: string;
  offerNumber?: string | null;
  status!: OfferStatus;
  currency!: string;
  totalGross!: number;
  expiresAt?: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class AdminOfferDetailResponseDto extends AdminOfferListItemDto {
  subtotalNet!: number;
  taxTotal!: number;
  billToOpenPositions!: boolean;
  lineItems!: AdminOfferLineResponseDto[];
  taxMode?: string | null;
  taxNote?: string | null;
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

export class CustomerOfferDetailResponseDto extends CustomerOfferListItemDto {
  subtotalNet!: number;
  taxTotal!: number;
  lineItems!: AdminOfferLineResponseDto[];
  billToOpenPositions!: boolean;
}
