import { BadRequestException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import { assertOfferHasPdf, offerCapabilityFlags } from './offer-capabilities.util';

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
});
