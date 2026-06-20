import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CreateServicePlanDto } from '../dto/create-service-plan.dto';
import { UpdateServicePlanDto } from '../dto/update-service-plan.dto';
import { BillingIntervalType, ServicePlanEntity } from '../entities/service-plan.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { ProviderRegistryService } from '../services/provider-registry.service';

import { ServicePlansController } from './service-plans.controller';

describe('ServicePlansController', () => {
  const basePlanRow: ServicePlanEntity = {
    id: '11111111-1111-4111-8111-111111111111',
    serviceTypeId: '22222222-2222-4222-8222-222222222222',
    name: 'Pro',
    description: 'Desc',
    billingIntervalType: BillingIntervalType.MONTH,
    billingIntervalValue: 1,
    billingDayOfMonth: undefined,
    cancelAtPeriodEnd: true,
    minCommitmentDays: 0,
    noticeDays: 0,
    basePrice: '10',
    marginPercent: '0',
    marginFixed: '0',
    providerConfigDefaults: {},
    orderingHighlights: [{ icon: 'star', text: 'Feature A' }],
    allowCustomerLocationSelection: false,
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
      configSchema: schemaWithRegionEnum,
    }),
  };
  const providerRegistryStub = {
    getProviders: jest.fn().mockReturnValue([]),
  };

  beforeEach(() => {
    serviceTypesRepoStub.findByIdOrThrow.mockReset();
    serviceTypesRepoStub.findByIdOrThrow.mockResolvedValue({
      id: basePlanRow.serviceTypeId,
      provider: 'hetzner',
      configSchema: schemaWithRegionEnum,
    });
    providerRegistryStub.getProviders.mockReset();
    providerRegistryStub.getProviders.mockReturnValue([]);
  });

  function setupRepositoryMock(mock: Partial<jest.Mocked<ServicePlansRepository>>) {
    return Test.createTestingModule({
      controllers: [ServicePlansController],
      providers: [
        { provide: ServicePlansRepository, useValue: mock },
        { provide: ServiceTypesRepository, useValue: serviceTypesRepoStub },
        { provide: ProviderRegistryService, useValue: providerRegistryStub },
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
});
