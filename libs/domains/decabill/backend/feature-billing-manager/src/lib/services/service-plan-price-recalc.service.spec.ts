import { TaxCategory } from '../constants/tax-category.constants';
import { BillingIntervalType } from '../entities/service-plan.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';

import { PricingService } from './pricing.service';
import { ServicePlanPriceRecalcService } from './service-plan-price-recalc.service';

describe('ServicePlanPriceRecalcService', () => {
  const servicePlansRepository = {
    update: jest.fn(),
    findAutoRecalculatePriceDaily: jest.fn(),
  };
  const subscriptionsRepository = {
    findEligibleForPriceRecalcByPlanId: jest.fn(),
    update: jest.fn(),
  };
  const subscriptionItemsRepository = {
    findBySubscription: jest.fn(),
    updateConfigSnapshot: jest.fn(),
  };
  const subscriptionAddonsRepository = {
    findActiveBySubscriptionId: jest.fn(),
  };
  const openPositionsRepository = {
    hasUnbilledPeriodChargeForSubscription: jest.fn(),
  };
  const providerServerTypesService = {
    getServerTypes: jest.fn(),
  };
  const pricingService = new PricingService();
  const invoiceTaxContextService = {
    resolveForUser: jest.fn(),
  };
  const taxCalculationService = {
    computeLines: jest.fn((_lines: Array<{ quantity: number; unitPriceNet: number }>) => ({
      totalGross: 0,
    })),
  };
  const billingService = {
    applySettlement: jest.fn(),
  };
  const service = new ServicePlanPriceRecalcService(
    servicePlansRepository as never,
    subscriptionsRepository as never,
    subscriptionItemsRepository as never,
    subscriptionAddonsRepository as never,
    openPositionsRepository as never,
    providerServerTypesService as never,
    pricingService,
    invoiceTaxContextService as never,
    taxCalculationService as never,
    billingService as never,
  );
  const changedAt = new Date('2026-03-15T00:00:00.000Z');
  const runDate = '2026-03-15';
  const plan = {
    id: 'plan-1',
    name: 'Pro Cloud',
    basePrice: '10.0000',
    billInAdvance: true,
    autoRecalculatePriceDaily: false,
    billingIntervalType: BillingIntervalType.DAY,
    billingIntervalValue: 10,
    providerConfigDefaults: { serverType: 'cpx11' },
    allowedServerTypes: ['cpx11'],
    taxCategory: TaxCategory.STANDARD,
    serviceType: {
      provider: 'hetzner',
      providerDefaults: {},
    },
  };
  const subscription = {
    id: 'sub-1',
    number: 'SUB-1',
    planId: 'plan-1',
    userId: 'user-1',
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: new Date('2026-03-10T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-03-20T00:00:00.000Z'),
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-10T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    subscriptionsRepository.findEligibleForPriceRecalcByPlanId.mockResolvedValue([]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([]);
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([]);
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);
    invoiceTaxContextService.resolveForUser.mockResolvedValue({
      treatment: undefined,
      forceChargeNonEuIssuerEuB2b: false,
    });
    taxCalculationService.computeLines.mockImplementation(
      (lines: Array<{ quantity: number; unitPriceNet: number; taxCategory: string }>) => ({
        totalGross:
          Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPriceNet * 1.2, 0) * 100) / 100,
      }),
    );
    billingService.applySettlement.mockResolvedValue('charged');
  });

  it('skips the plan when the live catalog price is unresolvable', async () => {
    providerServerTypesService.getServerTypes.mockResolvedValue([{ id: 'other', priceMonthly: 12 }]);

    const result = await service.processPlan(plan as never, runDate, changedAt);

    expect(result.planUpdated).toBe(false);
    expect(result.migrations).toEqual([]);
    expect(servicePlansRepository.update).not.toHaveBeenCalled();
  });

  it('skips subscription settlement when the period price is unchanged', async () => {
    providerServerTypesService.getServerTypes.mockResolvedValue([{ id: 'cpx11', priceMonthly: 10 }]);
    subscriptionsRepository.findEligibleForPriceRecalcByPlanId.mockResolvedValue([subscription]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        subscriptionId: 'sub-1',
        configSnapshot: {
          serverType: 'cpx11',
          billingBasePrice: 10,
        },
        serviceType: {
          provider: 'hetzner',
          providerDefaults: {},
        },
      },
    ]);

    const result = await service.processPlan(plan as never, runDate, changedAt);

    expect(result.planUpdated).toBe(false);
    expect(result.migrations).toEqual([]);
    expect(billingService.applySettlement).not.toHaveBeenCalled();
    expect(subscriptionItemsRepository.updateConfigSnapshot).not.toHaveBeenCalled();
    expect(subscriptionsRepository.update).not.toHaveBeenCalled();
  });

  it('migrates eligible subscriptions when the live price changed', async () => {
    providerServerTypesService.getServerTypes.mockResolvedValue([{ id: 'cpx11', priceMonthly: 12 }]);
    subscriptionsRepository.findEligibleForPriceRecalcByPlanId.mockResolvedValue([subscription]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        subscriptionId: 'sub-1',
        configSnapshot: {
          serverType: 'cpx11',
          billingBasePrice: 10,
        },
        serviceType: {
          provider: 'hetzner',
          providerDefaults: {},
        },
      },
    ]);
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([
      {
        id: 'addon-1',
        subscriptionId: 'sub-1',
        unitPriceSnapshot: '5.0000',
      },
    ]);

    const result = await service.processPlan(plan as never, runDate, changedAt);

    expect(result.planUpdated).toBe(true);
    expect(servicePlansRepository.update).toHaveBeenCalledWith('plan-1', { basePrice: '12.0000' });
    expect(billingService.applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        primarySourceRef: 'price_recalc:2026-03-15:sub-1',
        carrySourceRef: 'price_recalc:2026-03-15:sub-1:carry',
        snapshot: {
          currentPeriodNet: 15,
          periodDeltaNet: 2,
          immediateAdjustmentNet: 1,
        },
      }),
    );
    expect(subscriptionItemsRepository.updateConfigSnapshot).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ billingBasePrice: 12 }),
    );
    expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', {
      statutoryWithdrawalRestartedAt: changedAt,
    });
    expect(result.migrations).toHaveLength(1);
    expect(result.migrations[0]).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        subscriptionNumber: 'SUB-1',
        productName: 'Pro Cloud',
        oldNet: 15,
        oldTax: 3,
        oldTotal: 18,
        newNet: 17,
        newTax: 3.4,
        newTotal: 20.4,
        billingOutcome: 'charged',
      }),
    );
  });

  it('uses elapsed-delta credit when an unbilled period charge is still open', async () => {
    providerServerTypesService.getServerTypes.mockResolvedValue([{ id: 'cpx11', priceMonthly: 12 }]);
    subscriptionsRepository.findEligibleForPriceRecalcByPlanId.mockResolvedValue([subscription]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        subscriptionId: 'sub-1',
        configSnapshot: {
          serverType: 'cpx11',
          billingBasePrice: 10,
        },
        serviceType: {
          provider: 'hetzner',
          providerDefaults: {},
        },
      },
    ]);
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(true);

    await service.processPlan(plan as never, runDate, changedAt);

    expect(billingService.applySettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: {
          currentPeriodNet: 10,
          periodDeltaNet: 2,
          // Half period elapsed; pending invoice uses new price so elapsed delta is credited.
          immediateAdjustmentNet: -1,
        },
      }),
    );
  });
});
