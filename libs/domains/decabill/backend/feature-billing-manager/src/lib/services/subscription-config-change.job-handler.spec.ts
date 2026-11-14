import { SubscriptionStatus } from '../entities/subscription.entity';

import { SubscriptionConfigChangeJobHandler } from './subscription-config-change.job-handler';

const SERVER_TYPES = [
  { id: 'cx11', name: 'CX11', cores: 1, memory: 2, disk: 20, priceMonthly: 5 },
  { id: 'cx21', name: 'CX21', cores: 2, memory: 4, disk: 40, priceMonthly: 10 },
];

describe('SubscriptionConfigChangeJobHandler', () => {
  const configChangesRepository = {
    findPendingIds: jest.fn(),
    findStuckProcessing: jest.fn(),
    findById: jest.fn(),
    claimForProcessing: jest.fn(),
    claimBillingSlot: jest.fn(),
    transitionFromProcessing: jest.fn(),
    appendAppliedStep: jest.fn(),
  };
  const subscriptionsRepository = { findByIdOrThrow: jest.fn(), compareAndSetStatus: jest.fn() };
  const servicePlansRepository = { findByIdOrThrow: jest.fn() };
  const subscriptionItemsRepository = { findBySubscription: jest.fn(), updateConfigSnapshot: jest.fn() };
  const providerServerTypesService = { getServerTypes: jest.fn() };
  const provisioningService = { changeServerType: jest.fn() };
  const addonLifecycleService = { provisionMidLife: jest.fn(), deprovisionMidLife: jest.fn() };
  const configChangeBillingService = { apply: jest.fn() };
  const billingNotificationPublisher = { publishConfigChanged: jest.fn(), publishConfigChangeFailed: jest.fn() };
  const billingEmailPublisher = { publishConfigChangeApplied: jest.fn(), publishConfigChangeFailed: jest.fn() };
  const handler = new SubscriptionConfigChangeJobHandler(
    configChangesRepository as never,
    subscriptionsRepository as never,
    servicePlansRepository as never,
    subscriptionItemsRepository as never,
    providerServerTypesService as never,
    provisioningService as never,
    addonLifecycleService as never,
    configChangeBillingService as never,
    billingNotificationPublisher as never,
    billingEmailPublisher as never,
  );

  function buildChange(overrides: Record<string, unknown> = {}) {
    return {
      id: 'change-1',
      subscriptionId: 'sub-1',
      status: 'processing',
      reclaimCount: 0,
      appliedSteps: [],
      requestedPayload: { serverType: 'cx21', addAddonIds: ['addon-1'], removeAddonIds: ['addon-2'] },
      billingDisclaimerSnapshot: {
        currentPeriodNet: 100,
        newPeriodNet: 110,
        periodDeltaNet: 10,
        effectiveAt: '2026-03-15T12:00:00.000Z',
      },
      requestedAt: new Date('2026-03-14T08:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      number: 'SUB-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.PENDING_CONFIG_CHANGE,
    });
    subscriptionsRepository.compareAndSetStatus.mockResolvedValue(true);
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', name: 'Pro', billInAdvance: false });
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        providerReference: 'server-1',
        configSnapshot: { serverType: 'cx11', billingBasePrice: 5 },
        serviceType: { provider: 'hetzner', providerDefaults: {} },
      },
    ]);
    providerServerTypesService.getServerTypes.mockResolvedValue(SERVER_TYPES);
    configChangesRepository.transitionFromProcessing.mockResolvedValue(true);
    configChangesRepository.appendAppliedStep.mockResolvedValue(true);
    configChangesRepository.findById.mockResolvedValue(buildChange());
    configChangesRepository.claimBillingSlot = jest.fn().mockResolvedValue(true);
    configChangeBillingService.apply.mockResolvedValue('charged');
  });

  it('applies every requested step, settles billing, and reactivates the subscription', async () => {
    configChangesRepository.claimForProcessing.mockResolvedValue(buildChange());

    await handler.processConfigChange('change-1');

    expect(provisioningService.changeServerType).toHaveBeenCalledWith(
      'hetzner',
      'server-1',
      'cx21',
      expect.objectContaining({ isUpgrade: true, sshPrivateKey: undefined }),
    );
    expect(subscriptionItemsRepository.updateConfigSnapshot).toHaveBeenCalledWith('item-1', {
      serverType: 'cx21',
      billingBasePrice: 10,
    });
    expect(addonLifecycleService.deprovisionMidLife).toHaveBeenCalledWith(
      expect.objectContaining({ addonIds: ['addon-2'] }),
    );
    expect(addonLifecycleService.provisionMidLife).toHaveBeenCalledWith(
      expect.objectContaining({ addonIds: ['addon-1'] }),
    );
    expect(configChangesRepository.appendAppliedStep.mock.calls.map((call) => call[1])).toEqual([
      'serverType',
      'addonRemove:addon-2',
      'addonAdd:addon-1',
    ]);
    expect(configChangesRepository.appendAppliedStep.mock.calls.every((call) => call[2] === 0)).toBe(true);
    expect(configChangeBillingService.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        change: expect.any(Object),
        changedAt: new Date('2026-03-15T12:00:00.000Z'),
      }),
    );
    expect(configChangesRepository.claimBillingSlot).toHaveBeenCalledWith('change-1', 0);
    expect(configChangesRepository.transitionFromProcessing).toHaveBeenCalledWith(
      'change-1',
      'completed',
      expect.objectContaining({ billingOutcome: 'charged' }),
      0,
    );
    expect(subscriptionsRepository.compareAndSetStatus).toHaveBeenCalledWith(
      'sub-1',
      SubscriptionStatus.PENDING_CONFIG_CHANGE,
      SubscriptionStatus.ACTIVE,
    );
    expect(billingNotificationPublisher.publishConfigChanged).toHaveBeenCalled();
    expect(billingEmailPublisher.publishConfigChangeApplied).toHaveBeenCalled();
  });

  it('skips steps that a previous run already recorded', async () => {
    configChangesRepository.claimForProcessing.mockResolvedValue(
      buildChange({ appliedSteps: ['serverType', 'addonRemove:addon-2'] }),
    );

    await handler.processConfigChange('change-1');

    expect(provisioningService.changeServerType).not.toHaveBeenCalled();
    expect(addonLifecycleService.deprovisionMidLife).not.toHaveBeenCalled();
    expect(addonLifecycleService.provisionMidLife).toHaveBeenCalledTimes(1);
    expect(configChangesRepository.appendAppliedStep.mock.calls.map((call) => call[1])).toEqual(['addonAdd:addon-1']);
  });

  it('does nothing when another worker already claimed the change', async () => {
    configChangesRepository.claimForProcessing.mockResolvedValue(null);

    await handler.processConfigChange('change-1');

    expect(subscriptionsRepository.findByIdOrThrow).not.toHaveBeenCalled();
    expect(configChangesRepository.transitionFromProcessing).not.toHaveBeenCalled();
  });

  it('keeps committed steps and skips billing when a step fails', async () => {
    configChangesRepository.claimForProcessing.mockResolvedValue(buildChange());
    addonLifecycleService.provisionMidLife.mockRejectedValue(new Error('Addon provision failed'));

    await handler.processConfigChange('change-1');

    expect(subscriptionItemsRepository.updateConfigSnapshot).toHaveBeenCalledTimes(1);
    expect(configChangesRepository.appendAppliedStep.mock.calls.map((call) => call[1])).toEqual([
      'serverType',
      'addonRemove:addon-2',
    ]);
    expect(configChangeBillingService.apply).not.toHaveBeenCalled();
    expect(configChangesRepository.transitionFromProcessing).toHaveBeenCalledWith(
      'change-1',
      'failed',
      expect.objectContaining({ errorCode: 'CONFIG_CHANGE_FAILED', errorMessage: 'Configuration change failed' }),
      0,
    );
    expect(billingNotificationPublisher.publishConfigChangeFailed).toHaveBeenCalled();
    expect(billingEmailPublisher.publishConfigChangeFailed).toHaveBeenCalled();
  });

  it('skips billing when the processing claim is lost before settlement', async () => {
    configChangesRepository.claimForProcessing.mockResolvedValue(buildChange());
    configChangesRepository.findById.mockResolvedValue(buildChange({ status: 'pending', reclaimCount: 1 }));

    await handler.processConfigChange('change-1');

    expect(configChangeBillingService.apply).not.toHaveBeenCalled();
    expect(configChangesRepository.transitionFromProcessing).not.toHaveBeenCalledWith(
      'change-1',
      'completed',
      expect.anything(),
    );
    expect(billingNotificationPublisher.publishConfigChanged).not.toHaveBeenCalled();
  });

  it('treats an already-persisted step as recorded when append returns false', async () => {
    configChangesRepository.claimForProcessing.mockResolvedValue(
      buildChange({ requestedPayload: { serverType: 'cx21' }, appliedSteps: [] }),
    );
    configChangesRepository.appendAppliedStep.mockResolvedValue(false);
    configChangesRepository.findById
      .mockResolvedValueOnce(buildChange({ status: 'processing', appliedSteps: ['serverType'] }))
      .mockResolvedValueOnce(buildChange({ status: 'processing', appliedSteps: ['serverType'] }));

    await handler.processConfigChange('change-1');

    expect(configChangeBillingService.apply).toHaveBeenCalled();
    expect(configChangesRepository.transitionFromProcessing).toHaveBeenCalledWith(
      'change-1',
      'completed',
      expect.objectContaining({ billingOutcome: 'charged' }),
      0,
    );
  });

  it('falls back to requestedAt when snapshot effectiveAt is missing', async () => {
    const requestedAt = new Date('2026-03-14T08:00:00.000Z');
    const change = buildChange({
      requestedPayload: { serverType: 'cx21' },
      billingDisclaimerSnapshot: { currentPeriodNet: 100, newPeriodNet: 110, periodDeltaNet: 10 },
      requestedAt,
    });

    configChangesRepository.claimForProcessing.mockResolvedValue(change);
    configChangesRepository.findById.mockResolvedValue(change);

    await handler.processConfigChange('change-1');

    expect(configChangeBillingService.apply).toHaveBeenCalledWith(expect.objectContaining({ changedAt: requestedAt }));
  });

  it('skips server resize when the item is already on the target type', async () => {
    configChangesRepository.claimForProcessing.mockResolvedValue(
      buildChange({ requestedPayload: { serverType: 'cx11' } }),
    );
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        providerReference: 'server-1',
        configSnapshot: { serverType: 'cx11', billingBasePrice: 5 },
        serviceType: { provider: 'hetzner', providerDefaults: {} },
      },
    ]);

    await handler.processConfigChange('change-1');

    expect(provisioningService.changeServerType).not.toHaveBeenCalled();
    expect(configChangesRepository.appendAppliedStep).toHaveBeenCalledWith('change-1', 'serverType', 0);
    expect(configChangeBillingService.apply).toHaveBeenCalled();
  });

  it('returns a first-time stuck change to pending for another attempt', async () => {
    configChangesRepository.findStuckProcessing.mockResolvedValue([
      { id: 'change-1', subscriptionId: 'sub-1', reclaimCount: 0, appliedSteps: [] },
    ]);

    await handler.reclaimStuckProcessing();

    expect(configChangesRepository.transitionFromProcessing).toHaveBeenCalledWith(
      'change-1',
      'pending',
      {
        reclaimCount: 1,
        processingStartedAt: null,
      },
      0,
    );
    expect(billingNotificationPublisher.publishConfigChangeFailed).not.toHaveBeenCalled();
  });

  it('fails a change that got stuck a second time', async () => {
    configChangesRepository.findStuckProcessing.mockResolvedValue([
      { id: 'change-1', subscriptionId: 'sub-1', reclaimCount: 1, appliedSteps: ['serverType'] },
    ]);

    await handler.reclaimStuckProcessing();

    expect(configChangesRepository.transitionFromProcessing).toHaveBeenCalledWith(
      'change-1',
      'failed',
      expect.objectContaining({ errorCode: 'CONFIG_CHANGE_FAILED' }),
      1,
    );
    expect(subscriptionsRepository.compareAndSetStatus).toHaveBeenCalledWith(
      'sub-1',
      SubscriptionStatus.PENDING_CONFIG_CHANGE,
      SubscriptionStatus.ACTIVE,
    );
    expect(billingNotificationPublisher.publishConfigChangeFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1' }),
      expect.objectContaining({ id: 'plan-1' }),
      expect.objectContaining({ configChangeId: 'change-1', appliedSteps: ['serverType'] }),
    );
  });
});
