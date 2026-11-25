import { BadRequestException } from '@nestjs/common';

import { DocumentDeliveryChannel } from '../../constants/document-delivery.constants';
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
  offer: Pick<OfferEntity, 'status' | 'sentAt' | 'sentVia' | 'expiresAt' | 'notifyOnExpiry'>,
  now: Date = new Date(),
): { sentAt: string | null; sentVia: DocumentDeliveryChannel | null; canSend: boolean; notifyOnExpiry: boolean } {
  return {
    sentAt: offer.sentAt?.toISOString() ?? null,
    sentVia: offer.sentAt ? (offer.sentVia ?? DocumentDeliveryChannel.EMAIL) : null,
    canSend: offer.status === OfferStatus.ARCHIVED && !offer.sentAt && !isOfferPastExpiry(offer, now),
    notifyOnExpiry: offer.notifyOnExpiry === true,
  };
}

/**
 * Whether an admin may record the customer's answer: exactly the offers the customer could accept / decline
 * themselves (`OffersCustomerService`), whether or not the offer was sent through the system.
 */
export function offerResponseFlags(
  offer: Pick<OfferEntity, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): { canAccept: boolean; canDecline: boolean } {
  const open = offer.status === OfferStatus.ARCHIVED;

  return { canAccept: open && !isOfferPastExpiry(offer, now), canDecline: open };
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
