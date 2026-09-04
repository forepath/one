import { BadRequestException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferEntity } from '../entities/offer.entity';

export function assertOfferDraftEditable(offer: OfferEntity): void {
  if (offer.status !== OfferStatus.DRAFT) {
    throw new BadRequestException('Only draft offers can be modified');
  }
}

export function assertOfferRevocable(offer: OfferEntity): void {
  if (offer.status !== OfferStatus.DRAFT && offer.status !== OfferStatus.ARCHIVED) {
    throw new BadRequestException('Only draft or archived offers can be revoked');
  }
}

export function assertOfferDeletable(offer: OfferEntity): void {
  if (offer.status !== OfferStatus.DRAFT) {
    throw new BadRequestException('Only draft offers can be deleted');
  }
}
