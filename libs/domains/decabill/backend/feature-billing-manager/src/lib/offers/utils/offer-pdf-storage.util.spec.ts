import * as path from 'path';

import { buildOfferPdfStorageKey } from './offer-pdf-storage.util';

describe('buildOfferPdfStorageKey', () => {
  it('builds userId/offerId.pdf without offers/ prefix', () => {
    expect(
      buildOfferPdfStorageKey({
        id: 'offer-1',
        userId: 'user-1',
      }),
    ).toBe(path.join('user-1', 'offer-1.pdf'));
  });
});
