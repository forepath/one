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

/**
 * Delivery state for the admin UI: an archived offer is sendable until it was sent (or released) to the customer,
 * and only while it has not expired yet (a customer could not accept it anymore).
 */
export function offerDeliveryFields(
  offer: Pick<OfferEntity, 'status' | 'sentAt' | 'expiresAt' | 'notifyOnExpiry'>,
  now: Date = new Date(),
): { sentAt: string | null; canSend: boolean; notifyOnExpiry: boolean } {
  return {
    sentAt: offer.sentAt?.toISOString() ?? null,
    canSend: offer.status === OfferStatus.ARCHIVED && !offer.sentAt && !isOfferPastExpiry(offer, now),
    notifyOnExpiry: offer.notifyOnExpiry === true,
  };
}

export function isOfferPastExpiry(offer: Pick<OfferEntity, 'expiresAt'>, now: Date = new Date()): boolean {
  return Boolean(offer.expiresAt && offer.expiresAt.getTime() <= now.getTime());
}

/** Rejects drafts before any PDF lookup, as `getPdfBuffer` does for draft invoices. */
export function assertOfferHasPdf(offer: Pick<OfferEntity, 'status'>): void {
  if (offer.status === OfferStatus.DRAFT) {
    throw new BadRequestException('Draft offers have no PDF');
  }
}
