import type { SupplierInvoiceEntity } from '../entities/supplier-invoice.entity';
import type { SupplierProfileEntity } from '../entities/supplier-profile.entity';

import type { BillingIssuerConfig } from './billing-issuer-config.service';
import { InvoicePdfHtmlRendererService } from './invoice-pdf-html-renderer.service';
import { InvoicePdfTemplateService } from './invoice-pdf-template.service';
import { SupplierInvoicePdfService } from './supplier-invoice-pdf.service';

describe('SupplierInvoicePdfService', () => {
  const recipient: BillingIssuerConfig = {
    name: 'Own Company GmbH',
    vatId: 'DE999',
    addressLine1: 'Own Street 1',
    postalCode: '20095',
    city: 'Hamburg',
    country: 'DE',
  };
  const supplier = {
    id: 'sup-1',
    tenantId: 'tenant-1',
    supplierNumber: 'S-0001',
    company: 'Supplier AG',
    addressLine1: 'Supplier Street 5',
    addressLine2: 'Hinterhaus',
    postalCode: '80331',
    city: 'München',
    country: 'DE',
  } as SupplierProfileEntity;
  const invoice = {
    id: 'si-1',
    supplierId: 'sup-1',
    invoiceNumber: 'SUP-1',
    currency: 'EUR',
    subtotalNet: 10,
    taxTotal: 1.9,
    totalGross: 11.9,
    balanceDue: 11.9,
    issueDate: new Date('2026-06-01'),
    createdAt: new Date('2026-06-01'),
  } as unknown as SupplierInvoiceEntity;

  function setup() {
    const template = new InvoicePdfTemplateService();
    const buildHtml = jest.spyOn(template, 'buildHtml');
    const renderer = { renderHtmlToPdf: jest.fn().mockResolvedValue(new Uint8Array([1])) };
    const fileStorage = { writeSupplierInvoiceFile: jest.fn().mockResolvedValue(undefined) };
    const registry = { registerFromBuffer: jest.fn().mockResolvedValue(undefined) };
    const service = new SupplierInvoicePdfService(
      template,
      renderer as unknown as InvoicePdfHtmlRendererService,
      fileStorage as never,
      registry as never,
    );

    return { service, buildHtml, renderer };
  }

  it('prints both supplier address lines in the issuer block', async () => {
    const { service, buildHtml, renderer } = setup();

    await service.generateAndStore(invoice, [], supplier, recipient);

    expect(buildHtml.mock.calls[0][2]).toMatchObject({
      name: 'Supplier AG',
      addressLine1: 'Supplier Street 5',
      addressLine2: 'Hinterhaus',
    });

    const html = renderer.renderHtmlToPdf.mock.calls[0][0] as string;

    expect(html.indexOf('Supplier Street 5')).toBeLessThan(html.indexOf('Hinterhaus'));
    expect(html.indexOf('Hinterhaus')).toBeLessThan(html.indexOf('80331 München'));
  });

  it('omits a missing second supplier address line', async () => {
    const { service, buildHtml } = setup();

    await service.generateAndStore(invoice, [], { ...supplier, addressLine2: null } as never, recipient);

    expect(buildHtml.mock.calls[0][2].addressLine2).toBeUndefined();
  });
});
