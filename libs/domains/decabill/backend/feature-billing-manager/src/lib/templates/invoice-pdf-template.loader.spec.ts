import * as fs from 'fs';
import * as path from 'path';

import { loadInvoicePdfTemplate, resetInvoicePdfTemplateCacheForTests } from './invoice-pdf-template.loader';

describe('invoice-pdf-template.loader', () => {
  beforeEach(() => {
    resetInvoicePdfTemplateCacheForTests();
  });

  it('loads the Handlebars template from the templates directory', () => {
    const template = loadInvoicePdfTemplate();

    expect(template.toLowerCase()).toContain('<!doctype html>');
    expect(template).toContain('{{invoiceNumber}}');
    expect(template).toContain('--surface-subtle: #f4f4f4');
    expect(fs.existsSync(path.join(__dirname, 'invoice-pdf.template.html'))).toBe(true);
  });
});
