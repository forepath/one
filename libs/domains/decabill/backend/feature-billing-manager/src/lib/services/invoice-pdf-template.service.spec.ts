import { DeliveryTermsCode } from '../constants/document-terms.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { resetInvoicePdfTemplateCacheForTests } from '../templates/invoice-pdf-template.loader';
import { buildEpcQrDataUri } from '../utils/epc-qr.util';

import {
  buildCreditNotePdfPresentation,
  buildInvoicePdfPresentation,
  buildPartialCreditNotePdfPresentation,
} from './invoice-pdf-presentation.util';
import { InvoicePdfTemplateService } from './invoice-pdf-template.service';

jest.mock('../utils/epc-qr.util', () => {
  const actual = jest.requireActual('../utils/epc-qr.util');

  return { ...actual, buildEpcQrDataUri: jest.fn(actual.buildEpcQrDataUri) };
});

describe('InvoicePdfTemplateService', () => {
  const service = new InvoicePdfTemplateService();

  beforeEach(() => {
    resetInvoicePdfTemplateCacheForTests();
  });
  const invoice = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    invoiceNumber: 'INV-2026-00001',
    status: InvoiceStatus.ISSUED,
    currency: 'EUR',
    subtotalNet: 100,
    taxTotal: 19,
    totalGross: 119,
    balanceDue: 119,
    issuedAt: new Date('2026-06-01'),
    createdAt: new Date('2026-06-01'),
    dueDate: new Date('2026-06-15'),
  } as InvoiceEntity;
  const lineItems = [
    {
      position: 0,
      description: 'Service',
      quantity: 1,
      unitPriceNet: 100,
      taxRate: 19,
      lineNet: 100,
      lineTax: 19,
      lineGross: 119,
      taxCategory: TaxCategory.STANDARD,
    },
  ] as InvoiceLineItemEntity[];
  const issuer = {
    name: 'Acme GmbH',
    vatId: 'DE123',
    addressLine1: 'Street 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    email: 'billing@acme.test',
    bank: 'Example Bank',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
  };
  const buyer = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    addressLine1: '42 Computing Lane',
    postalCode: 'SW1A',
    city: 'London',
    country: 'GB',
  } as CustomerProfileEntity;

  it('buildViewModel maps invoice, issuer, buyer, and line items', () => {
    const viewModel = service.buildViewModel(invoice, lineItems, issuer, buyer);

    expect(viewModel).toMatchObject({
      documentTitle: 'Invoice',
      documentNumberLabel: 'Invoice number',
      invoiceNumber: 'INV-2026-00001',
      showDueDate: true,
      showBalanceDue: true,
      issueDate: '2026-06-01',
      dueDate: '2026-06-15',
      statusLabel: 'issued',
      currency: 'EUR',
      subtotalNet: '100.00',
      taxTotal: '19.00',
      totalGross: '119.00',
      balanceDue: '119.00',
      issuer: {
        name: 'Acme GmbH',
        vatId: 'DE123',
        email: 'billing@acme.test',
      },
      buyer: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      },
      paymentDetails: {
        bank: 'Example Bank',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
      },
    });
    expect(viewModel.lineItems[0]).toMatchObject({
      position: 1,
      description: 'Service',
      lineGross: '119.00',
    });
  });

  it('buildViewModel handles decimal columns returned as strings', () => {
    const stringLineItems = [
      {
        position: 0,
        description: 'Service',
        quantity: '1',
        unitPriceNet: '100.0000',
        taxRate: '19.0000',
        lineNet: '100.0000',
        lineTax: '19.0000',
        lineGross: '119.0000',
        taxCategory: TaxCategory.STANDARD,
      },
    ] as unknown as InvoiceLineItemEntity[];
    const stringInvoice = {
      ...invoice,
      subtotalNet: '100.0000',
      taxTotal: '19.0000',
      totalGross: '119.0000',
      balanceDue: '119.0000',
    } as unknown as InvoiceEntity;
    const viewModel = service.buildViewModel(stringInvoice, stringLineItems, issuer, buyer);

    expect(viewModel.totalGross).toBe('119.00');
    expect(viewModel.lineItems[0].lineNet).toBe('100.00');
  });

  it('buildHtml includes neutral print palette and invoice content', () => {
    const html = service.buildHtml(invoice, lineItems, issuer, buyer);

    expect(html).toContain('--surface-subtle: #f4f4f4');
    expect(html).toContain('Plus Jakarta Sans');
    expect(html).toContain('INV-2026-00001');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Germany');
    expect(html).toContain('United Kingdom');
    expect(html).toContain('DE89370400440532013000');
    expect(html).toContain('COBADEFFXXX');
    expect(html).toContain('Payment details');
    expect(html).toContain('<td class="num">100.00 EUR</td>');
    expect(html).toContain('<td class="num">119.00 EUR</td>');
  });

  it('prints the second address line of issuer and buyer between street and city', () => {
    const viewModel = service.buildViewModel(invoice, lineItems, { ...issuer, addressLine2: 'Building B' }, {
      ...buyer,
      addressLine2: 'Floor 3',
    } as CustomerProfileEntity);

    expect(viewModel.issuer.lines).toEqual(['Street 1', 'Building B', '10115 Berlin', 'Germany']);
    expect(viewModel.buyer.lines).toEqual(['42 Computing Lane', 'Floor 3', 'SW1A London', 'United Kingdom']);
  });

  it('skips empty second address lines', () => {
    const viewModel = service.buildViewModel(invoice, lineItems, { ...issuer, addressLine2: '  ' }, {
      ...buyer,
      addressLine2: null,
    } as unknown as CustomerProfileEntity);

    expect(viewModel.issuer.lines).toEqual(['Street 1', '10115 Berlin', 'Germany']);
    expect(viewModel.buyer.lines).toEqual(['42 Computing Lane', 'SW1A London', 'United Kingdom']);
  });

  it('escapes the second address lines', () => {
    const html = service.buildHtml(invoice, lineItems, { ...issuer, addressLine2: '<img src=x onerror=alert(1)>' }, {
      ...buyer,
      addressLine2: '<script>alert(2)</script>',
    } as CustomerProfileEntity);

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('buildHtml escapes user-controlled content', () => {
    const maliciousBuyer = {
      ...buyer,
      company: '<script>alert(1)</script>',
    } as CustomerProfileEntity;
    const html = service.buildHtml(invoice, lineItems, issuer, maliciousBuyer);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('buildHtml renders credit note without payment details or balance due', () => {
    const voidedAt = new Date('2026-06-10');
    const presentation = buildCreditNotePdfPresentation('INV-2026-00001-CN', voidedAt, 'INV-2026-00001');
    const html = service.buildHtml(invoice, lineItems, issuer, buyer, presentation);

    expect(html).toContain('Credit note');
    expect(html).toContain('INV-2026-00001-CN');
    expect(html).toContain('Original invoice');
    expect(html).toContain('INV-2026-00001');
    expect(html).not.toContain('Payment details');
    expect(html).not.toContain('Balance due');
    expect(html).not.toContain('DE89370400440532013000');
  });

  it('omits payment details when bank info is not configured', () => {
    const html = service.buildHtml(
      invoice,
      lineItems,
      { ...issuer, bank: undefined, iban: undefined, bic: undefined },
      buyer,
    );

    expect(html).not.toContain('Payment details');
  });

  describe('payment / delivery terms and service period', () => {
    const termsInvoice = {
      ...invoice,
      paymentDueDays: 14,
      deliveryTermsCode: DeliveryTermsCode.CUSTOM,
      deliveryTermsPlace: null,
      deliveryTermsText: 'Line one\n<b>Online</b> access',
    } as InvoiceEntity;
    const period = { periodStart: new Date('2026-05-01T00:00:00Z'), periodEnd: new Date('2026-06-01T00:00:00Z') };

    it('prints service period, payment and delivery terms on invoices', () => {
      const html = service.buildHtml(
        termsInvoice,
        lineItems,
        issuer,
        buyer,
        buildInvoicePdfPresentation(termsInvoice, { servicePeriod: period }),
      );

      expect(html).toContain('Service period');
      expect(html).toContain('2026-05-01 – 2026-06-01');
      expect(html).toContain('Payment terms');
      expect(html).toContain('Payable within 14 days of the invoice date without deduction.');
      expect(html).toContain('Delivery terms');
      expect(html).toContain('&lt;b&gt;Online&lt;/b&gt; access');
      expect(html).not.toContain('<b>Online</b>');
    });

    it('puts the RF reference into the QR only with accounting (bank reconciliation) enabled', () => {
      const withRef = { ...termsInvoice, paymentReference: 'RF18539007547034' } as InvoiceEntity;
      const presentation = buildInvoicePdfPresentation(withRef, { includePaymentQr: true });
      const qr = buildEpcQrDataUri as jest.Mock;

      service.buildViewModel(withRef, lineItems, issuer, buyer, presentation);
      expect(qr).toHaveBeenLastCalledWith(expect.objectContaining({ creditorReference: undefined }));

      new InvoicePdfTemplateService({ isEnabled: () => true } as never).buildViewModel(
        withRef,
        lineItems,
        issuer,
        buyer,
        presentation,
      );
      expect(qr).toHaveBeenLastCalledWith(expect.objectContaining({ creditorReference: 'RF18539007547034' }));
    });

    it('prints a SEPA payment QR on open EUR invoices only when opted in', () => {
      const withQr = service.buildViewModel(
        termsInvoice,
        lineItems,
        issuer,
        buyer,
        buildInvoicePdfPresentation(termsInvoice, { includePaymentQr: true }),
      );
      const html = service.buildHtml(
        termsInvoice,
        lineItems,
        issuer,
        buyer,
        buildInvoicePdfPresentation(termsInvoice, { includePaymentQr: true }),
      );

      expect(withQr.epcQrDataUri).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(html).toContain('alt="SEPA payment QR code"');
      expect(service.buildViewModel(termsInvoice, lineItems, issuer, buyer).epcQrDataUri).toBeUndefined();
      expect(
        service.buildViewModel(
          termsInvoice,
          lineItems,
          issuer,
          buyer,
          buildInvoicePdfPresentation(termsInvoice, { includePaymentQr: true, zeroBalancePromotional: true }),
        ).epcQrDataUri,
      ).toBeUndefined();
      expect(
        service.buildViewModel(
          termsInvoice,
          lineItems,
          issuer,
          buyer,
          buildCreditNotePdfPresentation('INV-2026-00001-CN', new Date('2026-06-02'), 'INV-2026-00001'),
        ).epcQrDataUri,
      ).toBeUndefined();
      expect(
        service.buildViewModel(
          { ...termsInvoice, currency: 'USD' } as InvoiceEntity,
          lineItems,
          issuer,
          buyer,
          buildInvoicePdfPresentation(termsInvoice, { includePaymentQr: true }),
        ).epcQrDataUri,
      ).toBeUndefined();
    });

    it('labels a single-day period as service date', () => {
      const day = new Date('2026-06-01T10:00:00Z');
      const viewModel = service.buildViewModel(
        termsInvoice,
        lineItems,
        issuer,
        buyer,
        buildInvoicePdfPresentation(termsInvoice, { servicePeriod: { periodStart: day, periodEnd: day } }),
      );

      expect(viewModel).toMatchObject({ servicePeriodLabel: 'Service date', servicePeriod: '2026-06-01' });
    });

    it('omits the terms section for legacy invoices without terms', () => {
      const html = service.buildHtml(invoice, lineItems, issuer, buyer);

      expect(html).not.toContain('Payment terms');
      expect(html).not.toContain('Delivery terms');
    });

    it('prints settlement terms instead of invoice terms on partial credit notes', () => {
      const viewModel = service.buildViewModel(
        termsInvoice,
        lineItems,
        issuer,
        buyer,
        buildPartialCreditNotePdfPresentation('INV-2026-00001-CN-x', new Date('2026-06-02'), 'INV-2026-00001', 11.9),
      );

      expect(viewModel.paymentTerms).toContain('Offset against the open balance of invoice INV-2026-00001');
      expect(viewModel.deliveryTerms).toBeUndefined();
      expect(viewModel.showDocumentTerms).toBe(true);
    });

    it('omits terms on credit notes', () => {
      const viewModel = service.buildViewModel(
        termsInvoice,
        lineItems,
        issuer,
        buyer,
        buildCreditNotePdfPresentation('INV-2026-00001-CN', new Date('2026-06-02'), 'INV-2026-00001', period),
      );

      expect(viewModel.showDocumentTerms).toBe(false);
      expect(viewModel.paymentTerms).toBeUndefined();
      expect(viewModel.servicePeriod).toBe('2026-05-01 – 2026-06-01');
    });
  });

  describe('document note', () => {
    const notedInvoice = { ...invoice, note: 'Line one\n<b>Line two</b> & more' } as InvoiceEntity;

    it('prints the invoice note escaped with its line breaks', () => {
      const html = service.buildHtml(notedInvoice, lineItems, issuer, buyer);

      expect(html).toContain('<h2 class="box-heading">Notes</h2>');
      expect(html).toContain('<p class="document-note">Line one\n&lt;b&gt;Line two&lt;/b&gt; &amp; more</p>');
      expect(html).not.toContain('<b>Line two</b>');
    });

    it('prints the note on promotional zero-balance invoices', () => {
      const viewModel = service.buildViewModel(
        notedInvoice,
        lineItems,
        issuer,
        buyer,
        buildInvoicePdfPresentation(notedInvoice, { zeroBalancePromotional: true }),
      );

      expect(viewModel.note).toBe('Line one\n<b>Line two</b> & more');
    });

    it('omits the notes section without a note', () => {
      expect(service.buildHtml(invoice, lineItems, issuer, buyer)).not.toContain('>Notes</h2>');
      expect(service.buildViewModel({ ...invoice, note: ' \n ' } as InvoiceEntity, lineItems, issuer, buyer).note).toBe(
        undefined,
      );
    });

    it('prints the credit note note instead of the invoice note on void credit notes', () => {
      const withNote = service.buildViewModel(
        notedInvoice,
        lineItems,
        issuer,
        buyer,
        buildCreditNotePdfPresentation(
          'INV-2026-00001-CN',
          new Date('2026-06-02'),
          'INV-2026-00001',
          undefined,
          'Cancelled',
        ),
      );
      const withoutNote = service.buildViewModel(
        notedInvoice,
        lineItems,
        issuer,
        buyer,
        buildCreditNotePdfPresentation('INV-2026-00001-CN', new Date('2026-06-02'), 'INV-2026-00001'),
      );

      expect(withNote.note).toBe('Cancelled');
      expect(withoutNote.note).toBeUndefined();
    });

    it('never prints the invoice note on partial credit notes', () => {
      const viewModel = service.buildViewModel(
        notedInvoice,
        lineItems,
        issuer,
        buyer,
        buildPartialCreditNotePdfPresentation('INV-2026-00001-CN-x', new Date('2026-06-02'), 'INV-2026-00001', 11.9),
      );

      expect(viewModel.note).toBeUndefined();
    });
  });

  describe('document branding', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAAA';
    const branded = new InvoicePdfTemplateService(undefined, {
      getBranding: () => ({ logoDataUri: logo, accentColor: '#1d4ed8' }),
    } as never);

    it('prints the Decabill accent and no logo without configuration', () => {
      const html = service.buildHtml(invoice, lineItems, issuer, buyer);

      expect(service.buildViewModel(invoice, lineItems, issuer, buyer).branding).toEqual({ accentColor: '#32a852' });
      expect(html).toContain('--accent: #32a852;');
      expect(html).not.toContain('class="header-logo"');
    });

    it('prints the configured logo and accent', () => {
      const html = branded.buildHtml(invoice, lineItems, issuer, buyer);

      expect(html).toContain('--accent: #1d4ed8;');
      // Only the document type (header title) takes the brand color; other text, borders and rules stay neutral.
      expect(html.match(/var\(--accent\)/g)).toHaveLength(1);
      expect(html).toMatch(/\.header-title \{[^}]*color: var\(--accent\);/);
      // Handlebars escapes "=" in attributes; the browser decodes it again.
      expect(html).toContain(
        '<img class="header-logo" src="data:image/png;base64,iVBORw0KGgoAAAAA" alt="Acme GmbH" />',
      );
    });

    it('prints the brand color but not the own logo on supplier invoice copies', () => {
      const presentation = { ...buildInvoicePdfPresentation(invoice), ownLogo: false };
      const html = branded.buildHtml(invoice, lineItems, issuer, buyer, presentation);

      expect(branded.buildViewModel(invoice, lineItems, issuer, buyer, presentation).branding).toEqual({
        accentColor: '#1d4ed8',
      });
      expect(html).toContain('--accent: #1d4ed8;');
      expect(html).not.toContain(logo);
      expect(html).not.toContain('class="header-logo"');
    });
  });
});
