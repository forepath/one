import { BillingIntervalType } from '../entities/service-plan.entity';
import { buildProvisioningUserData } from '../utils/cloud-init/cloud-init-dispatch.utils';

import { BackorderService } from './backorder.service';

jest.mock('../utils/cloud-init/cloud-init-dispatch.utils', () => ({
  buildProvisioningUserData: jest.fn().mockReturnValue('base64-cloud-init-userdata'),
  normalizeCloudInitService: jest.fn((service: string | undefined) => {
    if (service === 'manager' || service === 'custom') {
      return service;
    }

    return 'controller';
  }),
}));

describe('BackorderService', () => {
  const controllerProvisioningDefaults = {
    provisioningOptions: [{ type: 'integrated', service: 'controller' }],
  };
  const cloudInitConfigService = {
    findByIdForProvisioning: jest.fn(),
    resolveEnvironmentVariables: jest.fn(),
  } as any;
  const hostnameReservationService = {
    reserveHostname: jest.fn().mockResolvedValue('awesome-armadillo-abc12'),
    releaseHostname: jest.fn().mockResolvedValue(undefined),
  } as any;
  const cloudflareDnsService = {
    createARecord: jest.fn().mockResolvedValue(undefined),
  } as any;

  const createService = (
    overrides: {
      backordersRepository?: any;
      servicePlansRepository?: any;
      subscriptionItemsRepository?: any;
      provisioningService?: any;
    } = {},
  ) =>
    new BackorderService(
      overrides.backordersRepository ?? ({ create: jest.fn().mockResolvedValue({ id: 'b1' }) } as any),
      { checkAvailability: jest.fn().mockResolvedValue({ isAvailable: true }) } as any,
      overrides.servicePlansRepository ?? ({ findByIdOrThrow: jest.fn() } as any),
      {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 's1',
          provider: 'hetzner',
          configSchema: {},
        }),
      } as any,
      { create: jest.fn().mockResolvedValue({ id: 'sub-1' }) } as any,
      overrides.subscriptionItemsRepository ??
        ({
          create: jest.fn().mockResolvedValue({ id: 'item-1' }),
          updateProviderReference: jest.fn(),
          updateProvisioningStatus: jest.fn(),
        } as any),
      {
        calculateSchedule: jest.fn().mockReturnValue({
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          nextBillingAt: new Date(),
        }),
      } as any,
      overrides.provisioningService ?? ({ provision: jest.fn().mockResolvedValue({ serverId: 'srv-1' }) } as any),
      hostnameReservationService,
      cloudflareDnsService,
      cloudInitConfigService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    (buildProvisioningUserData as jest.Mock).mockReturnValue('base64-cloud-init-userdata');
  });

  it('creates backorder', async () => {
    const service = createService();
    const result = await service.create({
      userId: 'u1',
      serviceTypeId: 's1',
      planId: 'p1',
      requestedConfigSnapshot: {},
    });

    expect(result.id).toBe('b1');
  });

  it('updates provider reference on retry', async () => {
    const backordersRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        planId: 'p1',
        serviceTypeId: 's1',
        requestedConfigSnapshot: { region: 'fsn1', serverType: 'cx11' },
      }),
      update: jest.fn().mockResolvedValue({ id: 'b1' }),
    } as any;
    const subscriptionItemsRepository = {
      create: jest.fn().mockResolvedValue({ id: 'item-1' }),
      updateProviderReference: jest.fn(),
      updateProvisioningStatus: jest.fn(),
      updateHostname: jest.fn().mockResolvedValue({}),
      updateSshPrivateKey: jest.fn().mockResolvedValue({}),
    } as any;
    const provisioningService = {
      provision: jest.fn().mockResolvedValue({ serverId: 'srv-1' }),
      getServerInfo: jest.fn().mockResolvedValue({ publicIp: '1.2.3.4' }),
      ensurePublicIpForDns: jest.fn().mockResolvedValue('1.2.3.4'),
    } as any;
    const service = createService({
      backordersRepository,
      subscriptionItemsRepository,
      provisioningService,
      servicePlansRepository: {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'p1',
          serviceTypeId: 's1',
          billingIntervalType: BillingIntervalType.MONTH,
          billingIntervalValue: 1,
          allowCustomerLocationSelection: false,
          providerConfigDefaults: {
            ...controllerProvisioningDefaults,
          },
        }),
      } as any,
    });

    await service.retry('b1');
    expect(hostnameReservationService.reserveHostname).toHaveBeenCalledWith('item-1');
    expect(subscriptionItemsRepository.updateSshPrivateKey).toHaveBeenCalledWith('item-1', expect.any(String));
    expect(buildProvisioningUserData).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'controller',
        hostname: 'awesome-armadillo-abc12',
        baseDomain: 'spirde.com',
      }),
    );
    expect(provisioningService.provision).toHaveBeenCalledWith(
      'hetzner',
      expect.objectContaining({
        name: 'awesome-armadillo-abc12',
        userData: 'base64-cloud-init-userdata',
      }),
    );
    expect(subscriptionItemsRepository.updateProviderReference).toHaveBeenCalledWith('item-1', 'srv-1');
    expect(provisioningService.getServerInfo).toHaveBeenCalledWith('hetzner', 'srv-1');
    expect(cloudflareDnsService.createARecord).toHaveBeenCalledWith('awesome-armadillo-abc12', '1.2.3.4');
  });

  it('retry uses plan default geography when allowCustomerLocationSelection is false and snapshot overrides', async () => {
    const backordersRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        planId: 'p1',
        serviceTypeId: 's1',
        requestedConfigSnapshot: {
          region: 'nbg1',
          serverType: 'cx11',
          service: 'controller',
          authenticationMethod: 'api-key',
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 'b1' }),
    } as any;
    const subscriptionItemsRepository = {
      create: jest.fn().mockResolvedValue({ id: 'item-1' }),
      updateProviderReference: jest.fn(),
      updateProvisioningStatus: jest.fn(),
      updateHostname: jest.fn().mockResolvedValue({}),
      updateSshPrivateKey: jest.fn().mockResolvedValue({}),
    } as any;
    const provisioningService = {
      provision: jest.fn().mockResolvedValue({ serverId: 'srv-1' }),
      getServerInfo: jest.fn().mockResolvedValue({ publicIp: '1.2.3.4' }),
      ensurePublicIpForDns: jest.fn().mockResolvedValue('1.2.3.4'),
    } as any;
    const service = createService({
      backordersRepository,
      subscriptionItemsRepository,
      provisioningService,
      servicePlansRepository: {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'p1',
          serviceTypeId: 's1',
          billingIntervalType: BillingIntervalType.MONTH,
          billingIntervalValue: 1,
          allowCustomerLocationSelection: false,
          providerConfigDefaults: {
            ...controllerProvisioningDefaults,
            region: 'fsn1',
            serverType: 'cx11',
            authenticationMethod: 'api-key',
          },
        }),
      } as any,
    });

    await service.retry('b1');

    expect(provisioningService.provision).toHaveBeenCalledWith(
      'hetzner',
      expect.objectContaining({ location: 'fsn1' }),
    );
  });

  it('retry provisions custom service via buildProvisioningUserData', async () => {
    const template = {
      id: 'cfg-1',
      dockerImage: 'myapp:latest',
      containerPort: 8080,
      hostPort: 80,
      workDir: '/opt/myapp',
      environmentVariables: [],
    };
    const resolvedEnv = { API_KEY: 'secret' };

    cloudInitConfigService.findByIdForProvisioning.mockResolvedValue(template);
    cloudInitConfigService.resolveEnvironmentVariables.mockReturnValue(resolvedEnv);

    const backordersRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        planId: 'p1',
        serviceTypeId: 's1',
        requestedConfigSnapshot: {
          region: 'fsn1',
          serverType: 'cx11',
          service: 'custom',
          env: { API_KEY: 'secret' },
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 'b1' }),
    } as any;
    const subscriptionItemsRepository = {
      create: jest.fn().mockResolvedValue({ id: 'item-1' }),
      updateProviderReference: jest.fn(),
      updateProvisioningStatus: jest.fn(),
      updateHostname: jest.fn().mockResolvedValue({}),
      updateSshPrivateKey: jest.fn().mockResolvedValue({}),
    } as any;
    const provisioningService = {
      provision: jest.fn().mockResolvedValue({ serverId: 'srv-1' }),
      getServerInfo: jest.fn().mockResolvedValue({ publicIp: '1.2.3.4' }),
      ensurePublicIpForDns: jest.fn().mockResolvedValue('1.2.3.4'),
    } as any;
    const service = createService({
      backordersRepository,
      subscriptionItemsRepository,
      provisioningService,
      servicePlansRepository: {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'p1',
          serviceTypeId: 's1',
          billingIntervalType: BillingIntervalType.MONTH,
          billingIntervalValue: 1,
          allowCustomerLocationSelection: false,
          providerConfigDefaults: {
            provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-1' }],
            region: 'fsn1',
            serverType: 'cx11',
          },
        }),
      } as any,
    });

    await service.retry('b1');

    expect(cloudInitConfigService.findByIdForProvisioning).toHaveBeenCalledWith('cfg-1');
    expect(cloudInitConfigService.resolveEnvironmentVariables).toHaveBeenCalled();
    expect(buildProvisioningUserData).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'custom',
        customTemplate: template,
        resolvedCustomEnv: resolvedEnv,
      }),
    );
  });

  it('retries legacy manager-only plans from snapshot service field', async () => {
    const backordersRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        planId: 'p1',
        serviceTypeId: 's1',
        requestedConfigSnapshot: {
          region: 'fsn1',
          serverType: 'cx11',
          service: 'manager',
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 'b1' }),
    } as any;
    const subscriptionItemsRepository = {
      create: jest.fn().mockResolvedValue({ id: 'item-1' }),
      updateProviderReference: jest.fn(),
      updateProvisioningStatus: jest.fn(),
      updateHostname: jest.fn().mockResolvedValue({}),
      updateSshPrivateKey: jest.fn().mockResolvedValue({}),
    } as any;
    const provisioningService = {
      provision: jest.fn().mockResolvedValue({ serverId: 'srv-1' }),
      getServerInfo: jest.fn().mockResolvedValue({ publicIp: '1.2.3.4' }),
      ensurePublicIpForDns: jest.fn().mockResolvedValue('1.2.3.4'),
    } as any;
    const service = createService({
      backordersRepository,
      subscriptionItemsRepository,
      provisioningService,
      servicePlansRepository: {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'p1',
          serviceTypeId: 's1',
          billingIntervalType: BillingIntervalType.MONTH,
          billingIntervalValue: 1,
          allowCustomerLocationSelection: false,
          providerConfigDefaults: {
            service: 'manager',
            region: 'fsn1',
            serverType: 'cx11',
          },
        }),
      } as any,
    });

    await service.retry('b1');

    expect(buildProvisioningUserData).toHaveBeenCalledWith(expect.objectContaining({ service: 'manager' }));
  });

  it('rejects retry when provisioning selection is invalid', async () => {
    const backordersRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        planId: 'p1',
        serviceTypeId: 's1',
        requestedConfigSnapshot: {},
      }),
      update: jest.fn(),
    } as any;
    const service = createService({
      backordersRepository,
      servicePlansRepository: {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'p1',
          serviceTypeId: 's1',
          billingIntervalType: BillingIntervalType.MONTH,
          billingIntervalValue: 1,
          providerConfigDefaults: {
            provisioningOptions: [
              { type: 'integrated', service: 'controller' },
              { type: 'integrated', service: 'manager' },
            ],
          },
        }),
      } as any,
    });

    await expect(service.retry('b1')).rejects.toThrow('provisioningOptionKey is required');
  });
});
