import { BadRequestException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferEntity } from '../entities/offer.entity';
import { assertOfferDeletable, assertOfferDraftEditable } from './offer-mutability.util';

describe('offer-mutability.util', () => {
  const draftOffer = { status: OfferStatus.DRAFT } as OfferEntity;
  const archivedOffer = { status: OfferStatus.ARCHIVED } as OfferEntity;

  it('assertOfferDraftEditable allows draft offers', () => {
    expect(() => assertOfferDraftEditable(draftOffer)).not.toThrow();
  });

  it('assertOfferDraftEditable rejects non-draft offers', () => {
    expect(() => assertOfferDraftEditable(archivedOffer)).toThrow(BadRequestException);
  });

  it('assertOfferDeletable allows draft offers', () => {
    expect(() => assertOfferDeletable(draftOffer)).not.toThrow();
  });

  it('assertOfferDeletable rejects non-draft offers', () => {
    expect(() => assertOfferDeletable(archivedOffer)).toThrow(BadRequestException);
  });
});
