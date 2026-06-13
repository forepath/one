import { PDFDocument } from 'pdf-lib';

import { EInvoiceEmbedService } from './e-invoice-embed.service';

describe('EInvoiceEmbedService', () => {
  const service = new EInvoiceEmbedService();

  it('embeds XML as an attachment in the PDF', async () => {
    const basePdf = await PDFDocument.create();

    basePdf.addPage();
    const baseBytes = await basePdf.save();
    const xml = '<?xml version="1.0"?><Invoice/>';
    const result = await service.embedXmlInPdf(baseBytes, xml, 'test-invoice.xml');

    expect(result.byteLength).toBeGreaterThan(baseBytes.byteLength);
  });
});
