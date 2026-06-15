import { BadRequestException, NotFoundException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { InvoiceService } from './invoice.service';
import { TaxCalculationService } from './tax-calculation.service';
import { TaxRateConfigService } from './tax-rate-config.service';

describe('InvoiceService', () => {
  const invoicesRepository = {
    create: jest.fn(),
    findByIdAndSubscriptionId: jest.fn(),
    update: jest.fn(),
  };
  const invoiceLineItemsRepository = {
    createMany: jest.fn(),
    findByInvoiceId: jest.fn(),
  };
  const customerProfilesRepository = {
    findByUserId: jest.fn(),
  };
  const subscriptionsRepository = {
    findById: jest.fn(),
  };
  const servicePlansRepository = {
    findById: jest.fn(),
  };
  const taxCalculationService = new TaxCalculationService(new TaxRateConfigService());
  const invoiceIssuanceService = {
    issueDraft: jest.fn(),
  };
  const invoicePdfService = {
    readPdf: jest.fn(),
    generateAndStore: jest.fn(),
    generateVoidDocumentAndStore: jest.fn(),
  };
  const invoiceVoidDocumentsRepository = {
    findByInvoiceId: jest.fn(),
    create: jest.fn(),
  };
  const billingIssuerConfig = {
    assertConfigured: jest.fn(),
    getConfig: jest.fn().mockReturnValue({
      name: 'Issuer',
      vatId: 'DE123',
      addressLine1: 'Street 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
    }),
  };
  const invoiceEmailService = {
    notifyVoidDocument: jest.fn(),
  };
  const auditLog = {
    log: jest.fn(),
  };
  const service = new InvoiceService(
    invoicesRepository as never,
    invoiceLineItemsRepository as never,
    customerProfilesRepository as never,
    subscriptionsRepository as never,
    servicePlansRepository as never,
    taxCalculationService,
    invoiceIssuanceService as never,
    invoicePdfService as never,
    invoiceVoidDocumentsRepository as never,
    invoiceEmailService as never,
    billingIssuerConfig as never,
    auditLog as never,
  );
  const subscriptionId = 'sub-1';
  const userId = 'user-1';

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BILLING_TAX_RATE_STANDARD = '19';
    process.env.BILLING_TAX_RATE_REDUCED = '7';
    delete process.env.BILLING_SKIP_FILE_CACHE;
    subscriptionsRepository.findById.mockResolvedValue({
      id: subscriptionId,
      planId: 'plan-1',
      number: 'SUB-2026-00001',
      currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
    });
    servicePlansRepository.findById.mockResolvedValue({
      id: 'plan-1',
      billingIntervalType: 'month',
      billingIntervalValue: 1,
    });
  });

  describe('createAndIssue', () => {
    it('creates draft then issues invoice', async () => {
      const draft = { id: 'inv-1', subscriptionId, userId, status: InvoiceStatus.DRAFT } as InvoiceEntity;

      invoicesRepository.create.mockResolvedValue(draft);
      invoiceLineItemsRepository.createMany.mockResolvedValue([]);
      invoiceIssuanceService.issueDraft.mockResolvedValue({
        id: 'inv-1',
        invoiceNumber: 'INV-2026-00001',
      });

      const result = await service.createAndIssue({
        subscriptionId,
        userId,
        lineInputs: [{ description: 'Plan', quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.STANDARD }],
      });

      expect(result).toEqual({ invoiceRefId: 'inv-1', invoiceNumber: 'INV-2026-00001' });
      expect(invoiceIssuanceService.issueDraft).toHaveBeenCalledWith('inv-1');
    });
  });

  describe('voidInvoice', () => {
    it('voids issued invoice and stores credit note PDF', async () => {
      const invoice = {
        id: 'inv-1',
        subscriptionId,
        userId,
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.ISSUED,
        balanceDue: 119,
      } as InvoiceEntity;

      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue(invoice);
      invoiceVoidDocumentsRepository.findByInvoiceId.mockResolvedValue(null);
      invoiceLineItemsRepository.findByInvoiceId.mockResolvedValue([]);
      customerProfilesRepository.findByUserId.mockResolvedValue({ userId, firstName: 'A' });
      invoicePdfService.generateVoidDocumentAndStore.mockResolvedValue({
        storageKey: 'sub-1/inv-1-void.pdf',
        documentNumber: 'INV-2026-00001-CN',
      });
      invoicesRepository.update.mockResolvedValue({ ...invoice, status: InvoiceStatus.VOID, balanceDue: 0 });

      const result = await service.voidInvoice('inv-1', subscriptionId, 'admin-1');

      expect(result.status).toBe(InvoiceStatus.VOID);
      expect(invoicePdfService.generateVoidDocumentAndStore).toHaveBeenCalled();
      expect(invoiceVoidDocumentsRepository.create).toHaveBeenCalledWith({
        invoiceId: 'inv-1',
        documentNumber: 'INV-2026-00001-CN',
        pdfStorageKey: 'sub-1/inv-1-void.pdf',
      });
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'invoice.void' }));
      expect(invoiceEmailService.notifyVoidDocument).toHaveBeenCalledWith(
        invoice,
        'sub-1/inv-1-void.pdf',
        'INV-2026-00001-CN',
      );
    });

    it('does not resend void document email when void document already exists', async () => {
      const invoice = {
        id: 'inv-1',
        subscriptionId,
        userId,
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.ISSUED,
      } as InvoiceEntity;

      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue(invoice);
      invoiceVoidDocumentsRepository.findByInvoiceId.mockResolvedValue({
        documentNumber: 'INV-2026-00001-CN',
        pdfStorageKey: 'sub-1/inv-1-void.pdf',
      });
      invoicesRepository.update.mockResolvedValue({ ...invoice, status: InvoiceStatus.VOID });

      await service.voidInvoice('inv-1', subscriptionId);

      expect(invoiceEmailService.notifyVoidDocument).not.toHaveBeenCalled();
    });

    it('throws when invoice not found', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue(null);

      await expect(service.voidInvoice('inv-1', subscriptionId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when invoice has no invoice number', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId,
        status: InvoiceStatus.ISSUED,
      });

      await expect(service.voidInvoice('inv-1', subscriptionId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when invoice is paid', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId,
        status: InvoiceStatus.PAID,
      });

      await expect(service.voidInvoice('inv-1', subscriptionId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns invoice unchanged when already void', async () => {
      const voided = { id: 'inv-1', subscriptionId, status: InvoiceStatus.VOID } as InvoiceEntity;

      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue(voided);

      const result = await service.voidInvoice('inv-1', subscriptionId);

      expect(result).toBe(voided);
      expect(invoicesRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('mapToResponse', () => {
    it('sets capability flags from invoice state', () => {
      const response = service.mapToResponse({
        id: 'inv-1',
        subscriptionId,
        status: InvoiceStatus.ISSUED,
        balanceDue: 50,
        pdfStorageKey: 'sub-1/inv-1.pdf',
        createdAt: new Date(),
      } as InvoiceEntity);

      expect(response.canPay).toBe(true);
      expect(response.canDownload).toBe(true);
      expect(response.canPreview).toBe(true);
      expect(response.canDownloadVoidDocument).toBe(false);
    });

    it('exposes void document capability for voided invoices', () => {
      const response = service.mapToResponse({
        id: 'inv-1',
        subscriptionId,
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.VOID,
        balanceDue: 0,
        createdAt: new Date(),
      } as InvoiceEntity);

      expect(response.canDownloadVoidDocument).toBe(true);
      expect(response.voidDocumentNumber).toBe('INV-2026-00001-CN');
    });

    it('allows download for issued invoices without stored PDF key', () => {
      const response = service.mapToResponse({
        id: 'inv-1',
        subscriptionId,
        status: InvoiceStatus.ISSUED,
        balanceDue: 50,
        createdAt: new Date(),
      } as InvoiceEntity);

      expect(response.canDownload).toBe(true);
    });
  });

  describe('getPdfBuffer', () => {
    it('reads PDF when storage key exists', async () => {
      const buffer = Buffer.from('pdf');

      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId,
        pdfStorageKey: 'sub-1/inv-1.pdf',
      });
      invoicePdfService.readPdf.mockResolvedValue(buffer);

      await expect(service.getPdfBuffer('inv-1', subscriptionId)).resolves.toBe(buffer);
    });

    it('regenerates PDF when BILLING_SKIP_FILE_CACHE is true', async () => {
      const buffer = Buffer.from('regenerated');

      process.env.BILLING_SKIP_FILE_CACHE = 'true';
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId,
        userId,
        status: InvoiceStatus.ISSUED,
        pdfStorageKey: 'sub-1/inv-1.pdf',
      });
      invoiceLineItemsRepository.findByInvoiceId.mockResolvedValue([]);
      customerProfilesRepository.findByUserId.mockResolvedValue({ userId, firstName: 'A' });
      invoicePdfService.generateAndStore.mockResolvedValue('sub-1/inv-1.pdf');
      invoicePdfService.readPdf.mockResolvedValue(buffer);
      invoicesRepository.update.mockResolvedValue({});

      await expect(service.getPdfBuffer('inv-1', subscriptionId)).resolves.toBe(buffer);

      expect(invoicePdfService.generateAndStore).toHaveBeenCalled();
      expect(invoicePdfService.readPdf).toHaveBeenCalledTimes(1);
      expect(invoicePdfService.readPdf).toHaveBeenCalledWith('sub-1/inv-1.pdf');
    });

    it('generates PDF on demand when storage key is missing', async () => {
      const buffer = Buffer.from('pdf');

      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId,
        userId,
        status: InvoiceStatus.ISSUED,
        pdfStorageKey: null,
      });
      invoiceLineItemsRepository.findByInvoiceId.mockResolvedValue([]);
      customerProfilesRepository.findByUserId.mockResolvedValue({ userId, firstName: 'A' });
      invoicePdfService.generateAndStore.mockResolvedValue('sub-1/inv-1.pdf');
      invoicePdfService.readPdf.mockResolvedValue(buffer);
      invoicesRepository.update.mockResolvedValue({});

      await expect(service.getPdfBuffer('inv-1', subscriptionId)).resolves.toBe(buffer);
      expect(invoicePdfService.generateAndStore).toHaveBeenCalled();
      expect(invoicesRepository.update).toHaveBeenCalledWith('inv-1', { pdfStorageKey: 'sub-1/inv-1.pdf' });
    });

    it('throws when invoice is draft', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId,
        status: InvoiceStatus.DRAFT,
      });

      await expect(service.getPdfBuffer('inv-1', subscriptionId)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getVoidPdfBuffer', () => {
    it('reads stored void document PDF', async () => {
      const buffer = Buffer.from('void-pdf');

      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId,
        userId,
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.VOID,
        voidedAt: new Date('2026-06-10'),
      });
      invoiceVoidDocumentsRepository.findByInvoiceId.mockResolvedValue({
        pdfStorageKey: 'sub-1/inv-1-void.pdf',
      });
      invoicePdfService.readPdf.mockResolvedValue(buffer);

      await expect(service.getVoidPdfBuffer('inv-1', subscriptionId)).resolves.toBe(buffer);
    });

    it('throws when invoice is not void', async () => {
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: 'inv-1',
        subscriptionId,
        status: InvoiceStatus.ISSUED,
      });

      await expect(service.getVoidPdfBuffer('inv-1', subscriptionId)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
