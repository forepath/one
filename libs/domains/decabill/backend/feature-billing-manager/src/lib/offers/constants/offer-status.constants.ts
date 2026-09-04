export enum OfferStatus {
  DRAFT = 'draft',
  ARCHIVED = 'archived',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

export const CUSTOMER_VISIBLE_OFFER_STATUSES: OfferStatus[] = [
  OfferStatus.ARCHIVED,
  OfferStatus.ACCEPTED,
  OfferStatus.DECLINED,
  OfferStatus.EXPIRED,
];

export const PENDING_OFFER_STATUSES: OfferStatus[] = [OfferStatus.ARCHIVED];

export const HISTORY_OFFER_STATUSES: OfferStatus[] = [OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.EXPIRED];
