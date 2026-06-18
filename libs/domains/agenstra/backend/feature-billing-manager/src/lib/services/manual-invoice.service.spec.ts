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
  const usersRepository = { findById: jest.fn() };
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
  );

  const draftInvoice = {
    id: 'inv-1',
    userId: 'user-1',
    status: InvoiceStatus.DRAFT,
    subscriptionId: undefined,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    usersRepository.findById.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    invoiceService.createDraft.mockResolvedValue(draftInvoice);
    invoiceService.getDetailById.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      status: InvoiceStatus.DRAFT,
      lineItems: [],
      taxBreakdown: [],
    });
  });

  it('createDraft validates user exists', async () => {
    usersRepository.findById.mockResolvedValue(null);

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
});
