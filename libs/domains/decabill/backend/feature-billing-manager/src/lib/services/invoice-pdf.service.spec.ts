import { TaxCategory } from '../constants/tax-category.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { InvoiceLineItemEntity } from '../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { EInvoiceEmbedService } from './e-invoice-embed.service';
import { EInvoiceXmlService } from './e-invoice-xml.service';
import { InvoicePdfHtmlRendererService } from './invoice-pdf-html-renderer.service';
import { InvoicePdfTemplateService } from './invoice-pdf-template.service';
import { InvoicePdfService } from './invoice-pdf.service';

describe('InvoicePdfService', () => {
  const eInvoiceXmlService = new EInvoiceXmlService();
  const eInvoiceEmbedService = new EInvoiceEmbedService();
  const invoicePdfTemplateService = new InvoicePdfTemplateService();
  const invoicePdfHtmlRendererService = {
    renderHtmlToPdf: jest.fn(),
  } as unknown as InvoicePdfHtmlRendererService;
  const invoicePromotionApplicationsRepository = {
    hasApplicationsForInvoice: jest.fn().mockResolvedValue(false),
  };
  const fileStorage = {
    writeCustomerInvoiceFile: jest.fn().mockResolvedValue(undefined),
    readCustomerInvoiceFile: jest.fn(),
  };
  const storedFileRegistry = {
    isSigningEnabled: jest.fn().mockReturnValue(false),
    reserve: jest.fn(),
    registerFromBuffer: jest.fn().mockResolvedValue({}),
  };
  const service = new InvoicePdfService(
    eInvoiceXmlService,
    eInvoiceEmbedService,
    invoicePdfTemplateService,
    invoicePdfHtmlRendererService,
    invoicePromotionApplicationsRepository as never,
    fileStorage as never,
    storedFileRegistry as never,
  );
  const purchaseOrderReference = 'SUB-2026-00001';
  const invoicingPeriod = {
    periodStart: new Date('2026-05-01T00:00:00Z'),
    periodEnd: new Date('2026-06-01T00:00:00Z'),
  };
  const invoice = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    invoiceNumber: 'INV-2026-00001',
    currency: 'EUR',
    subtotalNet: 100,
    taxTotal: 19,
    totalGross: 119,
    balanceDue: 119,
    issuedAt: new Date('2026-06-01'),
    createdAt: new Date('2026-06-01'),
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
    name: 'Issuer',
    vatId: 'DE1',
    addressLine1: 'Street',
    postalCode: '1',
    city: 'City',
    country: 'DE',
  };
  const buyer = {
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.com',
    addressLine1: 'Buyer St 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
  } as CustomerProfileEntity;

  beforeEach(() => {
    jest.clearAllMocks();
    (invoicePdfHtmlRendererService.renderHtmlToPdf as jest.Mock).mockResolvedValue(new Uint8Array([1, 2, 3]));
    jest.spyOn(eInvoiceEmbedService, 'embedXmlInPdf').mockImplementation(async (pdfBytes) => pdfBytes);
  });

  describe('generateAndStore', () => {
    it('handles decimal columns returned as strings from the database', async () => {
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
      const storageKey = await service.generateAndStore(
        stringInvoice,
        stringLineItems,
        issuer,
        buyer,
        purchaseOrderReference,
        invoicingPeriod,
      );

      expect(storageKey).toBe('sub-1/inv-1.pdf');
      expect(invoicePdfHtmlRendererService.renderHtmlToPdf).toHaveBeenCalled();
      expect(fileStorage.writeCustomerInvoiceFile).toHaveBeenCalledWith('sub-1/inv-1.pdf', expect.any(Buffer));
    });

    it('writes PDF with embedded XML via file storage', async () => {
      const storageKey = await service.generateAndStore(
        invoice,
        lineItems,
        issuer,
        buyer,
        purchaseOrderReference,
        invoicingPeriod,
      );

      expect(storageKey).toBe('sub-1/inv-1.pdf');
      expect(invoicePdfHtmlRendererService.renderHtmlToPdf).toHaveBeenCalledWith(
        expect.stringContaining('INV-2026-00001'),
      );
      expect(fileStorage.writeCustomerInvoiceFile).toHaveBeenCalledWith('sub-1/inv-1.pdf', expect.any(Buffer));
    });

    it('writes manual invoice PDF under manual user folder when subscription is missing', async () => {
      const manualInvoice = {
        ...invoice,
        subscriptionId: undefined,
        userId: 'user-1',
      } as InvoiceEntity;
      const storageKey = await service.generateAndStore(manualInvoice, lineItems, issuer, buyer, '', invoicingPeriod);

      expect(storageKey).toBe('manual/user-1/inv-1.pdf');
      expect(fileStorage.writeCustomerInvoiceFile).toHaveBeenCalledWith('manual/user-1/inv-1.pdf', expect.any(Buffer));
    });
  });

  describe('generateVoidDocumentAndStore', () => {
    it('writes credit note PDF with embedded XML to separate storage key', async () => {
      const voidedAt = new Date('2026-06-10T12:00:00Z');
      const result = await service.generateVoidDocumentAndStore(
        invoice,
        voidedAt,
        lineItems,
        issuer,
        buyer,
        purchaseOrderReference,
        invoicingPeriod,
      );

      expect(result).toEqual({
        storageKey: 'sub-1/inv-1-void.pdf',
        documentNumber: 'INV-2026-00001-CN',
      });
      expect(invoicePdfHtmlRendererService.renderHtmlToPdf).toHaveBeenCalledWith(
        expect.stringMatching(/Credit note[\s\S]*INV-2026-00001-CN/),
      );
      expect(invoicePdfHtmlRendererService.renderHtmlToPdf).toHaveBeenCalledWith(
        expect.not.stringContaining('Payment details'),
      );
      expect(fileStorage.writeCustomerInvoiceFile).toHaveBeenCalledWith('sub-1/inv-1-void.pdf', expect.any(Buffer));
    });
  });

  describe('readPdf', () => {
    it('reads file via file storage', async () => {
      const buffer = Buffer.from('pdf');

      fileStorage.readCustomerInvoiceFile.mockResolvedValue(buffer);

      const result = await service.readPdf('sub-1/inv-1.pdf');

      expect(result).toBe(buffer);
      expect(fileStorage.readCustomerInvoiceFile).toHaveBeenCalledWith('sub-1/inv-1.pdf');
    });
  });
});
