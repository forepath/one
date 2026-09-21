import * as fs from 'fs';
import * as path from 'path';

import { loadOfferPdfTemplate, resetOfferPdfTemplateCacheForTests } from './offer-pdf-template.loader';

describe('offer-pdf-template.loader', () => {
  afterEach(() => {
    resetOfferPdfTemplateCacheForTests();
  });

  it('loads offer PDF template from offers templates directory', () => {
    expect(fs.existsSync(path.join(__dirname, 'offer-pdf.template.html'))).toBe(true);
    expect(loadOfferPdfTemplate()).toContain('<html');
  });
});
