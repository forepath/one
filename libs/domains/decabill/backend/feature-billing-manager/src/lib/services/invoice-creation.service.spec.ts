import { BillingScheduleService } from './billing-schedule.service';
import { InvoiceCreationService } from './invoice-creation.service';

describe('InvoiceCreationService', () => {
  const subscriptionItemsRepository = { findBySubscription: jest.fn().mockResolvedValue([]) } as any;
  const providerServerTypesService = { getServerTypes: jest.fn().mockResolvedValue([]) } as any;

  it('creates invoice for subscription', async () => {
    const subscriptionsRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }),
    } as any;
    const plansRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'plan-1',
        basePrice: '10',
        marginPercent: '0',
        marginFixed: '0',
        billingIntervalType: 'day',
        billingIntervalValue: 1,
        billingDayOfMonth: undefined,
      }),
    } as any;
    const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 10 }) } as any;
    const invoiceService = {
      createAndIssue: jest.fn().mockResolvedValue({
        invoiceRefId: 'ref-1',
        invoiceNumber: 'INV-2026-00001',
      }),
    } as any;
    const usageRecordsRepository = { findLatestForSubscription: jest.fn().mockResolvedValue(null) } as any;
    const billingScheduleService = new BillingScheduleService();
    const invoicesRepository = {
      findLatestBySubscription: jest.fn().mockResolvedValue(null),
    } as any;
    const openPositionsRepository = { markBilled: jest.fn().mockResolvedValue({}) } as any;
    const service = new InvoiceCreationService(
      subscriptionsRepository,
      plansRepository,
      pricingService,
      invoiceService,
      usageRecordsRepository,
      billingScheduleService,
      openPositionsRepository,
      invoicesRepository,
      subscriptionItemsRepository,
      providerServerTypesService,
    );
    const result = await service.createInvoice('sub-1', 'user-1', 'Test');

    expect(invoiceService.createAndIssue).toHaveBeenCalled();
    expect(result).toEqual({
      invoiceRefId: 'ref-1',
      invoiceNumber: 'INV-2026-00001',
    });
  });

  it('calculates partial base amount since last invoice for manual billing', async () => {
    const lastInvoiceAt = new Date('2024-01-01T00:00:00Z');
    const billUntil = new Date('2024-01-02T12:00:00Z'); // 1.5 days
    const subscriptionsRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        createdAt: new Date('2023-12-31T00:00:00Z'),
      }),
    } as any;
    const plansRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'plan-1',
        basePrice: '10',
        marginPercent: '0',
        marginFixed: '0',
        billingIntervalType: 'day',
        billingIntervalValue: 1,
        billingDayOfMonth: undefined,
      }),
    } as any;
    const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 20 }) } as any;
    const invoiceService = { createAndIssue: jest.fn().mockResolvedValue({}) } as any;
    const usageRecordsRepository = { findLatestForSubscription: jest.fn().mockResolvedValue(null) } as any;
    const billingScheduleService = new BillingScheduleService();
    const invoicesRepository = {
      findLatestBySubscription: jest.fn().mockResolvedValue({ createdAt: lastInvoiceAt }),
    } as any;
    const openPositionsRepository = { markBilled: jest.fn().mockResolvedValue({}) } as any;
    const service = new InvoiceCreationService(
      subscriptionsRepository,
      plansRepository,
      pricingService,
      invoiceService,
      usageRecordsRepository,
      billingScheduleService,
      openPositionsRepository,
      invoicesRepository,
      subscriptionItemsRepository,
      providerServerTypesService,
    );

    await service.createInvoice('sub-1', 'user-1', 'Manual', { billUntil });

    expect(invoiceService.createAndIssue).toHaveBeenCalledWith({
      subscriptionId: 'sub-1',
      userId: 'user-1',
      lineInputs: [expect.objectContaining({ description: 'Manual', unitPriceNet: 30 })],
    });
  });

  it('does not bill beyond subscription end when cancelEffectiveAt is in the past', async () => {
    const lastInvoiceAt = new Date('2024-01-01T00:00:00Z');
    const billUntil = new Date('2024-01-20T00:00:00Z');
    const subscriptionsRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        createdAt: new Date('2023-12-31T00:00:00Z'),
        cancelEffectiveAt: new Date('2024-01-10T00:00:00Z'),
      }),
    } as any;
    const plansRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'plan-1',
        basePrice: '10',
        marginPercent: '0',
        marginFixed: '0',
        billingIntervalType: 'day',
        billingIntervalValue: 1,
        billingDayOfMonth: undefined,
      }),
    } as any;
    const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 10 }) } as any;
    const invoiceService = { createAndIssue: jest.fn().mockResolvedValue({}) } as any;
    const usageRecordsRepository = { findLatestForSubscription: jest.fn().mockResolvedValue(null) } as any;
    const billingScheduleService = new BillingScheduleService();
    const invoicesRepository = {
      findLatestBySubscription: jest.fn().mockResolvedValue({ createdAt: lastInvoiceAt }),
    } as any;
    const openPositionsRepository = { markBilled: jest.fn().mockResolvedValue({}) } as any;
    const service = new InvoiceCreationService(
      subscriptionsRepository,
      plansRepository,
      pricingService,
      invoiceService,
      usageRecordsRepository,
      billingScheduleService,
      openPositionsRepository,
      invoicesRepository,
      subscriptionItemsRepository,
      providerServerTypesService,
    );

    await service.createInvoice('sub-1', 'user-1', 'Final', { billUntil });

    // From 2024-01-01 to 2024-01-10 is 9 full days, so 9 * 10
    expect(invoiceService.createAndIssue).toHaveBeenCalledWith({
      subscriptionId: 'sub-1',
      userId: 'user-1',
      lineInputs: [expect.objectContaining({ description: 'Final', unitPriceNet: 90 })],
    });
  });

  it('skips invoice when total is below minimum and skipIfNoBillableAmount is true', async () => {
    const subscriptionsRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }),
    } as any;
    const plansRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'plan-1',
        basePrice: '10',
        marginPercent: '0',
        marginFixed: '0',
        billingIntervalType: 'day',
        billingIntervalValue: 1,
        billingDayOfMonth: undefined,
      }),
    } as any;
    const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 10 }) } as any;
    const invoiceService = { createAndIssue: jest.fn().mockResolvedValue({}) } as any;
    const usageRecordsRepository = { findLatestForSubscription: jest.fn().mockResolvedValue(null) } as any;
    const billingScheduleService = new BillingScheduleService();
    const invoicesRepository = {
      findLatestBySubscription: jest.fn().mockResolvedValue(null),
    } as any;
    const openPositionsRepository = { markBilled: jest.fn().mockResolvedValue({}) } as any;
    const service = new InvoiceCreationService(
      subscriptionsRepository,
      plansRepository,
      pricingService,
      invoiceService,
      usageRecordsRepository,
      billingScheduleService,
      openPositionsRepository,
      invoicesRepository,
      subscriptionItemsRepository,
      providerServerTypesService,
    );

    (service as any).calculateBaseAmountSinceLastBilling = jest.fn().mockResolvedValue(0.005);

    const result = await service.createInvoice('sub-1', 'user-1', 'Tiny', {
      billUntil: new Date('2024-01-01T00:02:00Z'),
      skipIfNoBillableAmount: true,
    });

    expect(result).toBeUndefined();
    expect(invoiceService.createAndIssue).not.toHaveBeenCalled();
  });

  it('throws when total is below minimum and skipIfNoBillableAmount is false', async () => {
    const subscriptionsRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }),
    } as any;
    const plansRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'plan-1',
        basePrice: '10',
        marginPercent: '0',
        marginFixed: '0',
        billingIntervalType: 'day',
        billingIntervalValue: 1,
        billingDayOfMonth: undefined,
      }),
    } as any;
    const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 10 }) } as any;
    const invoiceService = { createAndIssue: jest.fn().mockResolvedValue({}) } as any;
    const usageRecordsRepository = { findLatestForSubscription: jest.fn().mockResolvedValue(null) } as any;
    const billingScheduleService = new BillingScheduleService();
    const invoicesRepository = {
      findLatestBySubscription: jest.fn().mockResolvedValue(null),
    } as any;
    const openPositionsRepository = { markBilled: jest.fn().mockResolvedValue({}) } as any;
    const service = new InvoiceCreationService(
      subscriptionsRepository,
      plansRepository,
      pricingService,
      invoiceService,
      usageRecordsRepository,
      billingScheduleService,
      openPositionsRepository,
      invoicesRepository,
      subscriptionItemsRepository,
      providerServerTypesService,
    );

    (service as any).calculateBaseAmountSinceLastBilling = jest.fn().mockResolvedValue(0.005);

    await expect(
      service.createInvoice('sub-1', 'user-1', 'Tiny', {
        billUntil: new Date('2024-01-01T00:02:00Z'),
      }),
    ).rejects.toThrow('No billable amount since last invoice');

    expect(invoiceService.createAndIssue).not.toHaveBeenCalled();
  });

  describe('createAccumulatedInvoice', () => {
    const subscriptionBase = {
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    };
    const planBase = {
      id: 'plan-1',
      basePrice: '10',
      marginPercent: '0',
      marginFixed: '0',
      billingIntervalType: 'day',
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
    };

    it('creates one invoice with multiple line items and marks all positions billed', async () => {
      const positions = [
        {
          id: 'pos-1',
          subscriptionId: 'sub-1',
          userId: 'user-1',
          description: 'Subscription 123',
          billUntil: new Date('2024-02-01'),
          skipIfNoBillableAmount: true,
        },
        {
          id: 'pos-2',
          subscriptionId: 'sub-2',
          userId: 'user-1',
          description: 'Subscription 456',
          billUntil: new Date('2024-02-01'),
          skipIfNoBillableAmount: true,
        },
      ] as any;
      const subscriptionsRepository = {
        findByIdOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ ...subscriptionBase, id: 'sub-1' })
          .mockResolvedValueOnce({ ...subscriptionBase, id: 'sub-2', planId: 'plan-1' }),
      } as any;
      const plansRepository = { findByIdOrThrow: jest.fn().mockResolvedValue(planBase) } as any;
      const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 10 }) } as any;
      const invoiceService = {
        createAndIssue: jest.fn().mockResolvedValue({ invoiceRefId: 'ref-1' }),
      } as any;
      const usageRecordsRepository = { findLatestForSubscription: jest.fn().mockResolvedValue(null) } as any;
      const billingScheduleService = new BillingScheduleService();
      const invoicesRepository = { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as any;
      const openPositionsRepository = { markManyBilled: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new InvoiceCreationService(
        subscriptionsRepository,
        plansRepository,
        pricingService,
        invoiceService,
        usageRecordsRepository,
        billingScheduleService,
        openPositionsRepository,
        invoicesRepository,
        subscriptionItemsRepository,
        providerServerTypesService,
      );
      const result = await service.createAccumulatedInvoice('user-1', positions);

      expect(result).toEqual({ invoiceRefId: 'ref-1' });
      expect(invoiceService.createAndIssue).toHaveBeenCalledTimes(1);
      expect(invoiceService.createAndIssue).toHaveBeenCalledWith({
        subscriptionId: 'sub-1',
        userId: 'user-1',
        lineInputs: expect.arrayContaining([
          expect.objectContaining({ description: 'Subscription 123' }),
          expect.objectContaining({ description: 'Subscription 456' }),
        ]),
      });
      expect(openPositionsRepository.markManyBilled).toHaveBeenCalledWith(['pos-1', 'pos-2'], 'ref-1');
    });

    it('creates one line item per subscription when duplicate open positions exist', async () => {
      const positions = [
        {
          id: 'pos-1',
          subscriptionId: 'sub-1',
          userId: 'user-1',
          description: 'Subscription 123',
          billUntil: new Date('2024-01-01'),
          skipIfNoBillableAmount: true,
        },
        {
          id: 'pos-2',
          subscriptionId: 'sub-1',
          userId: 'user-1',
          description: 'Subscription 123',
          billUntil: new Date('2024-02-01'),
          skipIfNoBillableAmount: true,
        },
      ] as any;
      const subscriptionsRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({ ...subscriptionBase, id: 'sub-1' }),
      } as any;
      const plansRepository = { findByIdOrThrow: jest.fn().mockResolvedValue(planBase) } as any;
      const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 10 }) } as any;
      const invoiceService = {
        createAndIssue: jest.fn().mockResolvedValue({ invoiceRefId: 'ref-1' }),
      } as any;
      const usageRecordsRepository = { findLatestForSubscription: jest.fn().mockResolvedValue(null) } as any;
      const billingScheduleService = new BillingScheduleService();
      const invoicesRepository = { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as any;
      const openPositionsRepository = { markManyBilled: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new InvoiceCreationService(
        subscriptionsRepository,
        plansRepository,
        pricingService,
        invoiceService,
        usageRecordsRepository,
        billingScheduleService,
        openPositionsRepository,
        invoicesRepository,
        subscriptionItemsRepository,
        providerServerTypesService,
      );

      (service as any).getBillableAmountForPosition = jest.fn().mockResolvedValue(10);

      await service.createAccumulatedInvoice('user-1', positions);

      expect(invoiceService.createAndIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          lineInputs: [expect.objectContaining({ unitPriceNet: 10 })],
        }),
      );
      expect(invoiceService.createAndIssue.mock.calls[0][0].lineInputs).toHaveLength(1);
      expect(openPositionsRepository.markManyBilled).toHaveBeenCalledWith(['pos-1', 'pos-2'], 'ref-1');
    });

    it('returns undefined when no positions', async () => {
      const openPositionsRepository = { markManyBilled: jest.fn() } as any;
      const service = new InvoiceCreationService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        new BillingScheduleService(),
        openPositionsRepository,
        {} as any,
        subscriptionItemsRepository,
        providerServerTypesService,
      );
      const result = await service.createAccumulatedInvoice('user-1', []);

      expect(result).toBeUndefined();
      expect(openPositionsRepository.markManyBilled).not.toHaveBeenCalled();
    });

    it('returns undefined when total below minimum and all positions skip', async () => {
      const positions = [
        {
          id: 'pos-1',
          subscriptionId: 'sub-1',
          userId: 'user-1',
          description: 'Sub',
          billUntil: new Date(),
          skipIfNoBillableAmount: true,
        },
      ] as any;
      const subscriptionsRepository = { findByIdOrThrow: jest.fn().mockResolvedValue(subscriptionBase) } as any;
      const plansRepository = { findByIdOrThrow: jest.fn().mockResolvedValue(planBase) } as any;
      const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 10 }) } as any;
      const invoiceService = { createAndIssue: jest.fn() } as any;
      const usageRecordsRepository = { findLatestForSubscription: jest.fn().mockResolvedValue(null) } as any;
      const billingScheduleService = new BillingScheduleService();
      const invoicesRepository = { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as any;
      const openPositionsRepository = { markManyBilled: jest.fn() } as any;
      const service = new InvoiceCreationService(
        subscriptionsRepository,
        plansRepository,
        pricingService,
        invoiceService,
        usageRecordsRepository,
        billingScheduleService,
        openPositionsRepository,
        invoicesRepository,
        subscriptionItemsRepository,
        providerServerTypesService,
      );

      (service as any).calculateBaseAmountSinceLastBilling = jest.fn().mockResolvedValue(0.005);

      const result = await service.createAccumulatedInvoice('user-1', positions);

      expect(result).toBeUndefined();
      expect(invoiceService.createAndIssue).not.toHaveBeenCalled();
      expect(openPositionsRepository.markManyBilled).not.toHaveBeenCalled();
    });
  });

  describe('getUnbilledTotalForUser', () => {
    it('returns 0 when user has no unbilled positions', async () => {
      const openPositionsRepository = {
        findUnbilledByUserId: jest.fn().mockResolvedValue([]),
      } as any;
      const service = new InvoiceCreationService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        new BillingScheduleService(),
        openPositionsRepository,
        {} as any,
        subscriptionItemsRepository,
        providerServerTypesService,
      );
      const result = await service.getUnbilledTotalForUser('user-1');

      expect(result).toBe(0);
      expect(openPositionsRepository.findUnbilledByUserId).toHaveBeenCalledWith('user-1');
    });
  });

  describe('withdrawn subscription billing', () => {
    it('returns zero billable amount for unprovisioned statutory withdrawal', async () => {
      const subscriptionsRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'sub-1',
          userId: 'user-1',
          planId: 'plan-1',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
          withdrawnAt: new Date('2024-01-05T00:00:00Z'),
        }),
      } as any;
      const plansRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'plan-1',
          billingIntervalType: 'day',
          billingIntervalValue: 1,
        }),
      } as any;
      const invoicesRepository = { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as any;
      const itemsRepository = {
        findBySubscription: jest
          .fn()
          .mockResolvedValue([{ provisioningStatus: 'pending', createdAt: new Date('2024-01-01T00:00:00Z') }]),
      } as any;
      const service = new InvoiceCreationService(
        subscriptionsRepository,
        {} as any,
        { calculate: jest.fn().mockReturnValue({ totalPrice: 30 }) } as any,
        {} as any,
        {} as any,
        new BillingScheduleService(),
        {} as any,
        invoicesRepository,
        itemsRepository,
        providerServerTypesService,
      );

      const amount = await (service as any).calculateBaseAmountSinceLastBilling(
        await subscriptionsRepository.findByIdOrThrow('sub-1'),
        await plansRepository.findByIdOrThrow('plan-1'),
        30,
        new Date('2024-01-05T00:00:00Z'),
      );

      expect(amount).toBe(0);
    });

    it('bills only from earliest provisionedAt for withdrawn provisioned subscription', async () => {
      const periodStart = new Date('2024-01-01T00:00:00Z');
      const provisionedAt = new Date('2024-01-07T00:00:00Z');
      const withdrawnAt = new Date('2024-01-10T00:00:00Z');
      const subscriptionsRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'sub-1',
          userId: 'user-1',
          planId: 'plan-1',
          createdAt: periodStart,
          currentPeriodStart: periodStart,
          withdrawnAt,
        }),
      } as any;
      const plansRepository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'plan-1',
          billingIntervalType: 'day',
          billingIntervalValue: 1,
        }),
      } as any;
      const invoicesRepository = { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as any;
      const itemsRepository = {
        findBySubscription: jest
          .fn()
          .mockResolvedValue([{ provisioningStatus: 'active', provisionedAt, createdAt: periodStart }]),
      } as any;
      const service = new InvoiceCreationService(
        subscriptionsRepository,
        plansRepository,
        { calculate: jest.fn().mockReturnValue({ totalPrice: 30 }) } as any,
        {} as any,
        {} as any,
        new BillingScheduleService(),
        {} as any,
        invoicesRepository,
        itemsRepository,
        providerServerTypesService,
      );

      const amount = await (service as any).calculateBaseAmountSinceLastBilling(
        await subscriptionsRepository.findByIdOrThrow('sub-1'),
        await plansRepository.findByIdOrThrow('plan-1'),
        30,
        withdrawnAt,
      );

      expect(amount).toBe(90);
    });
  });

  describe('resolveSubscriptionPricing', () => {
    it('passes billingBasePrice override from subscription items to pricing service', async () => {
      subscriptionItemsRepository.findBySubscription.mockResolvedValue([
        {
          configSnapshot: { billingBasePrice: 6.49, serverType: 'cpx11' },
          serviceType: { provider: 'hetzner', providerDefaults: {} },
        },
      ]);
      const plan = {
        id: 'plan-1',
        basePrice: '4.15',
        marginPercent: '0',
        marginFixed: '0',
      };
      const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 6.49 }) } as any;
      const service = new InvoiceCreationService(
        {} as any,
        { findByIdOrThrow: jest.fn().mockResolvedValue(plan) } as any,
        pricingService,
        {} as any,
        {} as any,
        new BillingScheduleService(),
        {} as any,
        {} as any,
        subscriptionItemsRepository,
        providerServerTypesService,
      );

      await (service as any).resolveSubscriptionPricing('sub-1', plan);

      expect(pricingService.calculate).toHaveBeenCalledWith(plan, 6.49);
      expect(providerServerTypesService.getServerTypes).not.toHaveBeenCalled();
    });

    it('falls back to provider catalog price from serverType when snapshot is missing', async () => {
      subscriptionItemsRepository.findBySubscription.mockResolvedValue([
        {
          configSnapshot: { serverType: 'cpx11' },
          serviceType: { provider: 'hetzner', providerDefaults: {} },
        },
      ]);
      providerServerTypesService.getServerTypes.mockResolvedValue([
        { id: 'cx11', priceMonthly: 4.15 },
        { id: 'cpx11', priceMonthly: 6.49 },
      ]);
      const plan = {
        id: 'plan-1',
        basePrice: '4.15',
        marginPercent: '0',
        marginFixed: '0',
      };
      const pricingService = { calculate: jest.fn().mockReturnValue({ totalPrice: 6.49 }) } as any;
      const service = new InvoiceCreationService(
        {} as any,
        { findByIdOrThrow: jest.fn().mockResolvedValue(plan) } as any,
        pricingService,
        {} as any,
        {} as any,
        new BillingScheduleService(),
        {} as any,
        {} as any,
        subscriptionItemsRepository,
        providerServerTypesService,
      );

      await (service as any).resolveSubscriptionPricing('sub-1', plan);

      expect(pricingService.calculate).toHaveBeenCalledWith(plan, 6.49);
      expect(providerServerTypesService.getServerTypes).toHaveBeenCalledWith('hetzner', {});
    });
  });
});
