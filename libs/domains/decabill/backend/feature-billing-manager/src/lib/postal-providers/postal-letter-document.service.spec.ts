import { PDFDocument, PageSizes } from 'pdf-lib';

import type { BillingIssuerConfig } from '../services/billing-issuer-config.service';

import { formatRecipientLines, PostalLetterDocumentService } from './postal-letter-document.service';

async function pdfWithPages(count: number, label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();

  for (let i = 0; i < count; i += 1) {
    doc.addPage(PageSizes.A4);
  }

  doc.setTitle(label);

  return Buffer.from(await doc.save());
}

describe('PostalLetterDocumentService', () => {
  const issuer: BillingIssuerConfig = {
    name: 'Forepath <GmbH>',
    vatId: 'DE123',
    addressLine1: 'Weg 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    email: 'billing@example.com',
  };
  const recipient = {
    nameLines: ['Acme & Co <script>alert(1)</script>'],
    streetLines: ['Rue 2'],
    postalCode: '75001',
    city: 'Paris',
    country: 'FR',
  };
  const renderer = { renderHtmlToPdf: jest.fn() };
  const service = new PostalLetterDocumentService(renderer as never);

  beforeEach(async () => {
    renderer.renderHtmlToPdf.mockReset();
    renderer.renderHtmlToPdf.mockResolvedValue(new Uint8Array(await pdfWithPages(1, 'cover')));
  });

  it('prepends the cover page and keeps the document pages', async () => {
    const result = await service.build({
      documents: [await pdfWithPages(2, 'invoice'), await pdfWithPages(1, 'time report')],
      recipient,
      issuer,
      documentTitle: 'Invoice',
      documentNumber: 'INV-1',
      addressPosition: 'left',
      coverPage: true,
      duplex: false,
    });

    expect(result.pageCount).toBe(4);
    expect(result.coverPage).toBe(true);
    expect(renderer.renderHtmlToPdf).toHaveBeenCalledWith(expect.any(String), { cssPageSize: true });
    await expect(PDFDocument.load(result.pdf)).resolves.toBeDefined();
  });

  it('starts every part on a new sheet in duplex', async () => {
    const result = await service.build({
      documents: [await pdfWithPages(1, 'invoice'), await pdfWithPages(1, 'time report')],
      recipient,
      issuer,
      documentTitle: 'Invoice',
      documentNumber: 'INV-1',
      addressPosition: 'left',
      coverPage: true,
      duplex: true,
    });

    // cover + blank back, invoice + blank back, time report
    expect(result.pageCount).toBe(5);
  });

  it('sends the document unchanged without a cover page', async () => {
    const result = await service.build({
      documents: [await pdfWithPages(3, 'offer')],
      recipient,
      issuer,
      documentTitle: 'Offer',
      documentNumber: 'OFF-1',
      addressPosition: 'right',
      coverPage: false,
      duplex: false,
    });

    expect(result.pageCount).toBe(3);
    expect(renderer.renderHtmlToPdf).not.toHaveBeenCalled();
  });

  it('escapes every value in the cover page and places the window on the configured side', () => {
    const html = service.renderCoverHtml({
      documents: [],
      recipient,
      issuer,
      documentTitle: 'Credit note',
      documentNumber: 'INV-1-CN',
      documentDate: new Date('2026-11-25T10:00:00Z'),
      addressPosition: 'right',
      coverPage: true,
      duplex: false,
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Forepath &lt;GmbH&gt;, Weg 1, 10115 Berlin');
    expect(html).toContain('class="window right"');
    expect(html).toContain('2026-11-25');
    expect(html).toContain('FRANCE');
  });

  it('leaves the zone above the address empty for providers that print their own sender block', () => {
    const html = service.renderCoverHtml({
      documents: [],
      recipient,
      issuer,
      documentTitle: 'Invoice',
      documentNumber: 'INV-1',
      addressPosition: 'left',
      coverPage: true,
      duplex: false,
      returnAddress: false,
    });

    expect(html).not.toContain('class="return-address"');
    expect(html).toContain('Rue 2');
  });

  it('formats domestic addresses without the country line', () => {
    expect(formatRecipientLines({ ...recipient, country: 'DE' }, 'DE')).toEqual([
      'Acme & Co <script>alert(1)</script>',
      'Rue 2',
      '75001 Paris',
    ]);
    expect(formatRecipientLines({ ...recipient, nameLines: ['x'.repeat(100)] }, 'FR')[0]).toHaveLength(60);
  });
});
