import type { ListParams, TaxCategory } from './billing.types';

export type OfferStatus = 'draft' | 'archived' | 'accepted' | 'declined' | 'expired' | 'revoked';

export type OfferLineType = 'standard' | 'project_template' | 'plan_template';

export type OfferFulfillmentStatus = 'pending' | 'fulfilled' | 'failed';

export interface PaginatedOffersResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface OffersSummaryResponse {
  pendingCount: number;
  actionRequiredCount: number;
  acceptedCount: number;
  historyCount: number;
}

export interface CustomerOfferListItem {
  id: string;
  offerNumber?: string | null;
  status: OfferStatus;
  currency: string;
  totalGross: number;
  expiresAt?: string | null;
  archivedAt?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
}

export interface OfferLineResponse {
  id: string;
  position: number;
  lineType: OfferLineType;
  description: string;
  quantity: number;
  unitLabel?: string | null;
  unitPriceNet: number;
  taxCategory: TaxCategory;
  taxRate: number;
  lineNet: number;
  lineTax: number;
  lineGross: number;
  scheduledAt?: string | null;
  fulfillmentStatus: OfferFulfillmentStatus | string;
  planId?: string | null;
  planNameSnapshot?: string | null;
  projectTemplatePayload?: Record<string, unknown> | null;
  pricingSnapshot?: Record<string, unknown> | null;
  requestedConfig?: Record<string, unknown>;
  addonIds?: string[];
  addonConfigs?: Record<string, Record<string, string>>;
}

export interface CustomerOfferDetailResponse extends CustomerOfferListItem {
  subtotalNet: number;
  taxTotal: number;
  lineItems: OfferLineResponse[];
  billToOpenPositions: boolean;
}

export interface AdminOfferListItem {
  id: string;
  userId: string;
  userEmail?: string;
  offerNumber?: string | null;
  status: OfferStatus;
  currency: string;
  totalGross: number;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOfferDetailResponse extends AdminOfferListItem {
  subtotalNet: number;
  taxTotal: number;
  billToOpenPositions: boolean;
  lineItems: OfferLineResponse[];
  taxMode?: string | null;
  taxNote?: string | null;
}

export interface OfferStandardLineDto {
  description: string;
  quantity: number;
  unitPriceNet: number;
  unitLabel?: string;
  taxCategory?: TaxCategory;
  scheduledAt?: string;
}

export interface OfferProjectTemplateLineDto {
  description: string;
  name: string;
  projectDescription?: string;
  hourlyRateNet: number;
  currency?: string;
  targetHours?: number;
  scheduledAt?: string;
}

export interface OfferPlanTemplateLineDto {
  description: string;
  planId: string;
  requestedConfig?: Record<string, unknown>;
  addonIds?: string[];
  addonConfigs?: Record<string, unknown>;
  preferredAlternatives?: Record<string, unknown>;
  autoBackorder?: boolean;
  promotionCode?: string;
  promotionBenefitStartsAt?: string;
  scheduledAt?: string;
}

export interface OfferLineInputDto {
  lineType: OfferLineType;
  payload: OfferStandardLineDto | OfferProjectTemplateLineDto | OfferPlanTemplateLineDto;
}

export interface CreateAdminOfferDto {
  userId: string;
  currency?: string;
  expiresAt?: string;
  billToOpenPositions?: boolean;
  lineItems: OfferLineInputDto[];
}

export type UpdateAdminOfferDto = CreateAdminOfferDto;

export interface OfferStatisticsSeriesPoint {
  period: string;
  archivedCount: number;
  acceptedCount: number;
  declinedCount: number;
}

export interface OfferStatisticsResponse {
  draftCount: number;
  pendingCount: number;
  pendingGross: number;
  acceptedCount: number;
  acceptedGross: number;
  declinedCount: number;
  expiredCount: number;
  revokedCount: number;
  series: OfferStatisticsSeriesPoint[];
  from: string;
  to: string;
  groupBy: 'day' | 'month';
}

export interface AdminOfferStatisticsParams {
  from?: string;
  to?: string;
  groupBy?: 'day' | 'month';
  userId?: string;
}

export type OfferListParams = ListParams & {
  userId?: string;
};
