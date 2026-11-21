import { EINVOICE_FORMATS, EInvoiceFormat } from '../constants/e-invoice-format.constants';

import { EInvoiceUblService } from './e-invoice-ubl.service';

describe('EInvoiceUblService', () => {
  const service = new EInvoiceUblService();
  const issuer = {
    name: 'Forepath GmbH',
    vatId: 'DE123456789',
    addressLine1: 'Str. 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
  };
  const buyer = {
    company: 'Acme BV',
    addressLine1: 'Weg 2',
    postalCode: '1011',
    city: 'Amsterdam',
    country: 'NL',
    vatId: 'NL123456789B01',
    email: 'ap@acme.example',
  };
  const invoice = {
    id: 'inv-1',
    invoiceNumber: 'INV-2026-00001',
    currency: 'EUR',
    subtotalNet: 100,
    taxTotal: 0,
    totalGross: 100,
    einvoiceTaxCategoryCode: 'AE',
    taxNote: 'Reverse charge',
    paymentReference: 'RF18539007547034',
    paymentDueDays: 14,
    dueDate: new Date('2026-03-24T00:00:00Z'),
  };
  const lines = [
    { position: 0, description: 'Cloud server', quantity: 1, unitPriceNet: 100, taxRate: 0, lineNet: 100, lineTax: 0 },
  ];
  const period = { periodStart: new Date('2026-03-01T00:00:00Z'), periodEnd: new Date('2026-03-31T00:00:00Z') };
  const options = {
    typeCode: '380' as const,
    documentId: 'INV-2026-00001',
    issueDate: new Date('2026-03-10T00:00:00Z'),
    duePayableAmount: 100,
    includePaymentMeans: true,
    includeDueDate: true,
  };

  it('builds a Peppol BIS 3.0 invoice with endpoints, RF payment id and totals', () => {
    const xml = service.build(
      EINVOICE_FORMATS[EInvoiceFormat.PEPPOL_BIS_3],
      invoice as never,
      lines as never,
      issuer as never,
      buyer as never,
      'PO-1',
      period,
      options,
    );

    expect(xml).toContain(
      '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>',
    );
    expect(xml).toContain('<cbc:EndpointID schemeID="9930">DE123456789</cbc:EndpointID>');
    expect(xml).toContain('<cbc:EndpointID schemeID="9944">NL123456789B01</cbc:EndpointID>');
    expect(xml).toContain('<cbc:PaymentID>RF18539007547034</cbc:PaymentID>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">100.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:ID>AE</cbc:ID>');
    expect(xml).not.toContain('<!DOCTYPE');
  });

  it('uses the CreditNote document for credit notes and references the invoice', () => {
    const xml = service.build(
      EINVOICE_FORMATS[EInvoiceFormat.UBL_EN16931],
      invoice as never,
      lines as never,
      issuer as never,
      buyer as never,
      'PO-1',
      period,
      {
        ...options,
        typeCode: '381',
        documentId: 'INV-2026-00001-CN',
        referencedInvoiceNumber: 'INV-2026-00001',
        includePaymentMeans: false,
      },
    );

    expect(xml).toContain('<CreditNote');
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toContain('<cac:CreditNoteLine>');
    expect(xml).toMatch(/<cac:InvoiceDocumentReference>\s*<cbc:ID>INV-2026-00001<\/cbc:ID>/);
  });

  it('requires an electronic address for Peppol when none can be derived', () => {
    expect(() =>
      service.build(
        EINVOICE_FORMATS[EInvoiceFormat.PEPPOL_BIS_3],
        invoice as never,
        lines as never,
        issuer as never,
        { ...buyer, vatId: null, email: null, country: 'US' } as never,
        'PO-1',
        period,
        options,
      ),
    ).toThrow(/EndpointID/);
  });

  it('escapes markup in free text', () => {
    const xml = service.build(
      EINVOICE_FORMATS[EInvoiceFormat.UBL_EN16931],
      invoice as never,
      [{ ...lines[0], description: '<script>x</script> & co' }] as never,
      issuer as never,
      buyer as never,
      'PO-1',
      period,
      options,
    );

    expect(xml).toContain('&lt;script&gt;x&lt;/script&gt; &amp; co');
  });
});
