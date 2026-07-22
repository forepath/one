import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
import 'reflect-metadata';

import { KEYCLOAK_ROLES_KEY, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';

import { AdminBillingController } from './admin-billing.controller';

describe('AdminBillingController', () => {
  const billingAdminService = {
    getGlobalSummary: jest.fn(),
    listUserSubscriptions: jest.fn(),
    listSubscriptionsForAdmin: jest.fn(),
    cancelSubscriptionForAdmin: jest.fn(),
    withdrawSubscriptionForAdmin: jest.fn(),
    resumeSubscriptionForAdmin: jest.fn(),
  };
  const adminBillNowService = { queueBillNow: jest.fn() };
  const invoiceAdminService = {
    listInvoices: jest.fn(),
    voidInvoice: jest.fn(),
    markPaidManual: jest.fn(),
    markUnpaidManual: jest.fn(),
  };
  const manualInvoiceService = {
    createDraft: jest.fn(),
    getDetail: jest.fn(),
    updateDraft: jest.fn(),
    issueDraft: jest.fn(),
    deleteDraft: jest.fn(),
  };
  const statisticsQueryService = { getSummary: jest.fn(), getByProduct: jest.fn(), getByCountry: jest.fn() };
  const auditLogService = { listForInvoice: jest.fn() };
  const invoiceService = { getPdfBuffer: jest.fn(), getVoidPdfBuffer: jest.fn(), getTimeReportPdfBuffer: jest.fn() };
  const invoicesRepository = { findById: jest.fn() };
  const datevExportConfigService = {
    isEnabled: jest.fn().mockReturnValue(true),
    isUnifiedExportAllowedForTenant: jest.fn().mockReturnValue(false),
  };
  const taxPreviewService = { preview: jest.fn() };
  const controller = new AdminBillingController(
    billingAdminService as never,
    adminBillNowService as never,
    invoiceAdminService as never,
    manualInvoiceService as never,
    statisticsQueryService as never,
    auditLogService as never,
    invoiceService as never,
    invoicesRepository as never,
    datevExportConfigService as never,
    taxPreviewService as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('has admin role guards on controller', () => {
    const keycloakRoles = Reflect.getMetadata(KEYCLOAK_ROLES_KEY, AdminBillingController);
    const usersRoles = Reflect.getMetadata(USERS_ROLES_KEY, AdminBillingController);

    expect(keycloakRoles).toContain(UserRole.ADMIN);
    expect(usersRoles).toContain(UserRole.ADMIN);
  });

  it('getCapabilities returns datev flags', () => {
    datevExportConfigService.isEnabled.mockReturnValue(false);
    datevExportConfigService.isUnifiedExportAllowedForTenant.mockReturnValue(true);

    expect(controller.getCapabilities()).toEqual({
      datevExportEnabled: false,
      unifiedExportAllowed: true,
    });
  });

  it('getSummary delegates to billing admin service', async () => {
    billingAdminService.getGlobalSummary.mockResolvedValue({ activeSubscriptionsCount: 1 });

    const result = await controller.getSummary();

    expect(result.activeSubscriptionsCount).toBe(1);
  });

  it('billNow passes admin user id', async () => {
    adminBillNowService.queueBillNow.mockResolvedValue({
      queued: true,
      requestId: 'req-1',
      userCount: 2,
    });

    await controller.billNow({}, { user: { id: 'admin-1', roles: ['admin'] } } as never);

    expect(adminBillNowService.queueBillNow).toHaveBeenCalledWith('admin-1', {});
  });

  it('createManualInvoice delegates to manual invoice service', async () => {
    manualInvoiceService.createDraft.mockResolvedValue({ id: 'inv-1' });

    await controller.createManualInvoice(
      { userId: 'user-1', lineItems: [{ description: 'Test', quantity: 1, unitPriceNet: 10 }] },
      { user: { id: 'admin-1', roles: ['admin'] } } as never,
    );

    expect(manualInvoiceService.createDraft).toHaveBeenCalledWith(
      { userId: 'user-1', lineItems: [{ description: 'Test', quantity: 1, unitPriceNet: 10 }] },
      'admin-1',
    );
  });

  it('downloadInvoicePdf returns streamable file', async () => {
    const buffer = Buffer.from('pdf');

    invoicesRepository.findById.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-2026-00001',
      subscriptionId: null,
    });
    invoiceService.getPdfBuffer.mockResolvedValue(buffer);

    const result = await controller.downloadInvoicePdf('inv-1', { setHeader: jest.fn() } as never);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(invoiceService.getPdfBuffer).toHaveBeenCalledWith('inv-1', null);
  });

  it('downloadVoidDocumentPdf returns streamable file', async () => {
    const buffer = Buffer.from('void-pdf');

    invoicesRepository.findById.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-2026-00001',
      subscriptionId: 'sub-1',
    });
    invoiceService.getVoidPdfBuffer.mockResolvedValue(buffer);

    const result = await controller.downloadVoidDocumentPdf('inv-1', { setHeader: jest.fn() } as never);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(invoiceService.getVoidPdfBuffer).toHaveBeenCalledWith('inv-1', 'sub-1');
  });

  it('downloadTimeReportPdf returns streamable file', async () => {
    const buffer = Buffer.from('time-report-pdf');

    invoicesRepository.findById.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-2026-00001',
      subscriptionId: 'sub-1',
    });
    invoiceService.getTimeReportPdfBuffer.mockResolvedValue(buffer);

    const result = await controller.downloadTimeReportPdf('inv-1', { setHeader: jest.fn() } as never);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(invoiceService.getTimeReportPdfBuffer).toHaveBeenCalledWith('inv-1', 'sub-1');
  });

  it('downloadInvoicePdf throws when invoice not found', async () => {
    invoicesRepository.findById.mockResolvedValue(null);

    await expect(controller.downloadInvoicePdf('inv-1', { setHeader: jest.fn() } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('listInvoices delegates to invoice admin service', async () => {
    invoiceAdminService.listInvoices.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });

    const result = await controller.listInvoices(10, 0, 'search', 'user-1');

    expect(invoiceAdminService.listInvoices).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
      search: 'search',
      userId: 'user-1',
    });
    expect(result.total).toBe(0);
  });

  it('listOpenOverdue delegates to listInvoices', async () => {
    invoiceAdminService.listInvoices.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });

    await controller.listOpenOverdue(5, 2, 'q', 'user-1');

    expect(invoiceAdminService.listInvoices).toHaveBeenCalledWith({
      limit: 5,
      offset: 2,
      search: 'q',
      userId: 'user-1',
    });
  });

  it('listUserSubscriptions maps subscriptions', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const createdAt = new Date('2024-01-01');

    billingAdminService.listUserSubscriptions.mockResolvedValue([
      {
        id: 'sub-1',
        number: 'SUB-001',
        planId: 'plan-1',
        userId,
        status: 'active',
        currentPeriodStart: createdAt,
        currentPeriodEnd: createdAt,
        nextBillingAt: createdAt,
        cancelRequestedAt: null,
        cancelEffectiveAt: null,
        resumedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const result = await controller.listUserSubscriptions(userId, 50, 10);

    expect(result).toHaveLength(1);
    expect(result[0].number).toBe('SUB-001');
    expect(billingAdminService.listUserSubscriptions).toHaveBeenCalledWith(userId, 50, 10);
  });

  it('listSubscriptions delegates to billing admin service', async () => {
    billingAdminService.listSubscriptionsForAdmin.mockResolvedValue({
      items: [{ id: 'sub-1', number: 'SUB-001', userEmail: 'a@b.c' }],
      total: 1,
      limit: 10,
      offset: 0,
    });

    const result = await controller.listSubscriptions(10, 0, 'promo', 'user-1');

    expect(billingAdminService.listSubscriptionsForAdmin).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
      search: 'promo',
      userId: 'user-1',
    });
    expect(result.items).toHaveLength(1);
  });

  it('cancelSubscription delegates to billing admin service', async () => {
    billingAdminService.cancelSubscriptionForAdmin.mockResolvedValue({ id: 'sub-1', status: 'pending_cancel' });

    const result = await controller.cancelSubscription('sub-1', {});

    expect(billingAdminService.cancelSubscriptionForAdmin).toHaveBeenCalledWith('sub-1');
    expect(result.status).toBe('pending_cancel');
  });

  it('withdrawSubscription delegates to billing admin service', async () => {
    billingAdminService.withdrawSubscriptionForAdmin.mockResolvedValue({ id: 'sub-1', status: 'pending_withdrawal' });

    const result = await controller.withdrawSubscription('sub-1', {});

    expect(billingAdminService.withdrawSubscriptionForAdmin).toHaveBeenCalledWith('sub-1');
    expect(result.status).toBe('pending_withdrawal');
  });

  it('resumeSubscription delegates to billing admin service', async () => {
    billingAdminService.resumeSubscriptionForAdmin.mockResolvedValue({ id: 'sub-1', status: 'active' });

    const result = await controller.resumeSubscription('sub-1', {});

    expect(billingAdminService.resumeSubscriptionForAdmin).toHaveBeenCalledWith('sub-1');
    expect(result.status).toBe('active');
  });

  it('getInvoiceDetail delegates to manual invoice service', async () => {
    manualInvoiceService.getDetail.mockResolvedValue({ id: 'inv-1' });

    const result = await controller.getInvoiceDetail('inv-1');

    expect(result.id).toBe('inv-1');
  });

  it('issueManualInvoice passes admin user id', async () => {
    manualInvoiceService.issueDraft.mockResolvedValue({ id: 'inv-1', status: 'issued' });

    await controller.issueManualInvoice('inv-1', { dueInDays: 14 }, { user: { id: 'admin-1' } } as never);

    expect(manualInvoiceService.issueDraft).toHaveBeenCalledWith('inv-1', 'admin-1', { dueInDays: 14 });
  });

  it('updateManualInvoice passes admin user id', async () => {
    manualInvoiceService.updateDraft.mockResolvedValue({ id: 'inv-1' });

    await controller.updateManualInvoice(
      'inv-1',
      { lineItems: [{ description: 'Line', quantity: 1, unitPriceNet: 10 }] },
      { user: { id: 'admin-1' } } as never,
    );

    expect(manualInvoiceService.updateDraft).toHaveBeenCalledWith(
      'inv-1',
      { lineItems: [{ description: 'Line', quantity: 1, unitPriceNet: 10 }] },
      'admin-1',
    );
  });

  it('deleteManualInvoice passes admin user id', async () => {
    await controller.deleteManualInvoice('inv-1', { user: { id: 'admin-1' } } as never);

    expect(manualInvoiceService.deleteDraft).toHaveBeenCalledWith('inv-1', 'admin-1');
  });

  it('voidInvoice passes admin user id', async () => {
    invoiceAdminService.voidInvoice.mockResolvedValue({ id: 'inv-1', status: 'void' });

    await controller.voidInvoice('inv-1', { user: { id: 'admin-1' } } as never);

    expect(invoiceAdminService.voidInvoice).toHaveBeenCalledWith('inv-1', 'admin-1');
  });

  it('markPaid passes admin user id', async () => {
    invoiceAdminService.markPaidManual.mockResolvedValue({ id: 'inv-1', status: 'paid' });

    await controller.markPaid('inv-1', { reason: 'manual' }, { user: { id: 'admin-1' } } as never);

    expect(invoiceAdminService.markPaidManual).toHaveBeenCalledWith('inv-1', 'admin-1', { reason: 'manual' });
  });

  it('markUnpaid passes admin user id', async () => {
    invoiceAdminService.markUnpaidManual.mockResolvedValue({ id: 'inv-1', status: 'issued' });

    await controller.markUnpaid('inv-1', {}, { user: { id: 'admin-1' } } as never);

    expect(invoiceAdminService.markUnpaidManual).toHaveBeenCalledWith('inv-1', 'admin-1', {});
  });

  it('listAuditLogs returns paginated result', async () => {
    auditLogService.listForInvoice.mockResolvedValue({ items: [{ id: 'log-1' }], total: 1 });

    const result = await controller.listAuditLogs('inv-1', 10, 5);

    expect(result.items).toHaveLength(1);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(5);
  });

  it('getStatisticsSummary delegates with parsed dates', async () => {
    statisticsQueryService.getSummary.mockResolvedValue({ series: [], totalGross: 0, paidCount: 0 });

    await controller.getStatisticsSummary('2024-01-01', '2024-01-31', 'month', 'user-1');

    expect(statisticsQueryService.getSummary).toHaveBeenCalledWith(
      expect.objectContaining({ groupBy: 'month', userId: 'user-1' }),
    );
  });

  it('getStatisticsByProduct delegates with parsed dates', async () => {
    statisticsQueryService.getByProduct.mockResolvedValue({ items: [], totalGross: 0 });

    await controller.getStatisticsByProduct('2024-01-01', '2024-01-31', 'user-1');

    expect(statisticsQueryService.getByProduct).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('getStatisticsByCountry delegates with parsed dates', async () => {
    statisticsQueryService.getByCountry.mockResolvedValue({ items: [], totalGross: 0 });

    await controller.getStatisticsByCountry('2024-01-01', '2024-01-31', 'user-1');

    expect(statisticsQueryService.getByCountry).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('throws on invalid statistics date range', async () => {
    await expect(controller.getStatisticsSummary('2024-02-01', '2024-01-01')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when admin not authenticated on billNow', async () => {
    await expect(controller.billNow({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when admin not authenticated on createManualInvoice', async () => {
    await expect(
      controller.createManualInvoice({
        userId: 'user-1',
        lineItems: [{ description: 'T', quantity: 1, unitPriceNet: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
