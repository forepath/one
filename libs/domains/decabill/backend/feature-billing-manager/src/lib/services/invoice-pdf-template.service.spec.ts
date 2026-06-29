import { InvoiceStatus } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { resetInvoicePdfTemplateCacheForTests } from '../templates/invoice-pdf-template.loader';

import { buildCreditNotePdfPresentation } from './invoice-pdf-presentation.util';
import { InvoicePdfTemplateService } from './invoice-pdf-template.service';

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
});
