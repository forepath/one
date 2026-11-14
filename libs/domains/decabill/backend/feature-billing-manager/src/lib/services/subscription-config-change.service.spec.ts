import { BadRequestException } from '@nestjs/common';

import { BillingIntervalType } from '../entities/service-plan.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';

import { PricingService } from './pricing.service';
import { SubscriptionConfigChangeService } from './subscription-config-change.service';

const HALF_PERIOD_MS = 15 * 24 * 60 * 60 * 1000;
const SERVER_TYPES = [
  { id: 'cx11', name: 'CX11', cores: 1, memory: 2, disk: 20, priceMonthly: 5 },
  { id: 'cx21', name: 'CX21', cores: 2, memory: 4, disk: 40, priceMonthly: 10 },
  { id: 'cpx11', name: 'CPX11', cores: 2, memory: 2, disk: 40, priceMonthly: 5 },
];

function extractErrorCode(error: unknown): string | undefined {
  const response = (error as BadRequestException).getResponse();

  return typeof response === 'object' && response !== null ? (response as { code?: string }).code : undefined;
}

describe('SubscriptionConfigChangeService', () => {
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
    compareAndSetStatus: jest.fn(),
  };
  const servicePlansRepository = { findByIdOrThrow: jest.fn() };
  const subscriptionItemsRepository = { findBySubscription: jest.fn() };
  const subscriptionAddonsRepository = { findBySubscriptionId: jest.fn() };
  const addonsRepository = { findByIds: jest.fn() };
  const configChangesRepository = { findLatestForSubscription: jest.fn(), create: jest.fn() };
  const promotionRedemptionsRepository = { findActiveBySubscription: jest.fn() };
  const openPositionsRepository = { hasUnbilledPeriodChargeForSubscription: jest.fn() };
  const providerRegistry = { getProvider: jest.fn() };
  const providerCatalogDispatchService = {
    requiresProvisioning: jest.fn((provider: string) => provider === 'hetzner' || provider === 'digital-ocean'),
  };
  const providerServerTypesService = { getServerTypes: jest.fn() };
  const addonService = { providerSupportsAddons: jest.fn() };
  const billingNotificationPublisher = { publishConfigChangeRequested: jest.fn() };
  const billingEmailPublisher = { publishConfigChangeRequested: jest.fn() };
  const service = new SubscriptionConfigChangeService(
    subscriptionsRepository as never,
    servicePlansRepository as never,
    subscriptionItemsRepository as never,
    subscriptionAddonsRepository as never,
    addonsRepository as never,
    configChangesRepository as never,
    promotionRedemptionsRepository as never,
    openPositionsRepository as never,
    providerRegistry as never,
    providerCatalogDispatchService as never,
    providerServerTypesService as never,
    new PricingService(),
    addonService as never,
    billingNotificationPublisher as never,
    billingEmailPublisher as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();

    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date(Date.now() - HALF_PERIOD_MS),
      currentPeriodEnd: new Date(Date.now() + HALF_PERIOD_MS),
    });
    subscriptionsRepository.compareAndSetStatus.mockResolvedValue(true);
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      id: 'plan-1',
      basePrice: '0',
      marginPercent: '0',
      marginFixed: '0',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      allowCustomerServerTypeSelection: true,
      allowedServerTypes: ['cx11', 'cx21', 'cpx11'],
      providerConfigDefaults: { allowedAddonIds: ['addon-1'] },
    });
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        provisioningStatus: 'active',
        configSnapshot: { serverType: 'cx11', billingBasePrice: 5 },
        serviceType: { provider: 'hetzner', providerDefaults: {} },
      },
    ]);
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([]);
    configChangesRepository.findLatestForSubscription.mockResolvedValue(null);
    configChangesRepository.create.mockImplementation(async (dto) => ({
      id: 'change-1',
      appliedSteps: [],
      requestedAt: new Date('2026-01-15T00:00:00.000Z'),
      ...dto,
    }));
    promotionRedemptionsRepository.findActiveBySubscription.mockResolvedValue([]);
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);
    providerRegistry.getProvider.mockReturnValue({
      id: 'hetzner',
      displayName: 'Hetzner',
      supportsAddons: true,
      supportsServerTypeUpgrade: true,
      supportsServerTypeDowngrade: true,
    });
    providerServerTypesService.getServerTypes.mockResolvedValue(SERVER_TYPES);
    addonService.providerSupportsAddons.mockReturnValue(true);
    addonsRepository.findByIds.mockResolvedValue([
      { id: 'addon-1', key: 'backup', isActive: true, compatibleProviders: ['hetzner'] },
    ]);
  });

  it('getEligibility reports the current server type and plan addon offering', async () => {
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([{ addonId: 'addon-2', status: 'active' }]);

    const eligibility = await service.getEligibility('sub-1', 'user-1');

    expect(eligibility.canRequestChange).toBe(true);
    expect(eligibility.provider).toBe('hetzner');
    expect(eligibility.currentServerType).toBe('cx11');
    expect(eligibility.allowedServerTypes).toEqual(['cx11', 'cx21', 'cpx11']);
    expect(eligibility.availableAddonIds).toEqual(['addon-1']);
    expect(eligibility.activeAddonIds).toEqual(['addon-2']);
  });

  it('getEligibility excludes addons incompatible with the subscription provider', async () => {
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      id: 'plan-1',
      basePrice: '0',
      marginPercent: '0',
      marginFixed: '0',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      allowCustomerServerTypeSelection: true,
      allowedServerTypes: ['cx11', 'cx21', 'cpx11'],
      providerConfigDefaults: { allowedAddonIds: ['addon-1', 'addon-do'] },
    });
    addonsRepository.findByIds.mockResolvedValue([
      { id: 'addon-1', key: 'backup', isActive: true, compatibleProviders: ['hetzner'] },
      { id: 'addon-do', key: 'do-only', isActive: true, compatibleProviders: ['digital-ocean'] },
    ]);

    const eligibility = await service.getEligibility('sub-1', 'user-1');

    expect(eligibility.availableAddonIds).toEqual(['addon-1']);
  });

  it('getEligibility prefers configSnapshot.provider over service type primary', async () => {
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        provisioningStatus: 'active',
        configSnapshot: { provider: 'digital-ocean', serverType: 's-1vcpu-1gb', billingBasePrice: 5 },
        serviceType: {
          provider: 'hetzner',
          allowedProviders: ['hetzner', 'digital-ocean'],
          providerDefaults: {},
        },
      },
    ]);

    const eligibility = await service.getEligibility('sub-1', 'user-1');

    expect(eligibility.provider).toBe('digital-ocean');
  });

  it('getEligibility rejects subscriptions that are not active', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.PENDING_CANCEL,
    });

    const eligibility = await service.getEligibility('sub-1', 'user-1');

    expect(eligibility.canRequestChange).toBe(false);
    expect(eligibility.reasonCode).toBe('CONFIG_CHANGE_NOT_ELIGIBLE');
  });

  it('getEligibility rejects while initial server provisioning is still pending', async () => {
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        provisioningStatus: 'pending',
        configSnapshot: { serverType: 'cx11', billingBasePrice: 5 },
        serviceType: { provider: 'hetzner', providerDefaults: {} },
      },
    ]);

    const eligibility = await service.getEligibility('sub-1', 'user-1');

    expect(eligibility.canRequestChange).toBe(false);
    expect(eligibility.reason).toBe('Subscription is still being provisioned');
  });

  it('rejects submit while initial server provisioning is still pending', async () => {
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        provisioningStatus: 'pending',
        configSnapshot: { serverType: 'cx11', billingBasePrice: 5 },
        serviceType: { provider: 'digital-ocean', providerDefaults: {} },
      },
    ]);

    const error = await service.submit('sub-1', 'user-1', { serverType: 'cx21' }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_NOT_ELIGIBLE');
    expect(subscriptionsRepository.compareAndSetStatus).not.toHaveBeenCalled();
  });

  it('getEligibility rejects when initial server provisioning failed', async () => {
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        provisioningStatus: 'failed',
        configSnapshot: { serverType: 'cx11', billingBasePrice: 5 },
        serviceType: { provider: 'hetzner', providerDefaults: {} },
      },
    ]);

    const eligibility = await service.getEligibility('sub-1', 'user-1');

    expect(eligibility.canRequestChange).toBe(false);
    expect(eligibility.reason).toBe('Subscription is still being provisioned');
  });

  it('getEligibility allows non-server providers regardless of item provisioningStatus', async () => {
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        provisioningStatus: 'pending',
        configSnapshot: {},
        serviceType: { provider: 'manual', providerDefaults: {} },
      },
    ]);

    const eligibility = await service.getEligibility('sub-1', 'user-1');

    expect(eligibility.canRequestChange).toBe(true);
  });

  it('rejects requests for subscriptions that are not active', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.PENDING_WITHDRAWAL,
    });

    const error = await service.submit('sub-1', 'user-1', { serverType: 'cx21' }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_NOT_ELIGIBLE');
    expect(subscriptionsRepository.compareAndSetStatus).not.toHaveBeenCalled();
  });

  it('rejects requests while another change is still in flight', async () => {
    configChangesRepository.findLatestForSubscription.mockResolvedValue({ id: 'change-0', status: 'processing' });

    const error = await service.submit('sub-1', 'user-1', { serverType: 'cx21' }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_NOT_ELIGIBLE');
  });

  it('rejects a change that does not change anything', async () => {
    const error = await service.preview('sub-1', 'user-1', { serverType: 'cx11' }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_NOOP');
  });

  it('rejects lateral server type moves at the same price', async () => {
    const error = await service.preview('sub-1', 'user-1', { serverType: 'cpx11' }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_SERVER_TYPE_LATERAL_UNSUPPORTED');
  });

  it('rejects upgrades when the provider does not support them', async () => {
    providerRegistry.getProvider.mockReturnValue({
      id: 'hetzner',
      displayName: 'Hetzner',
      supportsServerTypeUpgrade: false,
      supportsServerTypeDowngrade: true,
    });

    const error = await service.preview('sub-1', 'user-1', { serverType: 'cx21' }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_SERVER_TYPE_UNSUPPORTED');
  });

  it('rejects server types that the plan does not offer', async () => {
    const error = await service.preview('sub-1', 'user-1', { serverType: 'cx41' }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_SERVER_TYPE_UNSUPPORTED');
  });

  it('rejects addon config edits for addons that are not being added', async () => {
    const error = await service
      .preview('sub-1', 'user-1', { serverType: 'cx21', addonConfigs: { 'addon-9': { TOKEN: 'x' } } })
      .catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_ADDON_CONFIG_IMMUTABLE');
  });

  it('rejects addons that the plan does not offer', async () => {
    const error = await service.preview('sub-1', 'user-1', { addAddonIds: ['addon-9'] }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_ADDON_INVALID');
  });

  it('rejects removing an addon that is not active on the subscription', async () => {
    const error = await service.preview('sub-1', 'user-1', { removeAddonIds: ['addon-1'] }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_ADDON_INVALID');
  });

  it('previews adding an addon and includes addon notes in the disclaimer', async () => {
    addonsRepository.findByIds.mockResolvedValue([
      {
        id: 'addon-1',
        key: 'backup',
        name: 'Backup',
        isActive: true,
        compatibleProviders: ['hetzner'],
        basePrice: '2',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 1,
      },
    ]);

    const preview = await service.preview('sub-1', 'user-1', { addAddonIds: ['addon-1'] });

    expect(preview.amounts.newPeriodNet).toBeGreaterThan(preview.amounts.currentPeriodNet);
    expect(preview.disclaimer.notes.some((note) => note.includes('addon(s) will be provisioned'))).toBe(true);
  });

  it('previews removing an active addon', async () => {
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
      {
        id: 'sub-addon-1',
        addonId: 'addon-1',
        status: 'active',
        unitPriceSnapshot: '2',
      },
    ]);

    const preview = await service.preview('sub-1', 'user-1', { removeAddonIds: ['addon-1'] });

    expect(preview.amounts.newPeriodNet).toBeLessThan(preview.amounts.currentPeriodNet);
    expect(preview.disclaimer.notes.some((note) => note.includes('addon(s) will be removed'))).toBe(true);
  });

  it('rejects adding an addon that is already active', async () => {
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
      { id: 'sub-addon-1', addonId: 'addon-1', status: 'active', unitPriceSnapshot: '2' },
    ]);

    const error = await service.preview('sub-1', 'user-1', { addAddonIds: ['addon-1'] }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_ADDON_INVALID');
  });

  it('rejects addons when the provider does not support them', async () => {
    addonService.providerSupportsAddons.mockReturnValue(false);

    const error = await service.preview('sub-1', 'user-1', { addAddonIds: ['addon-1'] }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_ADDON_INVALID');
  });

  it('rejects inactive or incompatible addons', async () => {
    addonsRepository.findByIds
      .mockResolvedValueOnce([
        {
          id: 'addon-1',
          key: 'backup',
          isActive: false,
          compatibleProviders: ['hetzner'],
          basePrice: '2',
          priceIntervalType: BillingIntervalType.MONTH,
          priceIntervalValue: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'addon-1',
          key: 'backup',
          isActive: false,
          compatibleProviders: ['hetzner'],
          basePrice: '2',
          priceIntervalType: BillingIntervalType.MONTH,
          priceIntervalValue: 1,
        },
      ]);

    const inactive = await service.preview('sub-1', 'user-1', { addAddonIds: ['addon-1'] }).catch((caught) => caught);

    expect(extractErrorCode(inactive)).toBe('CONFIG_CHANGE_ADDON_INVALID');

    addonsRepository.findByIds
      .mockResolvedValueOnce([
        {
          id: 'addon-1',
          key: 'backup',
          isActive: true,
          compatibleProviders: ['digital-ocean'],
          basePrice: '2',
          priceIntervalType: BillingIntervalType.MONTH,
          priceIntervalValue: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'addon-1',
          key: 'backup',
          isActive: true,
          compatibleProviders: ['digital-ocean'],
          basePrice: '2',
          priceIntervalType: BillingIntervalType.MONTH,
          priceIntervalValue: 1,
        },
      ]);

    const incompatible = await service
      .preview('sub-1', 'user-1', { addAddonIds: ['addon-1'] })
      .catch((caught) => caught);

    expect(extractErrorCode(incompatible)).toBe('CONFIG_CHANGE_ADDON_INVALID');
  });

  it('submits an addon addition with requested payload fields', async () => {
    addonsRepository.findByIds.mockResolvedValue([
      {
        id: 'addon-1',
        key: 'backup',
        name: 'Backup',
        isActive: true,
        compatibleProviders: [],
        basePrice: '2',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 1,
      },
    ]);

    const response = await service.submit('sub-1', 'user-1', {
      addAddonIds: ['addon-1'],
      addonConfigs: { 'addon-1': { TOKEN: 'x' } },
    });

    expect(response.id).toBe('change-1');
    expect(configChangesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedPayload: expect.objectContaining({
          addAddonIds: ['addon-1'],
          addonConfigs: { 'addon-1': { TOKEN: 'x' } },
        }),
      }),
    );
  });

  it('previews an arrear upgrade as elapsed settlement at the old price', async () => {
    const preview = await service.preview('sub-1', 'user-1', { serverType: 'cx21' });

    expect(preview.amounts.currentPeriodNet).toBe(5);
    expect(preview.amounts.newPeriodNet).toBe(10);
    expect(preview.amounts.periodDeltaNet).toBe(5);
    // Half of the billing period has elapsed, so half of the old period net is settled now.
    expect(preview.amounts.remainingPeriodRatio).toBeCloseTo(0.5, 2);
    expect(preview.amounts.immediateAdjustmentNet).toBeCloseTo(2.5, 2);
    expect(preview.disclaimer.kind).toBe('charge');
  });

  it('previews an advance upgrade as a prorated remaining-period charge when already invoiced', async () => {
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      id: 'plan-1',
      basePrice: '0',
      marginPercent: '0',
      marginFixed: '0',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      billInAdvance: true,
      autoRecalculatePriceDaily: false,
      allowCustomerServerTypeSelection: true,
      allowedServerTypes: ['cx11', 'cx21', 'cpx11'],
      providerConfigDefaults: { allowedAddonIds: ['addon-1'] },
    });

    const preview = await service.preview('sub-1', 'user-1', { serverType: 'cx21' });

    expect(preview.amounts.periodDeltaNet).toBe(5);
    expect(preview.amounts.immediateAdjustmentNet).toBeCloseTo(2.5, 2);
    expect(preview.disclaimer.kind).toBe('charge');
  });

  it('previews an advance upgrade with an unbilled period as an elapsed delta credit', async () => {
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      id: 'plan-1',
      basePrice: '0',
      marginPercent: '0',
      marginFixed: '0',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      billInAdvance: true,
      autoRecalculatePriceDaily: false,
      allowCustomerServerTypeSelection: true,
      allowedServerTypes: ['cx11', 'cx21', 'cpx11'],
      providerConfigDefaults: { allowedAddonIds: ['addon-1'] },
    });
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(true);

    const preview = await service.preview('sub-1', 'user-1', { serverType: 'cx21' });

    expect(preview.amounts.periodDeltaNet).toBe(5);
    // Elapsed share of the upgrade delta is credited because the pending invoice uses the new price.
    expect(preview.amounts.immediateAdjustmentNet).toBeCloseTo(-2.5, 2);
    // Pending period (new) + elapsed credit equals old×elapsed + new×remaining.
    const elapsed = 1 - preview.amounts.remainingPeriodRatio;

    expect(preview.amounts.newPeriodNet + preview.amounts.immediateAdjustmentNet).toBeCloseTo(
      preview.amounts.currentPeriodNet * elapsed + preview.amounts.newPeriodNet * preview.amounts.remainingPeriodRatio,
      2,
    );
    expect(preview.disclaimer.kind).toBe('credit');
  });

  it('previews remaining-period math when only leftover adjustment OPs are open', async () => {
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      id: 'plan-1',
      basePrice: '0',
      marginPercent: '0',
      marginFixed: '0',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      billInAdvance: true,
      autoRecalculatePriceDaily: false,
      allowCustomerServerTypeSelection: true,
      allowedServerTypes: ['cx11', 'cx21', 'cpx11'],
      providerConfigDefaults: { allowedAddonIds: ['addon-1'] },
    });
    // Period charge already invoiced; hasUnbilledPeriodCharge is false even if adjustment OPs exist.
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);

    const preview = await service.preview('sub-1', 'user-1', { serverType: 'cx21' });

    expect(preview.amounts.periodDeltaNet).toBe(5);
    expect(preview.amounts.immediateAdjustmentNet).toBeCloseTo(2.5, 2);
    expect(preview.disclaimer.kind).toBe('charge');
  });

  it('previews an arrear downgrade as elapsed settlement (not a remaining-period credit)', async () => {
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        provisioningStatus: 'active',
        configSnapshot: { serverType: 'cx21', billingBasePrice: 10 },
        serviceType: { provider: 'hetzner', providerDefaults: {} },
      },
    ]);

    const preview = await service.preview('sub-1', 'user-1', { serverType: 'cx11' });

    expect(preview.amounts.periodDeltaNet).toBe(-5);
    expect(preview.amounts.immediateAdjustmentNet).toBeCloseTo(5, 2);
    expect(preview.disclaimer.kind).toBe('charge');
  });

  it('submit claims the subscription, records the change, and notifies', async () => {
    const response = await service.submit('sub-1', 'user-1', { serverType: 'cx21' });

    expect(subscriptionsRepository.compareAndSetStatus).toHaveBeenCalledWith(
      'sub-1',
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PENDING_CONFIG_CHANGE,
    );
    expect(configChangesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        status: 'pending',
        requestedPayload: { serverType: 'cx21' },
      }),
    );
    expect(billingNotificationPublisher.publishConfigChangeRequested).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1' }),
      expect.objectContaining({ id: 'plan-1' }),
      { configChangeId: 'change-1' },
    );
    expect(response).toEqual(
      expect.objectContaining({ id: 'change-1', status: 'pending', appliedSteps: [], billingOutcome: null }),
    );
  });

  it('submit fails when the subscription left the active state between validation and claim', async () => {
    subscriptionsRepository.compareAndSetStatus.mockResolvedValue(false);

    const error = await service.submit('sub-1', 'user-1', { serverType: 'cx21' }).catch((caught) => caught);

    expect(extractErrorCode(error)).toBe('CONFIG_CHANGE_NOT_ELIGIBLE');
    expect(configChangesRepository.create).not.toHaveBeenCalled();
  });

  it('submit releases the claim when persisting the change fails', async () => {
    configChangesRepository.create.mockRejectedValue(new Error('db down'));

    await expect(service.submit('sub-1', 'user-1', { serverType: 'cx21' })).rejects.toThrow('db down');
    expect(subscriptionsRepository.compareAndSetStatus).toHaveBeenLastCalledWith(
      'sub-1',
      SubscriptionStatus.PENDING_CONFIG_CHANGE,
      SubscriptionStatus.ACTIVE,
    );
  });

  it('rejects subscriptions owned by another user', async () => {
    await expect(service.getEligibility('sub-1', 'other-user')).rejects.toThrow(BadRequestException);
  });
});
