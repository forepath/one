import { BadRequestException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferEntity } from '../entities/offer.entity';

/**
 * What the admin UI may offer for an offer, decided here like the invoice capability flags: drafts
 * have no document, so they can be neither previewed nor downloaded. Every sent offer has a PDF — it
 * is stored on send and rendered on demand when missing (`OfferArchiveService.getPdfBuffer`).
 */
export function offerCapabilityFlags(offer: Pick<OfferEntity, 'status'>): {
  canPreview: boolean;
  canDownload: boolean;
} {
  const previewable = offer.status !== OfferStatus.DRAFT;

  return { canPreview: previewable, canDownload: previewable };
}

/** Rejects drafts before any PDF lookup, as `getPdfBuffer` does for draft invoices. */
export function assertOfferHasPdf(offer: Pick<OfferEntity, 'status'>): void {
  if (offer.status === OfferStatus.DRAFT) {
    throw new BadRequestException('Draft offers have no PDF');
  }
}
