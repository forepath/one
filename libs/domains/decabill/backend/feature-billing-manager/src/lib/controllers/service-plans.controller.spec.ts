import { BillingDocumentTermsConfigService } from '../services/billing-document-terms-config.service';
import { DeliveryTermsCode } from '../constants/document-terms.constants';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CreateServicePlanDto } from '../dto/create-service-plan.dto';
import { UpdateServicePlanDto } from '../dto/update-service-plan.dto';
import { BillingIntervalType, ServicePlanEntity } from '../entities/service-plan.entity';
import { TaxCategory } from '../constants/tax-category.constants';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { ProviderRegistryService } from '../services/provider-registry.service';
import { AddonService } from '../services/addon.service';
import { CloudInitConfigService } from '../services/cloud-init-config.service';
import { MeterService } from '../services/meter.service';
import { WithdrawalPolicyService } from '../services/withdrawal-policy.service';
import { AddonsRepository } from '../repositories/addons.repository';
import { PLAN_PRICE_MIGRATE_ENQUEUE } from '../queue/plan-price-migrate-enqueue.token';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { ContainerManagerCatalogService } from '../contributors/container-manager/services/container-manager-catalog.service';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';

import { ServicePlansController } from './service-plans.controller';

describe('ServicePlansController', () => {
  const planPriceMigrateEnqueueStub = {
    enqueueUnit: jest.fn().mockResolvedValue(undefined),
  };
  const basePlanRow: ServicePlanEntity = {
    id: '11111111-1111-4111-8111-111111111111',
    serviceTypeId: '22222222-2222-4222-8222-222222222222',
    tenantId: 'default',
    name: 'Pro',
    description: 'Desc',
    billingIntervalType: BillingIntervalType.MONTH,
    billingIntervalValue: 1,
    billingDayOfMonth: undefined,
    cancelAtPeriodEnd: true,
    billInAdvance: false,
    autoRecalculatePriceDaily: false,
    minCommitmentDays: 0,
    noticeDays: 0,
    basePrice: '10',
    marginPercent: '0',
    marginFixed: '0',
    providerConfigDefaults: {},
    orderingHighlights: [{ icon: 'star', text: 'Feature A' }],
    allowCustomerLocationSelection: false,
    allowCustomerServerTypeSelection: false,
    allowedServerTypes: [],
    allowCustomerProviderSelection: false,
    allowedProviders: [],
    taxCategory: TaxCategory.STANDARD,
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  };
  const schemaWithRegionEnum = {
    properties: {
      region: { type: 'string', enum: ['fsn1', 'nbg1'] },
    },
  };
  const serviceTypesRepoStub = {
    findByIdOrThrow: jest.fn().mockResolvedValue({
      id: basePlanRow.serviceTypeId,
      provider: 'hetzner',
      allowedProviders: ['hetzner'],
      configSchema: schemaWithRegionEnum,
      disallowStatutoryWithdrawal: false,
    }),
  };
  const providerRegistryStub = {
    getProviders: jest.fn().mockReturnValue([]),
  };
  const cloudInitConfigServiceStub = {
    assertActiveConfigForPlanDefaults: jest.fn().mockResolvedValue(undefined),
    buildOrderProvisioningOptions: jest.fn().mockResolvedValue([]),
    getOrderFieldsForPlan: jest.fn().mockResolvedValue([]),
  };
  const addonServiceStub = {
    assertAllowedAddonIdsForPlan: jest.fn().mockResolvedValue(undefined),
    providerSupportsAddons: jest.fn().mockReturnValue(true),
    getOrderFieldsForAddon: jest.fn().mockReturnValue([]),
  };
  const addonsRepositoryStub = {
    findByIds: jest.fn().mockResolvedValue([]),
  };
  const subscriptionsRepositoryStub = {
    countByPlanId: jest.fn().mockResolvedValue(0),
  };
  const containerManagerCatalogServiceStub = {
    applyIntegratedPlanDefaults: jest.fn(async (defaults: Record<string, unknown> | undefined) => defaults ?? {}),
  };
  const notificationPublisherStub = {
    publishServicePlanAllowedProvidersChanged: jest.fn(),
  };

  beforeEach(() => {
    planPriceMigrateEnqueueStub.enqueueUnit.mockReset();
    planPriceMigrateEnqueueStub.enqueueUnit.mockResolvedValue(undefined);
    serviceTypesRepoStub.findByIdOrThrow.mockReset();
    serviceTypesRepoStub.findByIdOrThrow.mockResolvedValue({
      id: basePlanRow.serviceTypeId,
      provider: 'hetzner',
      allowedProviders: ['hetzner'],
      configSchema: schemaWithRegionEnum,
      disallowStatutoryWithdrawal: false,
    });
    providerRegistryStub.getProviders.mockReset();
    providerRegistryStub.getProviders.mockReturnValue([]);
    cloudInitConfigServiceStub.assertActiveConfigForPlanDefaults.mockReset();
    cloudInitConfigServiceStub.assertActiveConfigForPlanDefaults.mockResolvedValue(undefined);
    addonServiceStub.assertAllowedAddonIdsForPlan.mockReset();
    addonServiceStub.assertAllowedAddonIdsForPlan.mockResolvedValue(undefined);
    addonServiceStub.providerSupportsAddons.mockReset();
    addonServiceStub.providerSupportsAddons.mockReturnValue(true);
    addonsRepositoryStub.findByIds.mockReset();
    addonsRepositoryStub.findByIds.mockResolvedValue([]);
    subscriptionsRepositoryStub.countByPlanId.mockReset();
    subscriptionsRepositoryStub.countByPlanId.mockResolvedValue(0);
    containerManagerCatalogServiceStub.applyIntegratedPlanDefaults.mockReset();
    containerManagerCatalogServiceStub.applyIntegratedPlanDefaults.mockImplementation(
      async (defaults: Record<string, unknown> | undefined) => defaults ?? {},
    );
    notificationPublisherStub.publishServicePlanAllowedProvidersChanged.mockReset();
  });

  function setupRepositoryMock(mock: Partial<jest.Mocked<ServicePlansRepository>>) {
    return Test.createTestingModule({
      controllers: [ServicePlansController],
      providers: [
        { provide: ServicePlansRepository, useValue: mock },
        { provide: ServiceTypesRepository, useValue: serviceTypesRepoStub },
        { provide: ProviderRegistryService, useValue: providerRegistryStub },
        { provide: CloudInitConfigService, useValue: cloudInitConfigServiceStub },
        { provide: AddonService, useValue: addonServiceStub },
        {
          provide: MeterService,
          useValue: {
            listPlanMeters: jest.fn().mockResolvedValue([]),
            listEffectivePlanMeters: jest.fn().mockResolvedValue([]),
            listAddonMeters: jest.fn().mockResolvedValue([]),
            attachPlanMeter: jest.fn(),
            updatePlanMeter: jest.fn(),
            detachPlanMeter: jest.fn(),
          },
        },
        { provide: AddonsRepository, useValue: addonsRepositoryStub },
        { provide: SubscriptionsRepository, useValue: subscriptionsRepositoryStub },
        { provide: WithdrawalPolicyService, useValue: new WithdrawalPolicyService() },
        { provide: ContainerManagerCatalogService, useValue: containerManagerCatalogServiceStub },
        { provide: BillingNotificationPublisher, useValue: notificationPublisherStub },
        BillingDocumentTermsConfigService,
        { provide: PLAN_PRICE_MIGRATE_ENQUEUE, useValue: planPriceMigrateEnqueueStub },
      ],
    }).compile();
  }

  it('list maps orderingHighlights', async () => {
    const findAll = jest.fn().mockResolvedValue([basePlanRow]);
    const moduleRef = await setupRepositoryMock({
      findAll,
      findByIdOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);
    const result = await controller.list();

    expect(result[0].orderingHighlights).toEqual([{ icon: 'star', text: 'Feature A' }]);
    expect(result[0].allowCustomerLocationSelection).toBe(false);
  });

  it('get maps orderingHighlights', async () => {
    const findByIdOrThrow = jest.fn().mockResolvedValue(basePlanRow);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow,
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);
    const result = await controller.get('11111111-1111-4111-8111-111111111111');

    expect(result.orderingHighlights).toEqual([{ icon: 'star', text: 'Feature A' }]);
    expect(result.allowCustomerLocationSelection).toBe(false);
  });

  it('create defaults orderingHighlights to empty array', async () => {
    const create = jest
      .fn()
      .mockImplementation((dto: Partial<ServicePlanEntity>) =>
        Promise.resolve({ ...basePlanRow, ...dto, orderingHighlights: dto.orderingHighlights ?? [] }),
      );
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create,
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.create({
      serviceTypeId: basePlanRow.serviceTypeId,
      name: 'Basic',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
    } as CreateServicePlanDto);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ orderingHighlights: [], allowCustomerLocationSelection: false }),
    );
  });

  it('create passes orderingHighlights from dto', async () => {
    const highlights = [{ icon: 'check', text: 'Included' }];
    const create = jest
      .fn()
      .mockImplementation((dto: Partial<ServicePlanEntity>) => Promise.resolve({ ...basePlanRow, ...dto }));
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create,
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.create({
      serviceTypeId: basePlanRow.serviceTypeId,
      name: 'Basic',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      orderingHighlights: highlights,
    } as CreateServicePlanDto);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ orderingHighlights: highlights }));
  });

  describe('payment and delivery terms', () => {
    const setup = async (existing: Partial<ServicePlanEntity> = {}) => {
      const create = jest
        .fn()
        .mockImplementation((dto: Partial<ServicePlanEntity>) => Promise.resolve({ ...basePlanRow, ...dto }));
      const update = jest
        .fn()
        .mockImplementation((_id: string, dto: Partial<ServicePlanEntity>) =>
          Promise.resolve({ ...basePlanRow, ...existing, ...dto }),
        );
      const moduleRef = await setupRepositoryMock({
        findAll: jest.fn(),
        findByIdOrThrow: jest.fn().mockResolvedValue({ ...basePlanRow, ...existing }),
        create,
        update,
        delete: jest.fn(),
      });

      return { controller: moduleRef.get(ServicePlansController), create, update };
    };

    it('create stores normalized overrides and returns effective terms', async () => {
      const { controller, create } = await setup();
      const result = await controller.create({
        serviceTypeId: basePlanRow.serviceTypeId,
        name: 'Basic',
        billingIntervalType: BillingIntervalType.MONTH,
        billingIntervalValue: 1,
        paymentDueDays: 0,
        deliveryTermsCode: DeliveryTermsCode.CUSTOM,
        deliveryTermsPlace: 'dropped',
        deliveryTermsText: ' Online access\u0000 ',
      } as CreateServicePlanDto);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentDueDays: 0,
          deliveryTermsCode: DeliveryTermsCode.CUSTOM,
          deliveryTermsPlace: null,
          deliveryTermsText: 'Online access',
        }),
      );
      expect(result.effectiveDocumentTerms).toEqual({
        paymentDueDays: 0,
        deliveryTermsCode: DeliveryTermsCode.CUSTOM,
        deliveryTermsPlace: null,
        deliveryTermsText: 'Online access',
      });
    });

    it('create without terms inherits the global default', async () => {
      const { controller, create } = await setup();
      const result = await controller.create({
        serviceTypeId: basePlanRow.serviceTypeId,
        name: 'Basic',
        billingIntervalType: BillingIntervalType.MONTH,
        billingIntervalValue: 1,
      } as CreateServicePlanDto);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ paymentDueDays: null, deliveryTermsCode: null, deliveryTermsText: null }),
      );
      expect(result.paymentDueDays).toBeNull();
      expect(result.effectiveDocumentTerms.paymentDueDays).toBe(14);
    });

    it('create rejects CUSTOM delivery terms without text', async () => {
      const { controller, create } = await setup();

      await expect(
        controller.create({
          serviceTypeId: basePlanRow.serviceTypeId,
          name: 'Basic',
          billingIntervalType: BillingIntervalType.MONTH,
          billingIntervalValue: 1,
          deliveryTermsCode: DeliveryTermsCode.CUSTOM,
        } as CreateServicePlanDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    });

    it('update leaves terms untouched when omitted', async () => {
      const { controller, update } = await setup({ paymentDueDays: 30, deliveryTermsCode: DeliveryTermsCode.DAP });

      await controller.update('11111111-1111-4111-8111-111111111111', { name: 'Renamed' } as UpdateServicePlanDto);

      const patch = update.mock.calls[0][1] as Partial<ServicePlanEntity>;

      expect('paymentDueDays' in patch).toBe(false);
      expect('deliveryTermsCode' in patch).toBe(false);
    });

    it('update merges a partial delivery change with the stored code', async () => {
      const { controller, update } = await setup({
        deliveryTermsCode: DeliveryTermsCode.DAP,
        deliveryTermsPlace: 'Berlin',
      });

      await controller.update('11111111-1111-4111-8111-111111111111', {
        deliveryTermsPlace: 'Hamburg',
      } as UpdateServicePlanDto);

      expect(update.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          deliveryTermsCode: DeliveryTermsCode.DAP,
          deliveryTermsPlace: 'Hamburg',
          deliveryTermsText: null,
        }),
      );
    });

    it('update clears overrides with null', async () => {
      const { controller, update } = await setup({ paymentDueDays: 30, deliveryTermsCode: DeliveryTermsCode.DAP });

      await controller.update('11111111-1111-4111-8111-111111111111', {
        paymentDueDays: null,
        deliveryTermsCode: null,
      } as UpdateServicePlanDto);

      expect(update.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          paymentDueDays: null,
          deliveryTermsCode: null,
          deliveryTermsPlace: null,
          deliveryTermsText: null,
        }),
      );
    });
  });

  it('update omits orderingHighlights when dto does not include it', async () => {
    const update = jest.fn().mockResolvedValue(basePlanRow);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue(basePlanRow),
      create: jest.fn(),
      update,
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.update('11111111-1111-4111-8111-111111111111', { name: 'Renamed' } as UpdateServicePlanDto);
    expect(update).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.not.objectContaining({ orderingHighlights: expect.anything() }),
    );
    expect(update.mock.calls[0][1]).toEqual(expect.objectContaining({ name: 'Renamed' }));
    expect(cloudInitConfigServiceStub.assertActiveConfigForPlanDefaults).not.toHaveBeenCalled();
  });

  it('update validates provisioning options only when providerConfigDefaults are sent', async () => {
    const update = jest.fn().mockResolvedValue(basePlanRow);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue({
        ...basePlanRow,
        providerConfigDefaults: { service: 'agenstra-manager', region: 'fsn1' },
      }),
      create: jest.fn(),
      update,
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.update('11111111-1111-4111-8111-111111111111', { name: 'Renamed' } as UpdateServicePlanDto);

    expect(cloudInitConfigServiceStub.assertActiveConfigForPlanDefaults).not.toHaveBeenCalled();
  });

  it('update passes orderingHighlights when dto includes it', async () => {
    const update = jest.fn().mockResolvedValue({ ...basePlanRow, orderingHighlights: [] });
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue(basePlanRow),
      create: jest.fn(),
      update,
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.update('11111111-1111-4111-8111-111111111111', { orderingHighlights: [] } as UpdateServicePlanDto);
    expect(update).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ orderingHighlights: [] }),
    );
  });

  it('create rejects allowCustomerLocationSelection when schema has no geography enum', async () => {
    providerRegistryStub.getProviders.mockReturnValueOnce([]);
    serviceTypesRepoStub.findByIdOrThrow.mockResolvedValueOnce({
      id: basePlanRow.serviceTypeId,
      provider: 'hetzner',
      configSchema: { properties: {} },
    });
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(
      controller.create({
        serviceTypeId: basePlanRow.serviceTypeId,
        name: 'Basic',
        billingIntervalType: BillingIntervalType.MONTH,
        billingIntervalValue: 1,
        allowCustomerLocationSelection: true,
      } as CreateServicePlanDto),
    ).rejects.toThrow(BadRequestException);
  });

  it('create passes allowCustomerLocationSelection when schema supports region enum', async () => {
    serviceTypesRepoStub.findByIdOrThrow.mockResolvedValueOnce({
      id: basePlanRow.serviceTypeId,
      configSchema: schemaWithRegionEnum,
    });
    const create = jest
      .fn()
      .mockImplementation((dto: Partial<ServicePlanEntity>) => Promise.resolve({ ...basePlanRow, ...dto }));
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create,
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.create({
      serviceTypeId: basePlanRow.serviceTypeId,
      name: 'Basic',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      allowCustomerLocationSelection: true,
    } as CreateServicePlanDto);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ allowCustomerLocationSelection: true }));
  });

  it('create passes allowCustomerLocationSelection when service type configSchema is empty but provider registry has geography enum', async () => {
    serviceTypesRepoStub.findByIdOrThrow.mockResolvedValueOnce({
      id: basePlanRow.serviceTypeId,
      provider: 'hetzner',
      configSchema: {},
    });
    providerRegistryStub.getProviders.mockReturnValueOnce([
      {
        id: 'hetzner',
        displayName: 'Hetzner',
        configSchema: {
          properties: {
            location: { type: 'string', enum: ['fsn1', 'nbg1'] },
          },
        },
      },
    ]);
    const create = jest
      .fn()
      .mockImplementation((dto: Partial<ServicePlanEntity>) => Promise.resolve({ ...basePlanRow, ...dto }));
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create,
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.create({
      serviceTypeId: basePlanRow.serviceTypeId,
      name: 'Basic',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      allowCustomerLocationSelection: true,
    } as CreateServicePlanDto);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ allowCustomerLocationSelection: true }));
  });

  it('create validates custom CloudInit config in current tenant', async () => {
    const create = jest
      .fn()
      .mockImplementation((dto: Partial<ServicePlanEntity>) => Promise.resolve({ ...basePlanRow, ...dto }));
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create,
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);
    const providerConfigDefaults = {
      provisioningOptions: [{ type: 'custom', cloudInitConfigId: '33333333-3333-4333-8333-333333333333' }],
      region: 'fsn1',
      serverType: 'cx23',
    };

    await controller.create({
      serviceTypeId: basePlanRow.serviceTypeId,
      name: 'Custom plan',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      providerConfigDefaults,
    } as CreateServicePlanDto);

    expect(cloudInitConfigServiceStub.assertActiveConfigForPlanDefaults).toHaveBeenCalledWith(
      basePlanRow.serviceTypeId,
      expect.objectContaining({
        provisioningOptions: [{ type: 'custom', cloudInitConfigId: '33333333-3333-4333-8333-333333333333' }],
        service: 'custom',
        cloudInitConfigId: '33333333-3333-4333-8333-333333333333',
      }),
    );
  });

  it('create promotes legacy service-only providerConfigDefaults for API clients', async () => {
    const create = jest
      .fn()
      .mockImplementation((dto: Partial<ServicePlanEntity>) => Promise.resolve({ ...basePlanRow, ...dto }));
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create,
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.create({
      serviceTypeId: basePlanRow.serviceTypeId,
      name: 'Legacy manager plan',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      providerConfigDefaults: {
        service: 'agenstra-manager',
        region: 'fsn1',
        serverType: 'cx23',
      },
    } as CreateServicePlanDto);

    expect(cloudInitConfigServiceStub.assertActiveConfigForPlanDefaults).toHaveBeenCalledWith(
      basePlanRow.serviceTypeId,
      expect.objectContaining({
        provisioningOptions: [{ type: 'integrated', service: 'agenstra-manager' }],
        service: 'agenstra-manager',
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerConfigDefaults: expect.objectContaining({
          provisioningOptions: [{ type: 'integrated', service: 'agenstra-manager' }],
          service: 'agenstra-manager',
        }),
      }),
    );
  });

  it('update promotes legacy service-only providerConfigDefaults for API clients', async () => {
    const update = jest.fn().mockResolvedValue(basePlanRow);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue(basePlanRow),
      create: jest.fn(),
      update,
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.update('11111111-1111-4111-8111-111111111111', {
      providerConfigDefaults: {
        service: 'agenstra-manager',
        region: 'fsn1',
        serverType: 'cx23',
      },
    } as UpdateServicePlanDto);

    expect(update).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        providerConfigDefaults: expect.objectContaining({
          provisioningOptions: [{ type: 'integrated', service: 'agenstra-manager' }],
          service: 'agenstra-manager',
        }),
      }),
    );
  });

  it('lists order provisioning options for a plan', async () => {
    const options = [
      {
        optionKey: 'integrated:agenstra-controller',
        type: 'integrated',
        service: 'agenstra-controller',
        label: 'Agenstra Controller',
      },
    ];
    cloudInitConfigServiceStub.buildOrderProvisioningOptions.mockResolvedValue(options);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue(basePlanRow),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(controller.listOrderProvisioningOptions(basePlanRow.id)).resolves.toEqual(options);
    expect(cloudInitConfigServiceStub.buildOrderProvisioningOptions).toHaveBeenCalledWith({});
  });

  it('returns plan-scoped cloud init order fields', async () => {
    const orderFields = [{ key: 'API_KEY', label: 'API Key', required: true, hasDefault: false }];
    cloudInitConfigServiceStub.getOrderFieldsForPlan.mockResolvedValue(orderFields);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue(basePlanRow),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(
      controller.getCloudInitOrderFields(basePlanRow.id, '33333333-3333-4333-8333-333333333333'),
    ).resolves.toEqual(orderFields);
    expect(cloudInitConfigServiceStub.getOrderFieldsForPlan).toHaveBeenCalledWith(
      basePlanRow.id,
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('create rejects allowCustomerProviderSelection with a single provider', async () => {
    serviceTypesRepoStub.findByIdOrThrow.mockResolvedValueOnce({
      id: basePlanRow.serviceTypeId,
      provider: 'hetzner',
      allowedProviders: ['hetzner', 'digital-ocean'],
      configSchema: schemaWithRegionEnum,
      disallowStatutoryWithdrawal: false,
    });
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(
      controller.create({
        serviceTypeId: basePlanRow.serviceTypeId,
        name: 'Basic',
        billingIntervalType: BillingIntervalType.MONTH,
        billingIntervalValue: 1,
        allowCustomerProviderSelection: true,
        allowedProviders: ['hetzner'],
      } as CreateServicePlanDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rejects allowCustomerProviderSelection when service type has fewer than two providers', async () => {
    serviceTypesRepoStub.findByIdOrThrow.mockResolvedValueOnce({
      id: basePlanRow.serviceTypeId,
      provider: 'hetzner',
      allowedProviders: ['hetzner'],
      configSchema: schemaWithRegionEnum,
      disallowStatutoryWithdrawal: false,
    });
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(
      controller.create({
        serviceTypeId: basePlanRow.serviceTypeId,
        name: 'Basic',
        billingIntervalType: BillingIntervalType.MONTH,
        billingIntervalValue: 1,
        allowCustomerProviderSelection: true,
        allowedProviders: ['hetzner', 'digital-ocean'],
      } as CreateServicePlanDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create passes allowCustomerProviderSelection with at least two providers', async () => {
    serviceTypesRepoStub.findByIdOrThrow.mockResolvedValueOnce({
      id: basePlanRow.serviceTypeId,
      provider: 'hetzner',
      allowedProviders: ['hetzner', 'digital-ocean'],
      configSchema: schemaWithRegionEnum,
      disallowStatutoryWithdrawal: false,
    });
    const create = jest
      .fn()
      .mockImplementation((dto: Partial<ServicePlanEntity>) => Promise.resolve({ ...basePlanRow, ...dto }));
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create,
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await controller.create({
      serviceTypeId: basePlanRow.serviceTypeId,
      name: 'Basic',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      allowCustomerProviderSelection: true,
      allowedProviders: ['hetzner', 'digital-ocean'],
    } as CreateServicePlanDto);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCustomerProviderSelection: true,
        allowedProviders: ['hetzner', 'digital-ocean'],
      }),
    );
  });

  it('create with null serviceTypeId stores null and skips provider asserts', async () => {
    const create = jest.fn().mockImplementation((dto: Partial<ServicePlanEntity>) =>
      Promise.resolve({
        ...basePlanRow,
        ...dto,
        serviceTypeId: dto.serviceTypeId ?? null,
      }),
    );
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create,
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    const result = await controller.create({
      serviceTypeId: null,
      name: 'Billing only',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      basePrice: '25',
    } as CreateServicePlanDto);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceTypeId: null,
        providerConfigDefaults: {},
        allowCustomerLocationSelection: false,
        allowCustomerServerTypeSelection: false,
        allowCustomerProviderSelection: false,
        allowedProviders: [],
        autoRecalculatePriceDaily: false,
      }),
    );
    expect(cloudInitConfigServiceStub.assertActiveConfigForPlanDefaults).not.toHaveBeenCalled();
    expect(addonServiceStub.assertAllowedAddonIdsForPlan).not.toHaveBeenCalled();
    expect(serviceTypesRepoStub.findByIdOrThrow).not.toHaveBeenCalled();
    expect(result.serviceTypeId).toBeNull();
  });

  it('create with null serviceTypeId rejects location selection', async () => {
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(
      controller.create({
        serviceTypeId: null,
        name: 'Billing only',
        billingIntervalType: BillingIntervalType.MONTH,
        billingIntervalValue: 1,
        allowCustomerLocationSelection: true,
      } as CreateServicePlanDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('get maps null serviceTypeId as null', async () => {
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue({ ...basePlanRow, serviceTypeId: null }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    const result = await controller.get(basePlanRow.id);

    expect(result.serviceTypeId).toBeNull();
    expect(serviceTypesRepoStub.findByIdOrThrow).not.toHaveBeenCalled();
  });

  it('listOrderProvisioningOptions returns empty for none plans', async () => {
    cloudInitConfigServiceStub.buildOrderProvisioningOptions.mockClear();
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue({ ...basePlanRow, serviceTypeId: null }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(controller.listOrderProvisioningOptions(basePlanRow.id)).resolves.toEqual([]);
    expect(cloudInitConfigServiceStub.buildOrderProvisioningOptions).not.toHaveBeenCalled();
  });

  it('remove blocks delete when subscriptions reference the plan', async () => {
    const deleteFn = jest.fn();
    subscriptionsRepositoryStub.countByPlanId.mockResolvedValue(2);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue(basePlanRow),
      create: jest.fn(),
      update: jest.fn(),
      delete: deleteFn,
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(controller.remove(basePlanRow.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('remove deletes when no subscriptions reference the plan', async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue(basePlanRow),
      create: jest.fn(),
      update: jest.fn(),
      delete: deleteFn,
    });
    const controller = moduleRef.get(ServicePlansController);

    await expect(controller.remove(basePlanRow.id)).resolves.toBeUndefined();
    expect(deleteFn).toHaveBeenCalledWith(basePlanRow.id);
  });

  it('listOrderAddons filters by provider query param', async () => {
    const planWithAddons = {
      ...basePlanRow,
      providerConfigDefaults: { allowedAddonIds: ['addon-1', 'addon-2'] },
    };
    addonsRepositoryStub.findByIds.mockResolvedValue([
      {
        id: 'addon-1',
        key: 'hetzner-only',
        name: 'Hetzner only',
        isActive: true,
        compatibleProviders: ['hetzner'],
        implementationType: 'module',
        basePrice: '5',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 1,
      },
      {
        id: 'addon-2',
        key: 'do-only',
        name: 'DO only',
        isActive: true,
        compatibleProviders: ['digital-ocean'],
        implementationType: 'module',
        basePrice: '3',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 1,
      },
    ]);
    const moduleRef = await setupRepositoryMock({
      findAll: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue(planWithAddons),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const controller = moduleRef.get(ServicePlansController);

    const result = await controller.listOrderAddons(planWithAddons.id, 'digital-ocean');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('addon-2');
    expect(result[0].compatibleProviders).toEqual(['digital-ocean']);
  });
});
