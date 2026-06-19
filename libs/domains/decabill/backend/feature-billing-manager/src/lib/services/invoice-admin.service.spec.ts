import { BadRequestException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';

import { InvoiceAdminService } from './invoice-admin.service';

describe('InvoiceAdminService', () => {
  const invoicesRepository = {
    findAllOpenOverdue: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const invoiceService = { mapToResponse: jest.fn(), voidInvoice: jest.fn() };
  const auditLog = { log: jest.fn() };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const service = new InvoiceAdminService(
    invoicesRepository as never,
    invoiceService as never,
    auditLog as never,
    usersRepository as never,
  );
  const baseInvoice = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    userId: 'user-1',
    status: InvoiceStatus.ISSUED,
    balanceDue: 50,
    totalGross: 50,
    createdAt: new Date(),
    subscription: { number: 'SUB-1' },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    invoiceService.mapToResponse.mockReturnValue({
      id: 'inv-1',
      subscriptionId: 'sub-1',
      createdAt: new Date(),
      canPay: true,
      canDownload: true,
      canPreview: true,
    });
    usersRepository.findByIdForTenant.mockResolvedValue({ email: 'user@example.com' });
  });

  it('markPaidManual updates status and logs audit', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(baseInvoice);
    invoicesRepository.update.mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.PAID, balanceDue: 0 });

    await service.markPaidManual('inv-1', 'admin-1', { reason: 'wire transfer' });

    expect(invoicesRepository.update).toHaveBeenCalledWith('inv-1', {
      status: InvoiceStatus.PAID,
      balanceDue: 0,
    });
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'invoice.mark_paid_manual',
        context: expect.objectContaining({ adminUserId: 'admin-1' }),
      }),
    );
  });

  it('markPaidManual rejects invalid status', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.PAID });

    await expect(service.markPaidManual('inv-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('markUnpaidManual restores balance from paid', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({
      ...baseInvoice,
      status: InvoiceStatus.PAID,
      balanceDue: 0,
      dueDate: new Date('2099-01-01'),
    });
    invoicesRepository.update.mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.ISSUED, balanceDue: 50 });

    await service.markUnpaidManual('inv-1', 'admin-1');

    expect(invoicesRepository.update).toHaveBeenCalledWith('inv-1', {
      status: InvoiceStatus.ISSUED,
      balanceDue: 50,
    });
  });

  it('voidInvoice delegates to invoice service', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(baseInvoice);
    invoiceService.voidInvoice.mockResolvedValue(baseInvoice);

    await service.voidInvoice('inv-1', 'admin-1');

    expect(invoiceService.voidInvoice).toHaveBeenCalledWith('inv-1', 'sub-1', 'admin-1', { adminUserId: 'admin-1' });
  });
});
