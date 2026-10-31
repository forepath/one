import { BadRequestException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';

import { InvoiceAdminService } from './invoice-admin.service';

describe('InvoiceAdminService', () => {
  const invoicesRepository = {
    findAllOpenOverdue: jest.fn(),
    findAllForAdmin: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const invoiceService = { mapToResponse: jest.fn(), voidInvoice: jest.fn() };
  const auditLog = { log: jest.fn() };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const customerTrustScoreService = { triggerRecomputeForUser: jest.fn() };
  const customerProfilesRepository = { findByUserIds: jest.fn() };
  const service = new InvoiceAdminService(
    invoicesRepository as never,
    invoiceService as never,
    auditLog as never,
    usersRepository as never,
    customerTrustScoreService as never,
    customerProfilesRepository as never,
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

  it('listInvoices adds the billing-profile name next to the email (DB-18)', async () => {
    invoicesRepository.findAllForAdmin.mockResolvedValue({
      items: [baseInvoice, { ...baseInvoice, id: 'inv-2', userId: 'user-2' }],
      total: 2,
    });
    customerProfilesRepository.findByUserIds.mockResolvedValue([
      { userId: 'user-1', company: 'Fischer GmbH', firstName: 'Anna', lastName: 'Fischer' },
    ]);

    const result = await service.listInvoices({ limit: 25, offset: 0 });

    expect(customerProfilesRepository.findByUserIds).toHaveBeenCalledWith(['user-1', 'user-2']);
    expect(result.items[0]).toEqual(
      expect.objectContaining({ userId: 'user-1', userEmail: 'user@example.com', customerName: 'Fischer GmbH' }),
    );
    expect(result.items[1].customerName).toBeUndefined();
    expect(result.total).toBe(2);
  });

  it('markPaidManual updates status and logs audit', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(baseInvoice);
    invoicesRepository.update.mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.PAID, balanceDue: 0 });

    await service.markPaidManual('inv-1', 'admin-1', { reason: 'wire transfer' });

    expect(invoicesRepository.update).toHaveBeenCalledWith('inv-1', {
      status: InvoiceStatus.PAID,
      balanceDue: 0,
      paidAt: expect.any(Date),
    });
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'invoice.mark_paid_manual',
        context: expect.objectContaining({ adminUserId: 'admin-1', paidAt: expect.any(String) }),
      }),
    );
    expect(customerTrustScoreService.triggerRecomputeForUser).toHaveBeenCalledWith('user-1');
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
      paidAt: null,
    });
    expect(customerTrustScoreService.triggerRecomputeForUser).toHaveBeenCalledWith('user-1');
  });

  it('voidInvoice delegates to invoice service', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(baseInvoice);
    invoiceService.voidInvoice.mockResolvedValue(baseInvoice);

    await service.voidInvoice('inv-1', 'admin-1');

    expect(invoiceService.voidInvoice).toHaveBeenCalledWith('inv-1', 'sub-1', 'admin-1', { adminUserId: 'admin-1' });
  });
});
