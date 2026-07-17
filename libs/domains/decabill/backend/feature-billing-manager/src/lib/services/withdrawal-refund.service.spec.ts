import { InvoiceStatus } from '../constants/invoice-status.constants';
import { BillingIntervalType } from '../entities/service-plan.entity';
import { PaymentRefundStatus } from '../entities/payment-refund.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { BILLING_BASE_PRICE_CONFIG_KEY } from '../utils/server-type-billing.utils';

import { BillingScheduleService } from './billing-schedule.service';
import { PricingService } from './pricing.service';
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
  const billingEmailPublisher = { publishPartialCreditDocument: jest.fn() };
  const auditLog = { log: jest.fn() };

  const subscriptionItemsRepository = {
    findBySubscription: jest.fn().mockResolvedValue([]),
  };
  const providerServerTypesService = {
    getServerTypes: jest.fn().mockResolvedValue([
      { id: 'cx11', priceMonthly: 4.15 },
      { id: 'cpx11', priceMonthly: 6.49 },
    ]),
  };

  const service = new WithdrawalRefundService(
    servicePlansRepository as never,
    subscriptionItemsRepository as never,
    providerServerTypesService as never,
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
    billingEmailPublisher as never,
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

  describe('estimateRefundGross with server-type pricing', () => {
    const periodStart = new Date();
    periodStart.setUTCDate(periodStart.getUTCDate() - 10);
    const periodEnd = new Date();
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 20);

    const pricedSubscription = {
      ...subscription,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    };

    const pricedPlan = {
      id: 'plan-1',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      basePrice: '4.15',
      marginPercent: '0',
      marginFixed: '0',
    };
    const realPricingService = new PricingService();

    const pricingAwareService = new WithdrawalRefundService(
      servicePlansRepository as never,
      subscriptionItemsRepository as never,
      providerServerTypesService as never,
      realPricingService as never,
      billingScheduleService as never,
      {
        computeLines: jest.fn((inputs) => ({
          totalGross: Math.round(inputs[0].unitPriceNet * 119) / 100,
        })),
      } as never,
      invoicesRepository as never,
      invoiceLineItemsRepository as never,
      invoiceCreditDocumentsRepository as never,
      paymentAttemptsRepository as never,
      paymentRefundsRepository as never,
      paymentProcessorFactory as never,
      customerProfilesRepository as never,
      billingIssuerConfig as never,
      invoicePdfService as never,
      billingEmailPublisher as never,
      auditLog as never,
    );

    beforeEach(() => {
      servicePlansRepository.findByIdOrThrow.mockResolvedValue(pricedPlan);
    });

    it('returns different refund estimates for subscriptions with different billingBasePrice snapshots', async () => {
      subscriptionItemsRepository.findBySubscription
        .mockResolvedValueOnce([{ configSnapshot: { [BILLING_BASE_PRICE_CONFIG_KEY]: 4.15, serverType: 'cx11' } }])
        .mockResolvedValueOnce([{ configSnapshot: { [BILLING_BASE_PRICE_CONFIG_KEY]: 6.49, serverType: 'cpx11' } }]);

      const cheaperEstimate = await pricingAwareService.estimateRefundGross(pricedSubscription as never);
      const expensiveEstimate = await pricingAwareService.estimateRefundGross({
        ...pricedSubscription,
        id: 'sub-2',
      } as never);

      expect(cheaperEstimate).toBeDefined();
      expect(expensiveEstimate).toBeDefined();
      expect(expensiveEstimate).toBeGreaterThan(cheaperEstimate!);
      expect(providerServerTypesService.getServerTypes).not.toHaveBeenCalled();
    });

    it('falls back to provider catalog price from serverType when billingBasePrice snapshot is missing', async () => {
      subscriptionItemsRepository.findBySubscription
        .mockResolvedValueOnce([
          {
            configSnapshot: { serverType: 'cx11' },
            serviceType: { provider: 'hetzner', providerDefaults: {} },
          },
        ])
        .mockResolvedValueOnce([
          {
            configSnapshot: { serverType: 'cpx11' },
            serviceType: { provider: 'hetzner', providerDefaults: {} },
          },
        ]);

      const cheaperEstimate = await pricingAwareService.estimateRefundGross(pricedSubscription as never);
      const expensiveEstimate = await pricingAwareService.estimateRefundGross({
        ...pricedSubscription,
        id: 'sub-2',
      } as never);

      expect(cheaperEstimate).toBeDefined();
      expect(expensiveEstimate).toBeDefined();
      expect(expensiveEstimate).toBeGreaterThan(cheaperEstimate!);
      expect(providerServerTypesService.getServerTypes).toHaveBeenCalled();
    });
  });

  it('uses reduced plan tax category when computing refund gross', async () => {
    const periodStart = new Date();
    periodStart.setUTCDate(periodStart.getUTCDate() - 10);
    const periodEnd = new Date();
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 20);

    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      ...plan,
      taxCategory: 'reduced',
    });
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([]);
    taxCalculationService.computeLines.mockReturnValue({ totalGross: 5.35 });

    const result = await service.estimateRefundGross({
      ...subscription,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    } as never);

    expect(taxCalculationService.computeLines).toHaveBeenCalledWith([
      expect.objectContaining({ taxCategory: 'reduced' }),
    ]);
    expect(result).toBe(5.35);
  });
});
