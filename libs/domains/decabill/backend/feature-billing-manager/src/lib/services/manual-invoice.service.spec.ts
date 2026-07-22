import { BadRequestException, NotFoundException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';

import { ManualInvoiceService } from './manual-invoice.service';

describe('ManualInvoiceService', () => {
  const invoicesRepository = {
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const invoiceLineItemsRepository = {
    deleteByInvoiceId: jest.fn(),
    createMany: jest.fn(),
  };
  const subscriptionsRepository = { findByIdOrThrow: jest.fn() };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const invoiceService = { createDraft: jest.fn(), getDetailById: jest.fn() };
  const invoiceIssuanceService = { issueDraft: jest.fn() };
  const taxCalculationService = {
    computeLines: jest.fn().mockReturnValue({
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      lines: [
        {
          description: 'Item',
          quantity: 1,
          unitPriceNet: 100,
          taxCategory: TaxCategory.STANDARD,
          taxRate: 0.19,
          lineNet: 100,
          lineTax: 19,
          lineGross: 119,
        },
      ],
    }),
  };
  const customerProfilesService = {
    getByUserId: jest.fn(),
    isProfileComplete: jest.fn(),
  };
  const auditLog = { log: jest.fn() };
  const invoiceTaxContextService = {
    resolveForUser: jest.fn().mockResolvedValue({
      treatment: {
        taxMode: 'domestic_vat',
        taxCountryCode: 'DE',
        chargeVat: true,
        invoiceNote: '',
        einvoiceTaxCategoryCode: 'S',
        issuerIsInEu: true,
      },
      forceChargeNonEuIssuerEuB2b: false,
      buyerVatId: null,
      buyerCountry: 'DE',
      buyerCustomerType: 'consumer',
      issuerCountry: 'DE',
    }),
  };

  const service = new ManualInvoiceService(
    invoicesRepository as never,
    invoiceLineItemsRepository as never,
    subscriptionsRepository as never,
    usersRepository as never,
    invoiceService as never,
    invoiceIssuanceService as never,
    taxCalculationService as never,
    customerProfilesService as never,
    auditLog as never,
    invoiceTaxContextService as never,
  );

  const draftInvoice = {
    id: 'inv-1',
    userId: 'user-1',
    status: InvoiceStatus.DRAFT,
    subscriptionId: undefined,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    invoiceService.createDraft.mockResolvedValue(draftInvoice);
    invoiceService.getDetailById.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      status: InvoiceStatus.DRAFT,
      lineItems: [],
      taxBreakdown: [],
    });
    invoiceTaxContextService.resolveForUser.mockResolvedValue({
      treatment: {
        taxMode: 'domestic_vat',
        taxCountryCode: 'DE',
        chargeVat: true,
        invoiceNote: '',
        einvoiceTaxCategoryCode: 'S',
        issuerIsInEu: true,
      },
      forceChargeNonEuIssuerEuB2b: false,
      buyerVatId: null,
      buyerCountry: 'DE',
      buyerCustomerType: 'consumer',
      issuerCountry: 'DE',
    });
    taxCalculationService.computeLines.mockReturnValue({
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      lines: [
        {
          description: 'Item',
          quantity: 1,
          unitPriceNet: 100,
          taxCategory: TaxCategory.STANDARD,
          taxRate: 0.19,
          lineNet: 100,
          lineTax: 19,
          lineGross: 119,
        },
      ],
    });
  });

  it('createDraft validates user exists', async () => {
    usersRepository.findByIdForTenant.mockResolvedValue(null);

    await expect(
      service.createDraft(
        {
          userId: 'user-1',
          lineItems: [{ description: 'Test', quantity: 1, unitPriceNet: 10 }],
        },
        'admin-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('createDraft validates subscription ownership', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', userId: 'other-user' });

    await expect(
      service.createDraft(
        {
          userId: 'user-1',
          subscriptionId: 'sub-1',
          lineItems: [{ description: 'Test', quantity: 1, unitPriceNet: 10 }],
        },
        'admin-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('updateDraft rejects non-draft invoices', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({ ...draftInvoice, status: InvoiceStatus.ISSUED });

    await expect(
      service.updateDraft('inv-1', { lineItems: [{ description: 'Test', quantity: 1, unitPriceNet: 10 }] }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('issueDraft requires complete customer profile', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(draftInvoice);
    customerProfilesService.getByUserId.mockResolvedValue(null);
    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await expect(service.issueDraft('inv-1', 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('deleteDraft removes draft invoice', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(draftInvoice);

    await service.deleteDraft('inv-1', 'admin-1');

    expect(invoiceLineItemsRepository.deleteByInvoiceId).toHaveBeenCalledWith('inv-1');
    expect(invoicesRepository.delete).toHaveBeenCalledWith('inv-1');
  });

  it('createDraft creates manual invoice and returns detail', async () => {
    const result = await service.createDraft(
      {
        userId: 'user-1',
        lineItems: [{ description: 'Consulting', quantity: 1, unitPriceNet: 100 }],
      },
      'admin-1',
    );

    expect(result.id).toBe('inv-1');
    expect(invoiceService.createDraft).toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'invoice.manual_create' }));
  });

  it('createDraft forwards reduced tax category on line items', async () => {
    await service.createDraft(
      {
        userId: 'user-1',
        lineItems: [{ description: 'Books', quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.REDUCED }],
      },
      'admin-1',
    );

    expect(invoiceService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        lineInputs: [expect.objectContaining({ taxCategory: TaxCategory.REDUCED })],
      }),
    );
  });

  it('updateDraft updates line items and totals', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(draftInvoice);
    invoicesRepository.update.mockResolvedValue({ ...draftInvoice, totalGross: 119 });

    const result = await service.updateDraft(
      'inv-1',
      { lineItems: [{ description: 'Updated', quantity: 1, unitPriceNet: 100 }] },
      'admin-1',
    );

    expect(result.id).toBe('inv-1');
    expect(invoiceLineItemsRepository.createMany).toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'invoice.manual_update' }));
  });

  it('issueDraft issues draft when profile is complete', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(draftInvoice);
    customerProfilesService.getByUserId.mockResolvedValue({ userId: 'user-1' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);

    const result = await service.issueDraft('inv-1', 'admin-1', { dueInDays: 7 });

    expect(invoiceIssuanceService.issueDraft).toHaveBeenCalledWith('inv-1', 7);
    expect(result.id).toBe('inv-1');
  });

  it('getDetail enriches response with user email', async () => {
    invoiceService.getDetailById.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      status: InvoiceStatus.DRAFT,
      lineItems: [],
      taxBreakdown: [],
    });

    const result = await service.getDetail('inv-1');

    expect(result.userEmail).toBe('user@example.com');
  });
});
