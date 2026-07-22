import { TaxCategory } from '../constants/tax-category.constants';
import type { ProviderServerTypesService } from '../services/provider-server-types.service';
import type { TaxCalculationService } from '../services/tax-calculation.service';

import {
  BILLING_BASE_PRICE_CONFIG_KEY,
  buildBackorderRequestedConfigSnapshot,
  extractBillingBasePriceOverride,
  resolvePeriodTotalPrice,
  resolveServerTypePriceMonthly,
  resolveSubscriptionBillingBaseOverride,
} from './server-type-billing.utils';

describe('server-type-billing.utils', () => {
  describe('extractBillingBasePriceOverride', () => {
    it('returns numeric billingBasePrice from snapshot', () => {
      expect(extractBillingBasePriceOverride({ [BILLING_BASE_PRICE_CONFIG_KEY]: 12.5 })).toBe(12.5);
    });

    it('parses string billingBasePrice from snapshot', () => {
      expect(extractBillingBasePriceOverride({ [BILLING_BASE_PRICE_CONFIG_KEY]: '8.25' })).toBe(8.25);
    });

    it('returns undefined when billingBasePrice is missing or invalid', () => {
      expect(extractBillingBasePriceOverride(undefined)).toBeUndefined();
      expect(extractBillingBasePriceOverride({ serverType: 'cx11' })).toBeUndefined();
      expect(extractBillingBasePriceOverride({ [BILLING_BASE_PRICE_CONFIG_KEY]: 'n/a' })).toBeUndefined();
    });
  });

  describe('resolveServerTypePriceMonthly', () => {
    it('returns provider catalog price for matching server type', async () => {
      const providerServerTypesService = {
        getServerTypes: jest.fn().mockResolvedValue([
          { id: 'cx11', priceMonthly: 4.15 },
          { id: 'cpx11', priceMonthly: 6.49 },
        ]),
      } as unknown as ProviderServerTypesService;

      await expect(resolveServerTypePriceMonthly(providerServerTypesService, 'hetzner', 'cpx11', {})).resolves.toBe(
        6.49,
      );
    });
  });

  describe('resolveSubscriptionBillingBaseOverride', () => {
    const providerServerTypesService = {
      getServerTypes: jest.fn().mockResolvedValue([
        { id: 'cx11', priceMonthly: 4.15 },
        { id: 'cpx11', priceMonthly: 6.49 },
      ]),
    } as unknown as ProviderServerTypesService;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('prefers billingBasePrice snapshot over serverType fallback', async () => {
      const result = await resolveSubscriptionBillingBaseOverride(
        [
          {
            configSnapshot: { serverType: 'cpx11', [BILLING_BASE_PRICE_CONFIG_KEY]: 9.99 },
            serviceType: { provider: 'hetzner', providerDefaults: {} },
          },
        ],
        providerServerTypesService,
      );

      expect(result).toBe(9.99);
      expect(providerServerTypesService.getServerTypes).not.toHaveBeenCalled();
    });

    it('resolves price from serverType when billingBasePrice snapshot is missing', async () => {
      const result = await resolveSubscriptionBillingBaseOverride(
        [
          {
            configSnapshot: { serverType: 'cpx11' },
            serviceType: { provider: 'hetzner', providerDefaults: {} },
          },
        ],
        providerServerTypesService,
      );

      expect(result).toBe(6.49);
      expect(providerServerTypesService.getServerTypes).toHaveBeenCalledWith('hetzner', {});
    });

    it('returns undefined when no snapshot or resolvable server type exists', async () => {
      await expect(resolveSubscriptionBillingBaseOverride([], providerServerTypesService)).resolves.toBeUndefined();
      await expect(
        resolveSubscriptionBillingBaseOverride(
          [{ configSnapshot: {}, serviceType: { provider: 'hetzner' } }],
          providerServerTypesService,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('buildBackorderRequestedConfigSnapshot', () => {
    it('merges resolved serverType and billingBasePrice into sanitized customer config', () => {
      const snapshot = buildBackorderRequestedConfigSnapshot(
        { region: 'fsn1' },
        { serverType: 'cpx11', [BILLING_BASE_PRICE_CONFIG_KEY]: 6.49 },
      );

      expect(snapshot).toEqual({
        region: 'fsn1',
        serverType: 'cpx11',
        [BILLING_BASE_PRICE_CONFIG_KEY]: 6.49,
      });
    });

    it('keeps customer serverType when present and adds billingBasePrice from effective config', () => {
      const snapshot = buildBackorderRequestedConfigSnapshot(
        { region: 'fsn1', serverType: 'cpx11' },
        { serverType: 'cpx11', [BILLING_BASE_PRICE_CONFIG_KEY]: 6.49 },
      );

      expect(snapshot.serverType).toBe('cpx11');
      expect(snapshot[BILLING_BASE_PRICE_CONFIG_KEY]).toBe(6.49);
    });
  });

  describe('resolvePeriodTotalPrice', () => {
    const pricingService = {
      calculate: jest.fn((plan, override) => ({
        totalPrice: (override ?? Number(plan.basePrice)) + 1,
      })),
    } as unknown as import('../services/pricing.service').PricingService;
    const taxCalculationService = {
      computeLines: jest.fn((inputs) => {
        const net = inputs[0].unitPriceNet;

        return { totalGross: Math.round(net * 1.19 * 100) / 100 };
      }),
    } as unknown as TaxCalculationService;

    it('returns gross period price incl. standard VAT from billingBasePrice override', async () => {
      const plan = {
        basePrice: '4',
        marginPercent: '0',
        marginFixed: '0',
        taxCategory: TaxCategory.STANDARD,
      } as import('../entities/service-plan.entity').ServicePlanEntity;
      const providerServerTypesService = { getServerTypes: jest.fn() } as unknown as ProviderServerTypesService;

      await expect(
        resolvePeriodTotalPrice(plan, pricingService, taxCalculationService, providerServerTypesService, {
          items: [{ configSnapshot: { billingBasePrice: 6.49 } }],
        }),
      ).resolves.toBe(8.91);
      expect(taxCalculationService.computeLines).toHaveBeenCalledWith(
        [
          {
            description: 'Subscription period',
            quantity: 1,
            unitPriceNet: 7.49,
            taxCategory: TaxCategory.STANDARD,
          },
        ],
        undefined,
      );
    });

    it('uses reduced plan tax category for gross period price', async () => {
      const plan = {
        basePrice: '10',
        marginPercent: '0',
        marginFixed: '0',
        taxCategory: TaxCategory.REDUCED,
      } as import('../entities/service-plan.entity').ServicePlanEntity;
      const providerServerTypesService = { getServerTypes: jest.fn() } as unknown as ProviderServerTypesService;

      await resolvePeriodTotalPrice(plan, pricingService, taxCalculationService, providerServerTypesService, {});

      expect(taxCalculationService.computeLines).toHaveBeenLastCalledWith(
        [
          {
            description: 'Subscription period',
            quantity: 1,
            unitPriceNet: 11,
            taxCategory: TaxCategory.REDUCED,
          },
        ],
        undefined,
      );
    });
  });
});
