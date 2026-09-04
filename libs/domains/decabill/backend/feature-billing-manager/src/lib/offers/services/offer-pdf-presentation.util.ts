import type { OfferEntity } from '../entities/offer.entity';

export interface OfferPdfPresentationOptions {
  documentTitle: string;
  documentNumber: string;
  documentNumberLabel: string;
  issueDate: Date;
  showExpiresAt: boolean;
  expiresAt?: Date | null;
}

export function buildOfferPdfPresentation(offer: OfferEntity): OfferPdfPresentationOptions {
  const issueDate = offer.archivedAt ?? offer.createdAt;

  return {
    documentTitle: 'Offer / Quotation',
    documentNumber: offer.offerNumber ?? offer.id,
    documentNumberLabel: 'Offer number',
    issueDate,
    showExpiresAt: offer.expiresAt != null,
    expiresAt: offer.expiresAt ?? null,
  };
}
