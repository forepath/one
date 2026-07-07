import { BadRequestException } from '@nestjs/common';

import { BillingIntervalType } from '../entities/service-plan.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { buildProvisioningUserData, normalizeCloudInitService } from '../utils/cloud-init/cloud-init-dispatch.utils';
import { validateConfigSchema } from '../utils/config-validation.utils';

import { AvailabilityService } from './availability.service';
import { BackorderService } from './backorder.service';
import { BillingScheduleService } from './billing-schedule.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { WithdrawalPolicyService } from './withdrawal-policy.service';
import { WithdrawalRefundService } from './withdrawal-refund.service';
import { CloudInitConfigService } from './cloud-init-config.service';
import { CustomerProfilesService } from './customer-profiles.service';
import { SubscriptionService } from './subscription.service';
import { BackordersRepository } from '../repositories/backorders.repository';

jest.mock('../utils/config-validation.utils', () => ({
  validateConfigSchema: jest.fn().mockReturnValue([]),
}));

jest.mock('../utils/cloud-init/cloud-init-dispatch.utils', () => ({
  buildProvisioningUserData: jest.fn().mockReturnValue('mock-user-data'),
  normalizeCloudInitService: jest.fn().mockImplementation((service?: string) => {
    if (service === 'manager' || service === 'custom') {
      return service;
    }

    return 'controller';
  }),
}));

describe('SubscriptionService', () => {
  const controllerProvisioningDefaults = {
    provisioningOptions: [{ type: 'integrated', service: 'controller' }],
  };
  const plansRepository = {
    findByIdOrThrow: jest.fn(),
  } as unknown as ServicePlansRepository;
  const typesRepository = {
    findByIdOrThrow: jest.fn(),
  } as unknown as ServiceTypesRepository;
  const subscriptionsRepository = {
    create: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findAllByUser: jest.fn(),
  } as unknown as SubscriptionsRepository;
  const itemsRepository = {
    create: jest.fn(),
    delete: jest.fn(),
    updateProviderReference: jest.fn(),
    updateProvisioningStatus: jest.fn(),
    updateHostname: jest.fn().mockResolvedValue({}),
    updateSshPrivateKey: jest.fn().mockResolvedValue({}),
    findBySubscription: jest.fn(),
    findBySubscriptionIds: jest.fn(),
    findByIdWithRelations: jest.fn(),
    findPendingProvisioningIds: jest.fn(),
  } as unknown as SubscriptionItemsRepository;
  const scheduleService = new BillingScheduleService();
  const cancellationPolicyService = new CancellationPolicyService();
  const backorderService = {
    create: jest.fn(),
  } as unknown as BackorderService;
  const availabilityService = {
    checkAvailability: jest.fn(),
  } as unknown as AvailabilityService;
  const provisioningService = {
    provision: jest.fn(),
    getServerInfo: jest.fn().mockResolvedValue({ publicIp: '1.2.3.4' }),
    ensurePublicIpForDns: jest.fn(),
  } as any;
  const hostnameReservationService = {
    reserveHostname: jest.fn().mockResolvedValue('awesome-armadillo-abc12'),
    releaseHostname: jest.fn().mockResolvedValue(undefined),
  } as any;
  const cloudflareDnsService = {
    createARecord: jest.fn().mockResolvedValue(undefined),
  } as any;
  const completeProfile = {
    id: 'cp-1',
    userId: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    addressLine1: '123 Main St',
    city: 'Berlin',
    country: 'DE',
  };
  const customerProfilesService = {
    getByUserId: jest.fn().mockResolvedValue(completeProfile),
    isProfileComplete: jest.fn().mockReturnValue(true),
  } as unknown as CustomerProfilesService;
  const cloudInitConfigService = {
    findByIdForProvisioning: jest.fn(),
    resolveEnvironmentVariables: jest.fn(),
  } as unknown as CloudInitConfigService;
  const withdrawalPolicyService = new WithdrawalPolicyService();
  const withdrawalRefundService = {
    applyProvisionedWithdrawalRefund: jest.fn(),
    estimateRefundGross: jest.fn(),
  } as unknown as WithdrawalRefundService;
  const backordersRepository = {
    cancelPendingForUserPlan: jest.fn(),
  } as unknown as BackordersRepository;
  const service = new SubscriptionService(
    plansRepository,
    typesRepository,
    subscriptionsRepository,
    itemsRepository,
    scheduleService,
    cancellationPolicyService,
    backorderService,
    availabilityService,
    provisioningService,
    hostnameReservationService,
    cloudflareDnsService,
    customerProfilesService,
    cloudInitConfigService,
    withdrawalPolicyService,
    withdrawalRefundService,
    backordersRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (normalizeCloudInitService as jest.Mock).mockImplementation((service?: string) => {
      if (service === 'manager' || service === 'custom') {
        return service;
      }

      return 'controller';
    });
    (customerProfilesService.getByUserId as jest.Mock).mockResolvedValue(completeProfile);
    (customerProfilesService.isProfileComplete as jest.Mock).mockReturnValue(true);
    // createSubscription reloads after insert to hydrate DB-generated columns (e.g. `number`).
    (subscriptionsRepository.findByIdOrThrow as jest.Mock).mockResolvedValue({
      id: 'sub-1',
      number: 'SUB-000087',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
    });
    (validateConfigSchema as jest.Mock).mockReturnValue([]);
    (buildProvisioningUserData as jest.Mock).mockReturnValue('mock-user-data');
    hostnameReservationService.reserveHostname.mockResolvedValue('awesome-armadillo-abc12');
    provisioningService.getServerInfo.mockResolvedValue({ publicIp: '1.2.3.4' });
    provisioningService.ensurePublicIpForDns.mockImplementation(
      async (_provider: string, _serverId: string, initial?: { publicIp?: string } | null) => {
        if (initial?.publicIp) {
          return initial.publicIp;
        }

        const info = await provisioningService.getServerInfo(_provider, _serverId);

        return info?.publicIp || undefined;
      },
    );
  });

  // Provisioning is deferred to a job: after createSubscription records a pending item, this
  // helper feeds the stored config snapshot back through the provisioning routine, matching
  // what the provisioning coordinator/unit jobs do at runtime.
  async function provisionCreatedItem(opts: { provider: string; autoBackorder?: boolean } = { provider: 'hetzner' }) {
    const createCalls = (itemsRepository.create as jest.Mock).mock.calls;
    const configSnapshot = createCalls.at(-1)?.[0]?.configSnapshot ?? {};

    (itemsRepository.findByIdWithRelations as jest.Mock).mockResolvedValue({
      id: 'item-1',
      serviceTypeId: 'stype-1',
      provisioningStatus: 'pending',
      providerReference: undefined,
      configSnapshot,
      subscription: {
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.ACTIVE,
        autoBackorder: opts.autoBackorder ?? false,
      },
      serviceType: { id: 'stype-1', provider: opts.provider },
    });

    await service.provisionSubscriptionItem('item-1');
  }

  it('creates subscription with schedule', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      providerConfigDefaults: controllerProvisioningDefaults,
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    itemsRepository.updateProviderReference = jest.fn();
    itemsRepository.updateProvisioningStatus = jest.fn();
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    const result = await service.createSubscription('user-1', 'plan-1', { region: 'fsn1' });

    expect(result.id).toBe('sub-1');
    // Reloaded after insert so the sequence-backed `number` is present without a client refresh.
    expect(result.number).toBe('SUB-000087');
    expect(subscriptionsRepository.findByIdOrThrow).toHaveBeenCalledWith('sub-1');
    expect(subscriptionsRepository.create).toHaveBeenCalled();
    expect(itemsRepository.create).toHaveBeenCalled();
    // Provisioning is deferred to the job, not run inline by createSubscription.
    expect(provisioningService.provision).not.toHaveBeenCalled();

    await provisionCreatedItem();

    expect(provisioningService.provision).toHaveBeenCalled();
    expect(itemsRepository.updateProviderReference).toHaveBeenCalledWith('item-1', 'srv-1');
  });

  it('uses plan providerConfigDefaults when requestedConfig is not provided', async () => {
    (validateConfigSchema as jest.Mock).mockReturnValue([]);

    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      providerConfigDefaults: {
        ...controllerProvisioningDefaults,
        region: 'fsn1',
        serverType: 'cx23',
        authenticationMethod: 'api-key',
        backendEnv: { FOO: 'bar' },
        frontendEnv: { BAR: 'baz' },
      },
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: {},
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    const result = await service.createSubscription('user-1', 'plan-1');

    expect(result.id).toBe('sub-1');
    expect(availabilityService.checkAvailability).toHaveBeenCalledWith('hetzner', 'fsn1', 'cx23');

    await provisionCreatedItem();

    expect(hostnameReservationService.reserveHostname).toHaveBeenCalledWith('item-1');
    expect(provisioningService.provision).toHaveBeenCalledWith('hetzner', {
      name: 'awesome-armadillo-abc12',
      serverType: 'cx23',
      location: 'fsn1',
      firewallId: undefined,
      userData: 'mock-user-data',
    });
    expect(cloudflareDnsService.createARecord).toHaveBeenCalledWith('awesome-armadillo-abc12', '1.2.3.4');
    expect(itemsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        serviceTypeId: 'stype-1',
        configSnapshot: expect.objectContaining({
          region: 'fsn1',
          serverType: 'cx23',
          authenticationMethod: 'api-key',
          backendEnv: { FOO: 'bar' },
          frontendEnv: { BAR: 'baz' },
        }),
      }),
    );
    expect(itemsRepository.updateSshPrivateKey).toHaveBeenCalledWith('item-1', expect.any(String));
    expect((itemsRepository.updateSshPrivateKey as jest.Mock).mock.calls[0][1].length).toBeGreaterThan(0);
    expect(buildProvisioningUserData).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'controller',
        hostname: 'awesome-armadillo-abc12',
        baseDomain: 'spirde.com',
        effectiveConfig: expect.objectContaining({
          region: 'fsn1',
          serverType: 'cx23',
          authenticationMethod: 'api-key',
          sshPublicKey: expect.any(String),
        }),
      }),
    );
  });

  it('calls manager cloud-init builder when service is manager', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      providerConfigDefaults: {
        provisioningOptions: [{ type: 'integrated', service: 'manager' }],
      },
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    await service.createSubscription('user-1', 'plan-1', { region: 'fsn1', service: 'manager' });
    await provisionCreatedItem();

    expect(itemsRepository.updateSshPrivateKey).toHaveBeenCalledWith('item-1', expect.any(String));
    expect(buildProvisioningUserData).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'manager',
        hostname: 'awesome-armadillo-abc12',
        effectiveConfig: expect.objectContaining({
          region: 'fsn1',
          service: 'manager',
          sshPublicKey: expect.any(String),
        }),
      }),
    );
    expect(provisioningService.provision).toHaveBeenCalledWith(
      'hetzner',
      expect.objectContaining({ userData: 'mock-user-data' }),
    );
  });

  it('resolves custom CloudInit config and env when service is custom', async () => {
    const customTemplate = { id: 'cfg-1', isActive: true };
    (cloudInitConfigService.findByIdForProvisioning as jest.Mock).mockResolvedValue(customTemplate);
    (cloudInitConfigService.resolveEnvironmentVariables as jest.Mock).mockReturnValue({ API_KEY: 'resolved' });
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      providerConfigDefaults: {
        provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-1' }],
        region: 'fsn1',
        serverType: 'cx23',
      },
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    await service.createSubscription('user-1', 'plan-1', { env: { API_KEY: 'customer' } });
    await provisionCreatedItem();

    expect(cloudInitConfigService.findByIdForProvisioning).toHaveBeenCalledWith('cfg-1');
    expect(cloudInitConfigService.resolveEnvironmentVariables).toHaveBeenCalled();
    expect(buildProvisioningUserData).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'custom',
        customTemplate,
        resolvedCustomEnv: { API_KEY: 'resolved' },
      }),
    );
  });

  it('resolves custom config from provisioningOptionKey when plan offers multiple options', async () => {
    const customTemplate = { id: 'cfg-2', isActive: true };
    (cloudInitConfigService.findByIdForProvisioning as jest.Mock).mockResolvedValue(customTemplate);
    (cloudInitConfigService.resolveEnvironmentVariables as jest.Mock).mockReturnValue({ API_KEY: 'resolved' });
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      providerConfigDefaults: {
        region: 'fsn1',
        serverType: 'cx23',
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'custom', cloudInitConfigId: 'cfg-2' },
        ],
      },
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    await service.createSubscription('user-1', 'plan-1', {
      provisioningOptionKey: 'custom:cfg-2',
      env: { API_KEY: 'customer' },
    });

    expect(cloudInitConfigService.findByIdForProvisioning).toHaveBeenCalledWith('cfg-2');
  });

  it('orders legacy manager-only plans using requested service without provisioningOptionKey', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      providerConfigDefaults: { service: 'manager', region: 'fsn1', serverType: 'cx23' },
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    await service.createSubscription('user-1', 'plan-1', { service: 'manager', region: 'fsn1' });
    await provisionCreatedItem();

    expect(buildProvisioningUserData).toHaveBeenCalledWith(expect.objectContaining({ service: 'manager' }));
  });

  it('rejects invalid provisioning selections', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      providerConfigDefaults: {
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      },
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: {},
    });

    await expect(service.createSubscription('user-1', 'plan-1', {})).rejects.toThrow(BadRequestException);
    await expect(service.createSubscription('user-1', 'plan-1', {})).rejects.toThrow(
      'provisioningOptionKey is required when the plan offers multiple provisioning options',
    );
  });

  it('creates backorder when availability fails and autoBackorder is enabled', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      providerConfigDefaults: controllerProvisioningDefaults,
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: {},
    });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({
      isAvailable: false,
      reason: 'Out of stock',
      alternatives: { region: 'nbg1' },
    });

    await expect(service.createSubscription('user-1', 'plan-1', { region: 'fsn1' }, true)).rejects.toThrow(
      BadRequestException,
    );
    expect(backorderService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        planId: 'plan-1',
        providerErrors: { reason: 'Out of stock' },
      }),
    );
  });

  it('does not create a backorder when the order is provisioned successfully with autoBackorder enabled', async () => {
    (validateConfigSchema as jest.Mock).mockReturnValue([]);

    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      providerConfigDefaults: controllerProvisioningDefaults,
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    itemsRepository.updateProviderReference = jest.fn();
    itemsRepository.updateProvisioningStatus = jest.fn();
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    await service.createSubscription('user-1', 'plan-1', { region: 'fsn1' }, true);

    expect(subscriptionsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ autoBackorder: true }));

    await provisionCreatedItem({ provider: 'hetzner', autoBackorder: true });

    expect(backorderService.create).not.toHaveBeenCalled();
  });

  it('rolls back the subscription and item when provisioning fails and no server was created', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      providerConfigDefaults: controllerProvisioningDefaults,
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({ id: 'sub-1', userId: 'user-1', planId: 'plan-1' });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockRejectedValue(new Error('provider exploded'));

    await service.createSubscription('user-1', 'plan-1', { region: 'fsn1' }, true);
    await provisionCreatedItem({ provider: 'hetzner', autoBackorder: true });

    expect(itemsRepository.delete).toHaveBeenCalledWith('item-1');
    expect(subscriptionsRepository.delete).toHaveBeenCalledWith('sub-1');
    expect(itemsRepository.updateProvisioningStatus).not.toHaveBeenCalledWith('item-1', 'failed');
    expect(backorderService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        planId: 'plan-1',
        providerErrors: { reason: 'provider exploded' },
      }),
    );
  });

  it('keeps the records and does not backorder when a server was created before the failure', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      providerConfigDefaults: controllerProvisioningDefaults,
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({ id: 'sub-1', userId: 'user-1', planId: 'plan-1' });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    itemsRepository.updateProviderReference = jest.fn();
    itemsRepository.updateProvisioningStatus = jest.fn();
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });
    (provisioningService.getServerInfo as jest.Mock).mockRejectedValueOnce(new Error('post-provision failure'));

    await service.createSubscription('user-1', 'plan-1', { region: 'fsn1' }, true);
    await provisionCreatedItem({ provider: 'hetzner', autoBackorder: true });

    expect(itemsRepository.updateProvisioningStatus).toHaveBeenCalledWith('item-1', 'failed');
    expect(itemsRepository.delete).not.toHaveBeenCalled();
    expect(subscriptionsRepository.delete).not.toHaveBeenCalled();
    expect(backorderService.create).not.toHaveBeenCalled();
  });

  it('provisions when provider is digital-ocean', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      providerConfigDefaults: controllerProvisioningDefaults,
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'digital-ocean',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'do-srv-1' });

    await service.createSubscription('user-1', 'plan-1', {
      region: 'fra1',
      serverType: 's-1vcpu-1gb',
    });

    expect(availabilityService.checkAvailability).toHaveBeenCalledWith('digital-ocean', 'fra1', 's-1vcpu-1gb');

    await provisionCreatedItem({ provider: 'digital-ocean' });

    expect(provisioningService.provision).toHaveBeenCalledWith(
      'digital-ocean',
      expect.objectContaining({
        name: 'awesome-armadillo-abc12',
        serverType: 's-1vcpu-1gb',
        location: 'fra1',
      }),
    );
    expect(itemsRepository.updateProviderReference).toHaveBeenCalledWith('item-1', 'do-srv-1');
    expect(provisioningService.ensurePublicIpForDns).toHaveBeenCalled();
    expect(cloudflareDnsService.createARecord).toHaveBeenCalledWith('awesome-armadillo-abc12', '1.2.3.4');
  });

  it('creates Cloudflare DNS for digital-ocean when public IP appears after polling', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      providerConfigDefaults: controllerProvisioningDefaults,
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'digital-ocean',
      configSchema: { required: ['region'] },
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'do-srv-1' });
    provisioningService.getServerInfo.mockResolvedValue({ publicIp: '' });
    provisioningService.ensurePublicIpForDns.mockResolvedValue('10.0.0.99');

    await service.createSubscription('user-1', 'plan-1', {
      region: 'fra1',
      serverType: 's-1vcpu-1gb',
    });
    await provisionCreatedItem({ provider: 'digital-ocean' });

    expect(cloudflareDnsService.createARecord).toHaveBeenCalledWith('awesome-armadillo-abc12', '10.0.0.99');
  });

  it('strips customer region override when allowCustomerLocationSelection is false', async () => {
    (validateConfigSchema as jest.Mock).mockReturnValue([]);
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      allowCustomerLocationSelection: false,
      providerConfigDefaults: {
        ...controllerProvisioningDefaults,
        region: 'fsn1',
        serverType: 'cx23',
        service: 'controller',
        authenticationMethod: 'api-key',
      },
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: {},
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    await service.createSubscription('user-1', 'plan-1', {
      region: 'nbg1',
      serverType: 'cx23',
      service: 'controller',
      authenticationMethod: 'api-key',
    });

    expect(availabilityService.checkAvailability).toHaveBeenCalledWith('hetzner', 'fsn1', 'cx23');
  });

  it('applies customer region override when allowCustomerLocationSelection is true', async () => {
    (validateConfigSchema as jest.Mock).mockReturnValue([]);
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      allowCustomerLocationSelection: true,
      providerConfigDefaults: {
        ...controllerProvisioningDefaults,
        region: 'fsn1',
        serverType: 'cx23',
        service: 'controller',
        authenticationMethod: 'api-key',
      },
    });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'stype-1',
      provider: 'hetzner',
      configSchema: {},
    });
    subscriptionsRepository.create = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    itemsRepository.create = jest.fn().mockResolvedValue({ id: 'item-1' });
    (availabilityService.checkAvailability as jest.Mock).mockResolvedValue({ isAvailable: true });
    (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

    await service.createSubscription('user-1', 'plan-1', {
      region: 'nbg1',
      serverType: 'cx23',
      service: 'controller',
      authenticationMethod: 'api-key',
    });

    expect(availabilityService.checkAvailability).toHaveBeenCalledWith('hetzner', 'nbg1', 'cx23');
  });

  it('throws BadRequestException when customer profile is null', async () => {
    (customerProfilesService.getByUserId as jest.Mock).mockResolvedValue(null);
    (customerProfilesService.isProfileComplete as jest.Mock).mockReturnValue(false);

    await expect(service.createSubscription('user-1', 'plan-1')).rejects.toThrow(BadRequestException);
    await expect(service.createSubscription('user-1', 'plan-1')).rejects.toThrow(
      'Customer billing profile must be complete before ordering',
    );
    expect(plansRepository.findByIdOrThrow).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when customer profile is incomplete', async () => {
    (customerProfilesService.getByUserId as jest.Mock).mockResolvedValue({
      ...completeProfile,
      firstName: null,
    });
    (customerProfilesService.isProfileComplete as jest.Mock).mockReturnValue(false);

    await expect(service.createSubscription('user-1', 'plan-1')).rejects.toThrow(BadRequestException);
    await expect(service.createSubscription('user-1', 'plan-1')).rejects.toThrow(
      'Customer billing profile must be complete before ordering',
    );
    expect(plansRepository.findByIdOrThrow).not.toHaveBeenCalled();
  });

  it('rejects cancel when policy disallows', async () => {
    subscriptionsRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      createdAt: new Date(),
      currentPeriodEnd: new Date(),
      status: SubscriptionStatus.ACTIVE,
    });
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      cancelAtPeriodEnd: true,
      minCommitmentDays: 10,
      noticeDays: 0,
    });

    await expect(service.cancelSubscription('sub-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('queues withdrawal for unprovisioned subscription without tearing down inline', async () => {
    subscriptionsRepository.findByIdOrThrow = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.ACTIVE,
      })
      .mockResolvedValueOnce({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.ACTIVE,
      })
      .mockResolvedValueOnce({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
        withdrawnAt: new Date(),
        withdrawPhase: 'unprovisioned',
      });
    subscriptionsRepository.update = jest.fn().mockResolvedValue(undefined);
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({ id: 'plan-1', serviceTypeId: 'st-1' });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({ id: 'st-1', disallowStatutoryWithdrawal: false });
    itemsRepository.findBySubscription = jest
      .fn()
      .mockResolvedValue([{ provisioningStatus: 'pending', createdAt: new Date() }]);

    const result = await service.withdrawSubscription('sub-1', 'user-1');

    expect(backordersRepository.cancelPendingForUserPlan).toHaveBeenCalledWith('user-1', 'plan-1');
    expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', {
      status: SubscriptionStatus.PENDING_WITHDRAWAL,
      withdrawnAt: expect.any(Date),
      withdrawPhase: 'unprovisioned',
    });
    expect(withdrawalRefundService.estimateRefundGross).not.toHaveBeenCalled();
    expect(result.subscription.status).toBe(SubscriptionStatus.PENDING_WITHDRAWAL);
    expect(result.withdrawalResult?.paymentRefundStatus).toBe('not_applicable');
  });

  it('queues withdrawal for provisioned subscription with an estimated refund', async () => {
    subscriptionsRepository.findByIdOrThrow = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.ACTIVE,
      })
      .mockResolvedValueOnce({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.ACTIVE,
      })
      .mockResolvedValueOnce({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
        withdrawnAt: new Date(),
        withdrawPhase: 'withdrawal_period',
      });
    subscriptionsRepository.update = jest.fn().mockResolvedValue(undefined);
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({ id: 'plan-1', serviceTypeId: 'st-1' });
    typesRepository.findByIdOrThrow = jest.fn().mockResolvedValue({ id: 'st-1', disallowStatutoryWithdrawal: false });
    itemsRepository.findBySubscription = jest
      .fn()
      .mockResolvedValue([{ provisioningStatus: 'active', provisionedAt: new Date(), createdAt: new Date() }]);
    (withdrawalRefundService.estimateRefundGross as jest.Mock).mockResolvedValue(42);

    const result = await service.withdrawSubscription('sub-1', 'user-1');

    expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', {
      status: SubscriptionStatus.PENDING_WITHDRAWAL,
      withdrawnAt: expect.any(Date),
      withdrawPhase: 'withdrawal_period',
    });
    expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).not.toHaveBeenCalled();
    expect(result.withdrawalResult?.refundGross).toBe(42);
    expect(result.withdrawalResult?.paymentRefundStatus).toBe('pending');
  });

  describe('provisionSubscriptionItem', () => {
    it('skips when the item is not found', async () => {
      (itemsRepository.findByIdWithRelations as jest.Mock).mockResolvedValue(null);

      await service.provisionSubscriptionItem('missing');

      expect(provisioningService.provision).not.toHaveBeenCalled();
    });

    it('skips when the item is no longer pending', async () => {
      (itemsRepository.findByIdWithRelations as jest.Mock).mockResolvedValue({
        id: 'item-1',
        provisioningStatus: 'active',
        providerReference: 'srv-1',
        subscription: { status: SubscriptionStatus.ACTIVE },
      });

      await service.provisionSubscriptionItem('item-1');

      expect(provisioningService.provision).not.toHaveBeenCalled();
    });

    it('skips when the subscription is not active', async () => {
      (itemsRepository.findByIdWithRelations as jest.Mock).mockResolvedValue({
        id: 'item-1',
        provisioningStatus: 'pending',
        configSnapshot: { region: 'fsn1', serverType: 'cx23' },
        subscription: { status: SubscriptionStatus.PENDING_CANCEL },
        serviceType: { provider: 'hetzner' },
      });

      await service.provisionSubscriptionItem('item-1');

      expect(provisioningService.provision).not.toHaveBeenCalled();
      expect(hostnameReservationService.reserveHostname).not.toHaveBeenCalled();
    });

    it('provisions a pending item when invoked by the job', async () => {
      (itemsRepository.findByIdWithRelations as jest.Mock).mockResolvedValue({
        id: 'item-1',
        serviceTypeId: 'stype-1',
        provisioningStatus: 'pending',
        providerReference: undefined,
        configSnapshot: {
          ...controllerProvisioningDefaults,
          region: 'fsn1',
          serverType: 'cx23',
        },
        subscription: {
          id: 'sub-1',
          userId: 'user-1',
          planId: 'plan-1',
          status: SubscriptionStatus.ACTIVE,
          autoBackorder: false,
        },
        serviceType: { id: 'stype-1', provider: 'hetzner' },
      });
      (provisioningService.provision as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

      await service.provisionSubscriptionItem('item-1');

      expect(hostnameReservationService.reserveHostname).toHaveBeenCalledWith('item-1');
      expect(provisioningService.provision).toHaveBeenCalled();
      expect(itemsRepository.updateProviderReference).toHaveBeenCalledWith('item-1', 'srv-1');
      expect(itemsRepository.updateProvisioningStatus).toHaveBeenCalledWith('item-1', 'active');
    });
  });
});
