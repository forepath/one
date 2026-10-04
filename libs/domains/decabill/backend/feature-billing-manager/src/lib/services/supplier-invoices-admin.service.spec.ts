import { BadRequestException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SupplierDocumentSource } from '../constants/supplier-document-source.constants';

import { SupplierInvoicesAdminService } from './supplier-invoices-admin.service';

describe('SupplierInvoicesAdminService', () => {
  const supplierInvoicesRepository = {
    findByIdOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findIdByInvoiceNumber: jest.fn().mockResolvedValue(null),
  };
  const supplierInvoiceLineItemsRepository = {
    findByInvoiceId: jest.fn(),
    createMany: jest.fn(),
    deleteByInvoiceId: jest.fn(),
  };
  const supplierProfilesRepository = { findByIdOrThrow: jest.fn() };
  const supplierProfilesService = { isProfileComplete: jest.fn() };
  const supplierContractsService = { getOrCreateByNumber: jest.fn() };
  const supplierInvoiceNumberSequencesRepository = { nextInvoiceNumber: jest.fn() };
  const taxCalculationService = {
    computeLines: jest.fn().mockReturnValue({
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      lines: [
        {
          description: 'Line',
          quantity: 1,
          unitPriceNet: 100,
          taxCategory: 'standard',
          taxRate: 19,
          lineNet: 100,
          lineTax: 19,
          lineGross: 119,
        },
      ],
      taxTreatment: { taxMode: 'domestic_vat', taxCountryCode: 'DE' },
      resolvedTaxRate: 19,
    }),
  };
  const billingIssuerConfigService = {
    getConfig: jest.fn().mockReturnValue({ country: 'DE' }),
    assertConfigured: jest.fn(),
  };
  const supplierInvoicePdfService = { generateAndStore: jest.fn().mockResolvedValue('generated.pdf') };
  const fileStorage = { writeSupplierInvoiceFile: jest.fn() };
  const auditLog = { log: jest.fn() };
  const billingNotificationPublisher = {
    publishSupplierInvoiceCreated: jest.fn(),
    publishSupplierInvoiceIssued: jest.fn(),
  };

  const service = new SupplierInvoicesAdminService(
    supplierInvoicesRepository as never,
    supplierInvoiceLineItemsRepository as never,
    supplierProfilesRepository as never,
    supplierProfilesService as never,
    supplierContractsService as never,
    supplierInvoiceNumberSequencesRepository as never,
    taxCalculationService as never,
    billingIssuerConfigService as never,
    supplierInvoicePdfService as never,
    fileStorage as never,
    auditLog as never,
    billingNotificationPublisher as never,
    { registerFromBuffer: jest.fn().mockResolvedValue({}) } as never,
  );

  const draftInvoice = {
    id: 'inv-1',
    supplierId: 'supplier-1',
    status: InvoiceStatus.DRAFT,
    currency: 'EUR',
    subtotalNet: 100,
    taxTotal: 19,
    totalGross: 119,
    balanceDue: 119,
    issueDate: '2026-01-15',
    dueDate: '2026-01-29',
    hasUploadedDocument: false,
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    supplierProfilesRepository.findByIdOrThrow.mockResolvedValue({ id: 'supplier-1', country: 'DE' });
    supplierInvoicesRepository.findByIdOrThrow.mockImplementation(async () => ({
      ...draftInvoice,
      lineItems: [{ description: 'Line', lineGross: 119, position: 0 }],
      supplier: { supplierNumber: 'SUP-000001', company: 'Acme' },
    }));
  });

  it('issue generates PDF when no uploaded document', async () => {
    supplierInvoicesRepository.update.mockResolvedValue({
      ...draftInvoice,
      status: InvoiceStatus.ISSUED,
      invoiceNumber: 'SINV-2026-00001',
      documentStorageKey: 'generated.pdf',
      documentSource: SupplierDocumentSource.GENERATED,
    });
    supplierInvoiceNumberSequencesRepository.nextInvoiceNumber.mockResolvedValue('SINV-2026-00001');

    await service.issue('inv-1', 'admin-1');

    expect(supplierInvoicePdfService.generateAndStore).toHaveBeenCalled();
    expect(billingNotificationPublisher.publishSupplierInvoiceIssued).toHaveBeenCalled();
  });

  it('issue skips PDF generation when document already uploaded', async () => {
    supplierInvoicesRepository.findByIdOrThrow.mockResolvedValue({
      ...draftInvoice,
      hasUploadedDocument: true,
      documentStorageKey: 'uploaded.pdf',
      documentSource: SupplierDocumentSource.UPLOADED,
      lineItems: [{ description: 'Line', lineGross: 119, position: 0 }],
      supplier: { supplierNumber: 'SUP-000001' },
    });
    supplierInvoicesRepository.update.mockResolvedValue({
      ...draftInvoice,
      status: InvoiceStatus.ISSUED,
      invoiceNumber: 'SINV-2026-00001',
      hasUploadedDocument: true,
      documentStorageKey: 'uploaded.pdf',
    });
    supplierInvoiceNumberSequencesRepository.nextInvoiceNumber.mockResolvedValue('SINV-2026-00001');

    await service.issue('inv-1', 'admin-1');

    expect(supplierInvoicePdfService.generateAndStore).not.toHaveBeenCalled();
  });

  it('issue uses manual invoice number and skips sequence', async () => {
    supplierInvoicesRepository.findByIdOrThrow.mockResolvedValue({
      ...draftInvoice,
      invoiceNumber: 'SUPPLIER-42',
      lineItems: [{ description: 'Line', lineGross: 119, position: 0 }],
      supplier: { supplierNumber: 'SUP-000001' },
    });
    supplierInvoicesRepository.findIdByInvoiceNumber.mockResolvedValue(null);
    supplierInvoicesRepository.update.mockResolvedValue({
      ...draftInvoice,
      status: InvoiceStatus.ISSUED,
      invoiceNumber: 'SUPPLIER-42',
      documentStorageKey: 'generated.pdf',
      documentSource: SupplierDocumentSource.GENERATED,
    });

    await service.issue('inv-1', 'admin-1');

    expect(supplierInvoiceNumberSequencesRepository.nextInvoiceNumber).not.toHaveBeenCalled();
    expect(supplierInvoicesRepository.update).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ invoiceNumber: 'SUPPLIER-42' }),
    );
  });

  it('issue rejects missing dates', async () => {
    supplierInvoicesRepository.findByIdOrThrow.mockResolvedValue({
      ...draftInvoice,
      issueDate: null,
      dueDate: null,
      lineItems: [{ description: 'Line' }],
      supplier: {},
    });

    await expect(service.issue('inv-1', 'admin-1')).rejects.toThrow(BadRequestException);
  });
});
