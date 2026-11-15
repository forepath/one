import { BadRequestException } from '@nestjs/common';

import { BillingIntervalType } from '../entities/service-plan.entity';
import { convertAddonPriceToPlanPeriod, assertNonNegativeAddonPrice } from '../utils/addon-pricing.util';
import { parsePlanAllowedAddonIds, planReferencesAddonId, withPlanAllowedAddonIds } from '../utils/plan-addons.utils';

import { AddonService } from './addon.service';

describe('addon-pricing.util', () => {
  it('converts monthly addon price to yearly plan period', () => {
    const result = convertAddonPriceToPlanPeriod(
      {
        basePrice: '10',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 1,
      },
      {
        billingIntervalType: BillingIntervalType.YEAR,
        billingIntervalValue: 1,
      },
    );

    expect(result).toBeCloseTo(121.67, 1);
  });

  it('converts hourly addon price to daily plan period', () => {
    expect(
      convertAddonPriceToPlanPeriod(
        { basePrice: '1', priceIntervalType: BillingIntervalType.HOUR, priceIntervalValue: 1 },
        { billingIntervalType: BillingIntervalType.DAY, billingIntervalValue: 1 },
      ),
    ).toBe(24);
  });

  it('returns zero for free addons and missing prices', () => {
    expect(
      convertAddonPriceToPlanPeriod(
        { basePrice: '0', priceIntervalType: BillingIntervalType.MONTH, priceIntervalValue: 1 },
        { billingIntervalType: BillingIntervalType.MONTH, billingIntervalValue: 1 },
      ),
    ).toBe(0);
    expect(
      convertAddonPriceToPlanPeriod(
        { basePrice: null, priceIntervalType: null, priceIntervalValue: null },
        { billingIntervalType: BillingIntervalType.MONTH, billingIntervalValue: 1 },
      ),
    ).toBe(0);
    expect(
      convertAddonPriceToPlanPeriod(
        { basePrice: 'not-a-number', priceIntervalType: BillingIntervalType.DAY, priceIntervalValue: 1 },
        { billingIntervalType: BillingIntervalType.DAY, billingIntervalValue: 1 },
      ),
    ).toBe(0);
  });

  it('rejects negative prices', () => {
    expect(() => assertNonNegativeAddonPrice('-1')).toThrow();
    expect(() => assertNonNegativeAddonPrice('abc')).toThrow();
    expect(() => assertNonNegativeAddonPrice(undefined)).not.toThrow();
    expect(() => assertNonNegativeAddonPrice('')).not.toThrow();
  });
});

describe('plan-addons.utils', () => {
  it('parses unique allowedAddonIds', () => {
    expect(
      parsePlanAllowedAddonIds({
        allowedAddonIds: ['a', 'a', 'b', 1, ''],
      }),
    ).toEqual(['a', 'b']);
  });

  it('detects plan references', () => {
    expect(planReferencesAddonId({ allowedAddonIds: ['cfg-1'] }, 'cfg-1')).toBe(true);
    expect(planReferencesAddonId({}, 'cfg-1')).toBe(false);
  });

  it('writes and clears allowedAddonIds', () => {
    expect(withPlanAllowedAddonIds({ serverType: 'cx11' }, ['id-1'])).toEqual({
      serverType: 'cx11',
      allowedAddonIds: ['id-1'],
    });
    expect(withPlanAllowedAddonIds({ allowedAddonIds: ['id-1'] }, [])).toEqual({});
  });
});

describe('AddonService', () => {
  const addonsRepository = {
    findByIds: jest.fn(),
  };
  const servicePlansRepository = {
    findAll: jest.fn(),
  };
  const serviceTypesRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const providerRegistry = {
    getProviders: jest.fn(),
  };
  const addonModuleRegistry = {
    get: jest.fn(),
    has: jest.fn().mockReturnValue(true),
  };
  const subscriptionAddonsRepository = {
    countByAddonId: jest.fn(),
  };
  const service = new AddonService(
    addonsRepository as never,
    servicePlansRepository as never,
    serviceTypesRepository as never,
    providerRegistry as never,
    addonModuleRegistry as never,
    subscriptionAddonsRepository as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    addonModuleRegistry.has.mockReturnValue(true);
  });

  it('rejects allowedAddonIds when provider does not support addons', async () => {
    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'legacy' });
    providerRegistry.getProviders.mockReturnValue([{ id: 'legacy', displayName: 'Legacy', supportsAddons: false }]);

    await expect(service.assertAllowedAddonIdsForPlan('st-1', ['addon-1'])).rejects.toThrow(BadRequestException);
  });

  it('accepts empty allowedAddonIds without looking up the service type', async () => {
    await expect(service.assertAllowedAddonIdsForPlan('st-1', [])).resolves.toBeUndefined();
    expect(serviceTypesRepository.findByIdOrThrow).not.toHaveBeenCalled();
  });

  it('accepts allowedAddonIds when provider supports addons', async () => {
    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'hetzner' });
    providerRegistry.getProviders.mockReturnValue([{ id: 'hetzner', displayName: 'Hetzner', supportsAddons: true }]);
    addonsRepository.findByIds.mockResolvedValue([
      { id: 'addon-1', key: 'av', isActive: true, compatibleProviders: [] },
    ]);

    await expect(service.assertAllowedAddonIdsForPlan('st-1', ['addon-1'])).resolves.toBeUndefined();
  });

  it('rejects missing, inactive, or incompatible plan addons', async () => {
    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'hetzner' });
    providerRegistry.getProviders.mockReturnValue([{ id: 'hetzner', displayName: 'Hetzner', supportsAddons: true }]);
    addonsRepository.findByIds.mockResolvedValueOnce([
      { id: 'addon-1', key: 'av', isActive: true, compatibleProviders: [] },
    ]);

    await expect(service.assertAllowedAddonIdsForPlan('st-1', ['addon-1', 'addon-2'])).rejects.toThrow(
      BadRequestException,
    );

    addonsRepository.findByIds.mockResolvedValueOnce([
      { id: 'addon-1', key: 'av', isActive: false, compatibleProviders: [] },
    ]);
    await expect(service.assertAllowedAddonIdsForPlan('st-1', ['addon-1'])).rejects.toThrow(BadRequestException);

    addonsRepository.findByIds.mockResolvedValueOnce([
      { id: 'addon-1', key: 'av', isActive: true, compatibleProviders: ['digital-ocean'] },
    ]);
    await expect(service.assertAllowedAddonIdsForPlan('st-1', ['addon-1'])).rejects.toThrow(BadRequestException);
  });

  it('rejects order addon ids not on the plan', async () => {
    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'hetzner' });
    providerRegistry.getProviders.mockReturnValue([{ id: 'hetzner', displayName: 'Hetzner', supportsAddons: true }]);

    await expect(service.assertAddonIdsForOrder('st-1', ['allowed'], ['other'])).rejects.toThrow(BadRequestException);
  });

  it('returns empty list when no addons are ordered', async () => {
    await expect(service.assertAddonIdsForOrder('st-1', ['allowed'], [])).resolves.toEqual([]);
  });

  it('rejects order addons when provider does not support them', async () => {
    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'legacy' });
    providerRegistry.getProviders.mockReturnValue([{ id: 'legacy', displayName: 'Legacy', supportsAddons: false }]);

    await expect(service.assertAddonIdsForOrder('st-1', ['addon-1'], ['addon-1'])).rejects.toThrow(BadRequestException);
  });

  it('returns ordered addons when valid', async () => {
    const addon = { id: 'addon-1', key: 'av', isActive: true, compatibleProviders: [] };

    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'hetzner' });
    providerRegistry.getProviders.mockReturnValue([{ id: 'hetzner', displayName: 'Hetzner', supportsAddons: true }]);
    addonsRepository.findByIds.mockResolvedValue([addon]);

    await expect(service.assertAddonIdsForOrder('st-1', ['addon-1'], ['addon-1'])).resolves.toEqual([addon]);
  });

  it('rejects missing or inactive ordered addons', async () => {
    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'hetzner' });
    providerRegistry.getProviders.mockReturnValue([{ id: 'hetzner', displayName: 'Hetzner', supportsAddons: true }]);
    addonsRepository.findByIds.mockResolvedValueOnce([]);
    await expect(service.assertAddonIdsForOrder('st-1', ['addon-1'], ['addon-1'])).rejects.toThrow(BadRequestException);

    addonsRepository.findByIds.mockResolvedValueOnce([
      { id: 'addon-1', key: 'av', isActive: false, compatibleProviders: [] },
    ]);
    await expect(service.assertAddonIdsForOrder('st-1', ['addon-1'], ['addon-1'])).rejects.toThrow(BadRequestException);
  });

  it('rejects order addons incompatible with the effective plan provider', async () => {
    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'st-1',
      provider: 'hetzner',
      allowedProviders: ['hetzner', 'digital-ocean'],
    });
    providerRegistry.getProviders.mockReturnValue([
      { id: 'hetzner', displayName: 'Hetzner', supportsAddons: true },
      { id: 'digital-ocean', displayName: 'DigitalOcean', supportsAddons: true },
    ]);
    addonsRepository.findByIds.mockResolvedValue([
      { id: 'addon-1', key: 'av', isActive: true, compatibleProviders: ['hetzner'] },
    ]);

    await expect(
      service.assertAddonIdsForOrder(
        'st-1',
        ['addon-1'],
        ['addon-1'],
        { provider: 'digital-ocean' },
        { allowCustomerProviderSelection: true, allowedProviders: ['hetzner', 'digital-ocean'] },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('partitions incompatible addons in resolveOrderAddonSelection without throwing', async () => {
    const compatibleAddon = { id: 'addon-1', key: 'av', isActive: true, compatibleProviders: ['hetzner'] };
    const incompatibleAddon = { id: 'addon-2', key: 'do-only', isActive: true, compatibleProviders: ['digital-ocean'] };

    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'st-1',
      provider: 'hetzner',
      allowedProviders: ['hetzner', 'digital-ocean'],
    });
    providerRegistry.getProviders.mockReturnValue([
      { id: 'hetzner', displayName: 'Hetzner', supportsAddons: true },
      { id: 'digital-ocean', displayName: 'DigitalOcean', supportsAddons: true },
    ]);
    addonsRepository.findByIds.mockResolvedValue([compatibleAddon, incompatibleAddon]);

    await expect(
      service.resolveOrderAddonSelection(
        'st-1',
        ['addon-1', 'addon-2'],
        ['addon-1', 'addon-2'],
        { provider: 'hetzner' },
        { allowCustomerProviderSelection: true, allowedProviders: ['hetzner', 'digital-ocean'] },
      ),
    ).resolves.toEqual({
      compatible: [compatibleAddon],
      incompatible: [incompatibleAddon],
    });
  });

  it('uses pinned plan provider for order addon checks when customer selection is off', async () => {
    const addon = { id: 'addon-1', key: 'av', isActive: true, compatibleProviders: ['digital-ocean'] };

    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'st-1',
      provider: 'hetzner',
      allowedProviders: ['hetzner', 'digital-ocean'],
    });
    providerRegistry.getProviders.mockReturnValue([
      { id: 'hetzner', displayName: 'Hetzner', supportsAddons: true },
      { id: 'digital-ocean', displayName: 'DigitalOcean', supportsAddons: true },
    ]);
    addonsRepository.findByIds.mockResolvedValue([addon]);

    await expect(
      service.assertAddonIdsForOrder(
        'st-1',
        ['addon-1'],
        ['addon-1'],
        { provider: 'hetzner' },
        { allowCustomerProviderSelection: false, allowedProviders: ['digital-ocean'] },
      ),
    ).resolves.toEqual([addon]);
  });

  it('validateCreatePayload rejects negative base price and invalid scripts', () => {
    expect(() =>
      service.validateCreatePayload({
        key: 'x',
        name: 'X',
        implementationType: 'cloud_init_script',
        scriptTemplate: '#!/bin/bash\necho hi',
        basePrice: '-5',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 1,
      } as never),
    ).toThrow(BadRequestException);

    expect(() =>
      service.validateCreatePayload({
        key: 'x',
        name: 'X',
        implementationType: 'cloud_init_script',
        scriptTemplate: '   ',
      } as never),
    ).toThrow(BadRequestException);

    addonModuleRegistry.has.mockReturnValue(false);
    expect(() =>
      service.validateCreatePayload({
        key: 'x',
        name: 'X',
        implementationType: 'module',
        moduleKey: 'missing',
      } as never),
    ).toThrow(BadRequestException);
  });

  it('validateCreatePayload requires pricing interval when base price is positive', () => {
    expect(() =>
      service.validateCreatePayload({
        key: 'x',
        name: 'X',
        implementationType: 'cloud_init_script',
        scriptTemplate: '#!/bin/bash\necho hi',
        basePrice: '5',
      } as never),
    ).toThrow(BadRequestException);

    expect(() =>
      service.validateCreatePayload({
        key: 'x',
        name: 'X',
        implementationType: 'cloud_init_script',
        scriptTemplate: '#!/bin/bash\necho hi',
        basePrice: '5',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 0,
      } as never),
    ).toThrow(BadRequestException);

    expect(() =>
      service.validateCreatePayload({
        key: 'x',
        name: 'X',
        implementationType: 'cloud_init_script',
        scriptTemplate: '#!/bin/bash\necho hi',
        basePrice: '5',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 1,
        compatibleProviders: ['  '],
      } as never),
    ).toThrow(BadRequestException);
  });

  it('validateUpdatePayload merges existing values and validates pricing', () => {
    const existing = {
      implementationType: 'cloud_init_script',
      moduleKey: null,
      scriptTemplate: '#!/bin/bash\necho hi',
      basePrice: '5',
      priceIntervalType: BillingIntervalType.MONTH,
      priceIntervalValue: 1,
      compatibleProviders: ['hetzner'],
    } as never;

    expect(service.validateUpdatePayload(existing, { name: 'Renamed' })).toEqual({
      implementationType: 'cloud_init_script',
      moduleKey: null,
      scriptTemplate: '#!/bin/bash\necho hi',
    });

    expect(() => service.validateUpdatePayload(existing, { basePrice: '-1' })).toThrow(BadRequestException);
    expect(() => service.validateUpdatePayload(existing, { compatibleProviders: [''] })).toThrow(BadRequestException);
  });

  it('resolveConfigForWrite snaps module configFields and rejects unknown modules', () => {
    addonModuleRegistry.get.mockReturnValue({
      key: 'av',
      displayName: 'AV',
      configFields: [{ key: 'API_TOKEN', label: 'Token', showInOrderForm: true }],
    });

    const result = service.resolveConfigForWrite({
      implementationType: 'module',
      moduleKey: 'av',
      configSchema: { environmentVariables: [{ key: 'IGNORED', label: 'Ignored', showInOrderForm: true }] },
      defaultValues: { API_TOKEN: 'secret' },
    });

    expect(result.configSchema.environmentVariables.map((f) => f.key)).toEqual(['API_TOKEN']);
    expect(result.configDefaultValues).toEqual({ API_TOKEN: 'secret' });

    addonModuleRegistry.get.mockReturnValue(undefined);
    expect(() =>
      service.resolveConfigForWrite({
        implementationType: 'module',
        moduleKey: 'missing',
        defaultValues: {},
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      service.resolveConfigForWrite({
        implementationType: 'module',
        moduleKey: '  ',
        defaultValues: {},
      }),
    ).toThrow(BadRequestException);
  });

  it('resolveConfigForWrite keeps existing script schema when configSchema omitted', () => {
    const existing = {
      configSchema: {
        environmentVariables: [{ key: 'REGION', label: 'Region', showInOrderForm: true }],
      },
      configDefaultValues: { REGION: 'eu' },
    } as never;
    const result = service.resolveConfigForWrite({
      implementationType: 'cloud_init_script',
      existing,
    });

    expect(result.configSchema.environmentVariables.map((f) => f.key)).toEqual(['REGION']);
    expect(result.configDefaultValues).toEqual({ REGION: 'eu' });
  });

  it('maps order fields from addon schema', () => {
    expect(
      service.getOrderFieldsForAddon({
        configSchema: {
          environmentVariables: [
            { key: 'REGION', label: 'Region', showInOrderForm: true },
            { key: 'SECRET', label: 'Secret', showInOrderForm: false },
          ],
        },
      } as never),
    ).toEqual([expect.objectContaining({ key: 'REGION', required: true })]);
  });

  it('assertCanDelete rejects when subscription rows reference the addon', async () => {
    servicePlansRepository.findAll.mockResolvedValue([]);
    subscriptionAddonsRepository.countByAddonId.mockResolvedValue(2);

    await expect(service.assertCanDelete('addon-1')).rejects.toThrow(BadRequestException);
  });

  it('assertCanDelete allows when no plans or subscriptions reference the addon', async () => {
    servicePlansRepository.findAll.mockResolvedValue([]);
    subscriptionAddonsRepository.countByAddonId.mockResolvedValue(0);

    await expect(service.assertCanDelete('addon-1')).resolves.toBeUndefined();
  });

  it('assertNotReferencedByActivePlans rejects active plan references', async () => {
    servicePlansRepository.findAll.mockResolvedValue([
      { id: 'plan-1', isActive: true, providerConfigDefaults: { allowedAddonIds: ['addon-1'] } },
      { id: 'plan-2', isActive: false, providerConfigDefaults: { allowedAddonIds: ['addon-1'] } },
    ]);

    await expect(service.assertNotReferencedByActivePlans('addon-1')).rejects.toThrow(BadRequestException);
  });

  it('assertNotReferencedByActivePlans pages through plan batches', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `plan-${index}`,
      isActive: false,
      providerConfigDefaults: {},
    }));

    servicePlansRepository.findAll
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([
        { id: 'plan-hit', isActive: true, providerConfigDefaults: { allowedAddonIds: ['addon-1'] } },
      ]);

    await expect(service.assertNotReferencedByActivePlans('addon-1')).rejects.toThrow(/plan-hit/);
    expect(servicePlansRepository.findAll).toHaveBeenCalledTimes(2);
  });

  it('validateCreatePayload accepts a valid cloud_init_script payload', () => {
    expect(() =>
      service.validateCreatePayload({
        key: 'x',
        name: 'X',
        implementationType: 'cloud_init_script',
        scriptTemplate: '#!/bin/bash\necho hi',
        basePrice: '0',
      } as never),
    ).not.toThrow();
  });
});
