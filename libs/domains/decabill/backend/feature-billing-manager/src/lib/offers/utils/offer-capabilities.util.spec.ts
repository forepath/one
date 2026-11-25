import { BadRequestException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';

import {
  assertOfferHasPdf,
  offerCapabilityFlags,
  offerDeliveryFields,
  offerResponseFlags,
} from './offer-capabilities.util';

describe('offer-capabilities.util', () => {
  it('drafts can be neither previewed nor downloaded', () => {
    expect(offerCapabilityFlags({ status: OfferStatus.DRAFT })).toEqual({
      canPreview: false,
      canDownload: false,
    });
  });

  it('every sent offer can be previewed and downloaded (a missing PDF is rendered on demand)', () => {
    for (const status of [
      OfferStatus.ARCHIVED,
      OfferStatus.ACCEPTED,
      OfferStatus.DECLINED,
      OfferStatus.EXPIRED,
      OfferStatus.REVOKED,
    ]) {
      expect(offerCapabilityFlags({ status })).toEqual({
        canPreview: true,
        canDownload: true,
      });
    }
  });

  it('assertOfferHasPdf rejects drafts only', () => {
    expect(() => assertOfferHasPdf({ status: OfferStatus.DRAFT })).toThrow(BadRequestException);
    expect(() => assertOfferHasPdf({ status: OfferStatus.ARCHIVED })).not.toThrow();
  });

  describe('offerResponseFlags', () => {
    const now = new Date('2026-11-21T12:00:00Z');

    it('mirrors what the customer can answer: archived, accept only before expiry', () => {
      expect(offerResponseFlags({ status: OfferStatus.ARCHIVED, expiresAt: null }, now)).toEqual({
        canAccept: true,
        canDecline: true,
      });
      expect(
        offerResponseFlags({ status: OfferStatus.ARCHIVED, expiresAt: new Date('2026-11-21T12:00:00Z') }, now),
      ).toEqual({ canAccept: false, canDecline: true });

      for (const status of [
        OfferStatus.DRAFT,
        OfferStatus.ACCEPTED,
        OfferStatus.DECLINED,
        OfferStatus.REVOKED,
        OfferStatus.EXPIRED,
      ]) {
        expect(offerResponseFlags({ status, expiresAt: null }, now)).toEqual({ canAccept: false, canDecline: false });
      }
    });
  });

  describe('offerDeliveryFields', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    const archived = {
      status: OfferStatus.ARCHIVED,
      sentAt: null,
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      notifyOnExpiry: true,
    };

    it('an archived, unsent, unexpired offer can be sent', () => {
      expect(offerDeliveryFields(archived, now)).toEqual({
        sentAt: null,
        sentVia: null,
        canSend: true,
        notifyOnExpiry: true,
      });
      expect(offerDeliveryFields({ ...archived, expiresAt: null }, now).canSend).toBe(true);
    });

    it('sent, expired or non-archived offers cannot be sent', () => {
      const sentAt = new Date('2026-11-20T08:00:00Z');

      expect(offerDeliveryFields({ ...archived, sentAt }, now)).toEqual(
        expect.objectContaining({ canSend: false, sentAt: '2026-11-20T08:00:00.000Z' }),
      );
      expect(offerDeliveryFields({ ...archived, expiresAt: new Date('2026-11-21T11:59:59Z') }, now).canSend).toBe(
        false,
      );

      for (const status of [OfferStatus.DRAFT, OfferStatus.ACCEPTED, OfferStatus.REVOKED, OfferStatus.EXPIRED]) {
        expect(offerDeliveryFields({ ...archived, status }, now).canSend).toBe(false);
      }
    });
  });
});
