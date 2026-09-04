import * as path from 'path';

import type { OfferEntity } from '../entities/offer.entity';

export function buildOfferPdfStorageKey(offer: Pick<OfferEntity, 'id' | 'userId'>, fileSuffix = '.pdf'): string {
  const fileName = `${offer.id}${fileSuffix}`;

  return path.join('offers', offer.userId, fileName);
}
