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
  const invoiceService = {
    mapToResponse: jest.fn(),
    voidInvoice: jest.fn(),
    markInvoiceSent: jest.fn(),
    markVoidDocumentSent: jest.fn(),
  };
  const documentDelivery = { spoolInvoice: jest.fn(), spoolCreditNote: jest.fn() };
  const auditLog = { log: jest.fn() };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const customerTrustScoreService = { triggerRecomputeForUser: jest.fn() };
  const customerProfilesRepository = { findByUserIds: jest.fn() };
  const billingNotificationPublisher = { publishInvoice: jest.fn(), publish: jest.fn() };
  const documentSettlementService = { apply: jest.fn(), listForDocument: jest.fn() };
  const service = new InvoiceAdminService(
    invoicesRepository as never,
    invoiceService as never,
    auditLog as never,
    usersRepository as never,
    customerTrustScoreService as never,
    documentSettlementService as never,
    customerProfilesRepository as never,
    billingNotificationPublisher as never,
    documentDelivery as never,
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

  it('markPaidManual records a manual payment settlement for the balance and logs audit', async () => {
    invoicesRepository.findByIdOrThrow
      .mockResolvedValueOnce(baseInvoice)
      .mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.PAID, balanceDue: 0 });
    documentSettlementService.apply.mockResolvedValue({
      created: true,
      becameSettled: true,
      settlement: { id: 'set-1' },
      document: {},
    });

    await service.markPaidManual('inv-1', 'admin-1', { reason: 'wire transfer', paidAt: '2026-11-19T09:00:00Z' });

    expect(documentSettlementService.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'inv-1',
        type: 'payment',
        amount: 50,
        source: 'manual',
        occurredAt: new Date('2026-11-19T09:00:00Z'),
        createdByUserId: 'admin-1',
      }),
    );
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'invoice.mark_paid_manual',
        context: expect.objectContaining({ adminUserId: 'admin-1', paidAt: expect.any(String), amount: 50 }),
      }),
    );
    expect(customerTrustScoreService.triggerRecomputeForUser).toHaveBeenCalledWith('user-1');
    expect(billingNotificationPublisher.publishInvoice).toHaveBeenCalledWith(
      'invoice.paid',
      expect.objectContaining({ id: 'inv-1', status: InvoiceStatus.PAID }),
    );
  });

  it('markPaidManual records a partial payment without announcing invoice.paid', async () => {
    invoicesRepository.findByIdOrThrow
      .mockResolvedValueOnce(baseInvoice)
      .mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.PARTIALLY_PAID, balanceDue: 30 });
    documentSettlementService.apply.mockResolvedValue({
      created: true,
      becameSettled: false,
      settlement: { id: 'set-1' },
      document: {},
    });

    await service.markPaidManual('inv-1', 'admin-1', { amount: 20 });

    expect(documentSettlementService.apply).toHaveBeenCalledWith(expect.objectContaining({ amount: 20 }));
    expect(billingNotificationPublisher.publishInvoice).not.toHaveBeenCalled();
  });

  it('markPaidManual rejects invalid status', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.PAID });

    await expect(service.markPaidManual('inv-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('markUnpaidManual reverses the net cash received (credits stay applied)', async () => {
    invoicesRepository.findByIdOrThrow
      .mockResolvedValueOnce({ ...baseInvoice, status: InvoiceStatus.PAID, balanceDue: 0 })
      .mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.ISSUED, balanceDue: 50 });
    documentSettlementService.listForDocument.mockResolvedValue([
      { id: 's1', type: 'credit', amount: '10' },
      { id: 's2', type: 'payment', amount: '40' },
    ]);
    documentSettlementService.apply.mockResolvedValue({ created: true });

    await service.markUnpaidManual('inv-1', 'admin-1');

    expect(documentSettlementService.apply).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment_reversal', amount: 40, reversesSettlementId: 's2' }),
    );
    expect(billingNotificationPublisher.publishInvoice).toHaveBeenCalledWith('invoice.unpaid', expect.anything());
    expect(customerTrustScoreService.triggerRecomputeForUser).toHaveBeenCalledWith('user-1');
  });

  it('markUnpaidManual rejects invoices without cash payments', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({ ...baseInvoice, status: InvoiceStatus.PAID, balanceDue: 0 });
    documentSettlementService.listForDocument.mockResolvedValue([{ id: 's1', type: 'credit', amount: '50' }]);

    await expect(service.markUnpaidManual('inv-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writeOff settles the remaining balance as uncollectible', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({
      ...baseInvoice,
      status: InvoiceStatus.OVERDUE,
      balanceDue: 50,
    });
    documentSettlementService.apply.mockResolvedValue({ created: true, settlement: { id: 'w1' } });

    await service.writeOff('inv-1', 'admin-1', { reason: 'insolvency' });

    expect(documentSettlementService.apply).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'write_off', amount: 50 }),
    );
  });

  it('writeOff rejects amounts above the balance', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({
      ...baseInvoice,
      status: InvoiceStatus.OVERDUE,
      balanceDue: 50,
    });

    await expect(service.writeOff('inv-1', 'admin-1', { amount: 60 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recordManualRefund only refunds existing customer credit', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({
      ...baseInvoice,
      status: InvoiceStatus.CREDITED,
      balanceDue: -15,
    });
    documentSettlementService.apply.mockResolvedValue({ created: true, settlement: { id: 'r1' }, document: {} });

    await service.recordManualRefund('inv-1', 'admin-1', {});

    expect(documentSettlementService.apply).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'refund', amount: 15 }),
    );
    await expect(service.recordManualRefund('inv-1', 'admin-1', { amount: 20 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('voidInvoice delegates to invoice service', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(baseInvoice);
    invoiceService.voidInvoice.mockResolvedValue(baseInvoice);

    await service.voidInvoice('inv-1', 'admin-1', { note: 'Cancelled' });

    expect(invoiceService.voidInvoice).toHaveBeenCalledWith(
      'inv-1',
      'sub-1',
      'admin-1',
      { adminUserId: 'admin-1', notifyCustomer: true },
      { note: 'Cancelled', skipNotification: false },
    );
  });

  it('voidInvoice with notifyCustomer false voids without emailing the credit note', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(baseInvoice);
    invoiceService.voidInvoice.mockResolvedValue(baseInvoice);

    await service.voidInvoice('inv-1', 'admin-1', { notifyCustomer: false });

    expect(invoiceService.voidInvoice).toHaveBeenCalledWith(
      'inv-1',
      'sub-1',
      'admin-1',
      { adminUserId: 'admin-1', notifyCustomer: false },
      { note: undefined, skipNotification: true },
    );
  });

  it('sendInvoice spools the email and returns the invoice as sent with its spool job', async () => {
    documentDelivery.spoolInvoice.mockResolvedValue({
      invoice: { ...baseInvoice, sentAt: new Date('2026-11-21T10:00:00Z'), sentVia: 'email' },
      job: { id: 'job-1' },
    });

    const result = await service.sendInvoice('inv-1', 'admin-1');

    expect(documentDelivery.spoolInvoice).toHaveBeenCalledWith('inv-1', 'email', 'admin-1');
    expect(result).toEqual(
      expect.objectContaining({
        sentAt: '2026-11-21T10:00:00.000Z',
        sentVia: 'email',
        canSend: false,
        spoolJobId: 'job-1',
      }),
    );
  });

  it('sendInvoiceLetter and sendCreditNoteLetter spool letters', async () => {
    const voided = { ...baseInvoice, status: InvoiceStatus.VOID };

    documentDelivery.spoolInvoice.mockResolvedValue({ invoice: baseInvoice, job: { id: 'job-2' } });
    documentDelivery.spoolCreditNote.mockResolvedValue({ invoice: voided, job: { id: 'job-3' } });

    await service.sendInvoiceLetter('inv-1', 'admin-1');
    await service.sendCreditNoteLetter('inv-1', 'admin-1');

    expect(documentDelivery.spoolInvoice).toHaveBeenCalledWith('inv-1', 'letter', 'admin-1');
    expect(documentDelivery.spoolCreditNote).toHaveBeenCalledWith('inv-1', 'letter', 'admin-1');
  });

  it('sendCreditNote spools the credit note email', async () => {
    const voided = { ...baseInvoice, status: InvoiceStatus.VOID, voidDocumentSentAt: new Date() };

    documentDelivery.spoolCreditNote.mockResolvedValue({ invoice: voided, job: { id: 'job-4' } });

    const result = await service.sendCreditNote('inv-1', 'admin-1');

    expect(documentDelivery.spoolCreditNote).toHaveBeenCalledWith('inv-1', 'email', 'admin-1');
    expect(result).toEqual(expect.objectContaining({ canSendCreditNote: false, spoolJobId: 'job-4' }));
  });

  it('markInvoiceSent records a manual send and audits it', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(baseInvoice);
    invoiceService.markInvoiceSent.mockResolvedValue({ ...baseInvoice, sentAt: new Date(), sentVia: 'manual' });

    const result = await service.markInvoiceSent('inv-1', 'admin-1', { sentAt: '2026-11-20' });

    expect(invoiceService.markInvoiceSent).toHaveBeenCalledWith(baseInvoice, new Date('2026-11-20'));
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'invoice.mark_sent' }));
    expect(result).toEqual(expect.objectContaining({ sentVia: 'manual' }));
  });

  it('markCreditNoteSent records a manual credit note send', async () => {
    const voided = { ...baseInvoice, status: InvoiceStatus.VOID };

    invoicesRepository.findByIdOrThrow.mockResolvedValue(voided);
    invoiceService.markVoidDocumentSent.mockResolvedValue({ ...voided, voidDocumentSentAt: new Date() });

    await service.markCreditNoteSent('inv-1', 'admin-1');

    expect(invoiceService.markVoidDocumentSent).toHaveBeenCalledWith(voided, undefined);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'invoice.void_document_mark_sent' }));
  });
});
