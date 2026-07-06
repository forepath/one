import { InvoiceStatus } from '../constants/invoice-status.constants';
import { BillingIntervalType } from '../entities/service-plan.entity';
import { PaymentRefundStatus } from '../entities/payment-refund.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';

import { BillingScheduleService } from './billing-schedule.service';
import { WithdrawalRefundService } from './withdrawal-refund.service';

describe('WithdrawalRefundService', () => {
  const servicePlansRepository = { findByIdOrThrow: jest.fn() };
  const pricingService = { calculate: jest.fn() };
  const billingScheduleService = new BillingScheduleService();
  const taxCalculationService = { computeLines: jest.fn() };
  const invoicesRepository = { findLatestBillableBySubscription: jest.fn(), update: jest.fn() };
  const invoiceLineItemsRepository = {};
  const invoiceCreditDocumentsRepository = { create: jest.fn() };
  const paymentAttemptsRepository = { findLatestSucceededByInvoiceId: jest.fn() };
  const paymentRefundsRepository = { create: jest.fn(), update: jest.fn() };
  const paymentProcessorFactory = { getProcessor: jest.fn() };
  const customerProfilesRepository = { findByUserId: jest.fn() };
  const billingIssuerConfig = { getConfig: jest.fn().mockReturnValue({ name: 'Issuer' }) };
  const invoicePdfService = {
    generatePartialCreditDocumentAndStore: jest.fn().mockResolvedValue({
      storageKey: 'credit.pdf',
      documentNumber: 'CN-001',
    }),
  };
  const invoiceEmailService = { notifyPartialCreditDocument: jest.fn() };
  const auditLog = { log: jest.fn() };

  const service = new WithdrawalRefundService(
    servicePlansRepository as never,
    pricingService as never,
    billingScheduleService as never,
    taxCalculationService as never,
    invoicesRepository as never,
    invoiceLineItemsRepository as never,
    invoiceCreditDocumentsRepository as never,
    paymentAttemptsRepository as never,
    paymentRefundsRepository as never,
    paymentProcessorFactory as never,
    customerProfilesRepository as never,
    billingIssuerConfig as never,
    invoicePdfService as never,
    invoiceEmailService as never,
    auditLog as never,
  );

  const subscription = {
    id: 'sub-1',
    number: 'SUB-001',
    userId: 'user-1',
    planId: 'plan-1',
    status: SubscriptionStatus.ACTIVE,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2024-02-01T00:00:00Z'),
  };

  const plan = {
    id: 'plan-1',
    billingIntervalType: BillingIntervalType.MONTH,
    billingIntervalValue: 1,
    basePrice: '100',
    marginPercent: '0',
    marginFixed: '0',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    servicePlansRepository.findByIdOrThrow.mockResolvedValue(plan);
    pricingService.calculate.mockReturnValue({ totalPrice: 100 });
    taxCalculationService.computeLines.mockReturnValue({ totalGross: 119 });
    customerProfilesRepository.findByUserId.mockResolvedValue({ id: 'buyer-1' });
    paymentRefundsRepository.create.mockResolvedValue({ id: 'refund-1' });
  });

  it('returns not_applicable when withdrawn at period end', async () => {
    const result = await service.applyProvisionedWithdrawalRefund(
      subscription as never,
      new Date('2024-02-01T00:00:00Z'),
    );

    expect(result).toEqual({ paymentRefundStatus: 'not_applicable' });
    expect(invoicesRepository.findLatestBillableBySubscription).not.toHaveBeenCalled();
  });

  it('applies credit note and reduces balance for unpaid issued invoice', async () => {
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-001',
      status: InvoiceStatus.ISSUED,
      balanceDue: 119,
      totalGross: 119,
      currency: 'EUR',
      issuedAt: new Date('2024-01-01'),
    });

    const result = await service.applyProvisionedWithdrawalRefund(
      subscription as never,
      new Date('2024-01-16T00:00:00Z'),
    );

    expect(invoicePdfService.generatePartialCreditDocumentAndStore).toHaveBeenCalled();
    expect(invoiceCreditDocumentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'withdrawal', creditGross: 119 }),
    );
    expect(invoicesRepository.update).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ balanceDue: expect.any(Number) }),
    );
    expect(result.paymentRefundStatus).toBe('not_applicable');
    expect(result.creditNoteNumber).toBe('CN-001');
  });

  it('attempts Stripe refund for paid invoice', async () => {
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-001',
      status: InvoiceStatus.PAID,
      balanceDue: 0,
      totalGross: 119,
      currency: 'EUR',
      externalPaymentId: 'cs_test',
      paymentProcessor: 'stripe',
      issuedAt: new Date('2024-01-01'),
    });
    paymentProcessorFactory.getProcessor.mockReturnValue({
      refundPayment: jest.fn().mockResolvedValue({ externalRefundId: 're_1' }),
    });

    const result = await service.applyProvisionedWithdrawalRefund(
      subscription as never,
      new Date('2024-01-16T00:00:00Z'),
    );

    expect(paymentRefundsRepository.create).toHaveBeenCalled();
    expect(paymentRefundsRepository.update).toHaveBeenCalledWith('refund-1', {
      status: PaymentRefundStatus.SUCCEEDED,
      externalRefundId: 're_1',
    });
    expect(result.paymentRefundStatus).toBe('succeeded');
  });

  it('returns failed payment refund status when checkout session is missing', async () => {
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-001',
      status: InvoiceStatus.PAID,
      balanceDue: 0,
      totalGross: 119,
      currency: 'EUR',
      issuedAt: new Date('2024-01-01'),
    });
    paymentAttemptsRepository.findLatestSucceededByInvoiceId.mockResolvedValue(null);

    const result = await service.applyProvisionedWithdrawalRefund(
      subscription as never,
      new Date('2024-01-16T00:00:00Z'),
    );

    expect(result.paymentRefundStatus).toBe('failed');
    expect(paymentRefundsRepository.create).not.toHaveBeenCalled();
  });
});
