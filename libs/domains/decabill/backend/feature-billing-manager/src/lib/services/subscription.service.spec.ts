import { BadRequestException } from '@nestjs/common';

import { BillingIntervalType } from '../entities/service-plan.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import {
  buildBillingCloudInitUserData,
  buildCloudInitConfigFromRequest,
} from '../utils/cloud-init/agent-controller.utils';
import {
  buildAgentManagerCloudInitConfigFromRequest,
  buildAgentManagerCloudInitUserData,
} from '../utils/cloud-init/agent-manager.utils';
import { validateConfigSchema } from '../utils/config-validation.utils';

import { AvailabilityService } from './availability.service';
import { BackorderService } from './backorder.service';
import { BillingScheduleService } from './billing-schedule.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { CustomerProfilesService } from './customer-profiles.service';
import { SubscriptionService } from './subscription.service';

jest.mock('../utils/config-validation.utils', () => ({
  validateConfigSchema: jest.fn().mockReturnValue([]),
}));

jest.mock('../utils/cloud-init/agent-controller.utils', () => ({
  buildCloudInitConfigFromRequest: jest
    .fn()
    .mockImplementation((effectiveConfig: Record<string, unknown>, hostname: string, baseDomain?: string) => ({
      host: {
        hostname,
        fqdn: `${hostname}.${baseDomain ?? 'spirde.com'}`,
      },
      backend: {
        authentication: {
          authenticationMethod: (effectiveConfig.authenticationMethod as string) ?? 'users',
          disableSignup: false,
        },
        encryption: { encryptionKey: 'mock-key', jwtSecret: 'mock-secret' },
      },
    })),
  buildBillingCloudInitUserData: jest.fn().mockReturnValue('#!/bin/bash\necho hello'),
}));

jest.mock('../utils/cloud-init/agent-manager.utils', () => ({
  buildAgentManagerCloudInitConfigFromRequest: jest.fn().mockReturnValue({ host: {}, backend: {} }),
  buildAgentManagerCloudInitUserData: jest.fn().mockReturnValue('#!/bin/bash\necho manager'),
}));

describe('SubscriptionService', () => {
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
    findAllByUser: jest.fn(),
  } as unknown as SubscriptionsRepository;
  const itemsRepository = {
    create: jest.fn(),
    updateProviderReference: jest.fn(),
    updateProvisioningStatus: jest.fn(),
    updateHostname: jest.fn().mockResolvedValue({}),
    updateSshPrivateKey: jest.fn().mockResolvedValue({}),
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
  );

  beforeEach(() => {
    jest.resetAllMocks();
    (customerProfilesService.getByUserId as jest.Mock).mockResolvedValue(completeProfile);
    (customerProfilesService.isProfileComplete as jest.Mock).mockReturnValue(true);
    (validateConfigSchema as jest.Mock).mockReturnValue([]);
    (buildCloudInitConfigFromRequest as jest.Mock).mockImplementation(
      (effectiveConfig: Record<string, unknown>, hostname: string, baseDomain?: string) => ({
        host: {
          hostname,
          fqdn: `${hostname}.${baseDomain ?? 'spirde.com'}`,
        },
        backend: {
          authentication: {
            authenticationMethod: (effectiveConfig.authenticationMethod as string) ?? 'users',
            disableSignup: false,
          },
          encryption: { encryptionKey: 'mock-key', jwtSecret: 'mock-secret' },
        },
      }),
    );
    (buildBillingCloudInitUserData as jest.Mock).mockReturnValue('#!/bin/bash\necho hello');
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

  it('creates subscription with schedule', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
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
    expect(subscriptionsRepository.create).toHaveBeenCalled();
    expect(itemsRepository.create).toHaveBeenCalled();
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
    expect(hostnameReservationService.reserveHostname).toHaveBeenCalledWith('item-1');
    expect(provisioningService.provision).toHaveBeenCalledWith('hetzner', {
      name: 'awesome-armadillo-abc12',
      serverType: 'cx23',
      location: 'fsn1',
      firewallId: undefined,
      userData: '#!/bin/bash\necho hello',
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
    expect(buildCloudInitConfigFromRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'fsn1',
        serverType: 'cx23',
        authenticationMethod: 'api-key',
        sshPublicKey: expect.any(String),
      }),
      'awesome-armadillo-abc12',
      'spirde.com',
    );
    expect(buildBillingCloudInitUserData).toHaveBeenCalledWith(
      expect.objectContaining({
        host: {
          hostname: 'awesome-armadillo-abc12',
          fqdn: 'awesome-armadillo-abc12.spirde.com',
        },
        backend: expect.objectContaining({
          authentication: expect.objectContaining({
            authenticationMethod: 'api-key',
            disableSignup: false,
          }),
          encryption: expect.objectContaining({
            encryptionKey: expect.any(String),
            jwtSecret: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('calls manager cloud-init builder when service is manager', async () => {
    (buildAgentManagerCloudInitUserData as jest.Mock).mockReturnValue('#!/bin/bash\necho manager');
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
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

    expect(itemsRepository.updateSshPrivateKey).toHaveBeenCalledWith('item-1', expect.any(String));
    expect(buildAgentManagerCloudInitConfigFromRequest).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'fsn1', service: 'manager', sshPublicKey: expect.any(String) }),
      'awesome-armadillo-abc12',
      'spirde.com',
    );
    expect(buildAgentManagerCloudInitUserData).toHaveBeenCalled();
    expect(buildCloudInitConfigFromRequest).not.toHaveBeenCalled();
    expect(buildBillingCloudInitUserData).not.toHaveBeenCalled();
    expect(provisioningService.provision).toHaveBeenCalledWith(
      'hetzner',
      expect.objectContaining({ userData: '#!/bin/bash\necho manager' }),
    );
  });

  it('provisions when provider is digital-ocean', async () => {
    plansRepository.findByIdOrThrow = jest.fn().mockResolvedValue({
      id: 'plan-1',
      serviceTypeId: 'stype-1',
      billingIntervalType: BillingIntervalType.DAY,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
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
});
