import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { BillingIntervalType, ServicePlanEntity } from '../entities/service-plan.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { PricingService } from '../services/pricing.service';

import { PublicServicePlanOfferingsController } from './public-service-plan-offerings.controller';

describe('PublicServicePlanOfferingsController', () => {
  const planRow = {
    id: '11111111-1111-4111-8111-111111111111',
    serviceTypeId: '22222222-2222-4222-8222-222222222222',
    name: 'Pro',
    description: 'Full stack',
    billingIntervalType: BillingIntervalType.MONTH,
    billingIntervalValue: 1,
    orderingHighlights: [{ icon: 'check', text: 'Included' }],
    serviceType: { name: 'Agent Hosting' },
  } as ServicePlanEntity;
  let controller: PublicServicePlanOfferingsController;
  let findActiveWithServiceType: jest.Mock;
  let findAllActiveWithServiceType: jest.Mock;
  let calculate: jest.Mock;

  beforeEach(async () => {
    findActiveWithServiceType = jest.fn().mockResolvedValue([planRow]);
    findAllActiveWithServiceType = jest.fn().mockResolvedValue([planRow]);
    calculate = jest.fn().mockReturnValue({
      basePrice: 10,
      marginPercent: 10,
      marginFixed: 1,
      totalPrice: 12,
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicServicePlanOfferingsController],
      providers: [
        {
          provide: ServicePlansRepository,
          useValue: { findActiveWithServiceType, findAllActiveWithServiceType },
        },
        { provide: PricingService, useValue: { calculate } },
      ],
    }).compile();

    controller = moduleRef.get(PublicServicePlanOfferingsController);
  });

  it('returns mapped offerings with totalPrice from PricingService', async () => {
    const result = await controller.list(undefined, undefined, undefined);

    expect(findActiveWithServiceType).toHaveBeenCalledWith(50, 0, undefined);
    expect(calculate).toHaveBeenCalledWith(planRow);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: planRow.id,
      name: 'Pro',
      description: 'Full stack',
      serviceTypeId: planRow.serviceTypeId,
      serviceTypeName: 'Agent Hosting',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      totalPrice: 12,
      orderingHighlights: [{ icon: 'check', text: 'Included' }],
      allowCustomerLocationSelection: false,
    });
  });

  it('does not expose internal pricing fields on response objects', async () => {
    const result = await controller.list(10, 0, undefined);
    const json = JSON.parse(JSON.stringify(result[0]));

    expect(json).not.toHaveProperty('basePrice');
    expect(json).not.toHaveProperty('marginPercent');
    expect(json).not.toHaveProperty('providerConfigDefaults');
    expect(json).not.toHaveProperty('isActive');
  });

  it('forwards serviceTypeId to repository', async () => {
    findActiveWithServiceType.mockResolvedValue([]);
    await controller.list(undefined, undefined, '22222222-2222-4222-8222-222222222222');
    expect(findActiveWithServiceType).toHaveBeenCalledWith(50, 0, '22222222-2222-4222-8222-222222222222');
  });

  it('caps limit at 100', async () => {
    findActiveWithServiceType.mockResolvedValue([]);
    await controller.list(999, 0, undefined);
    expect(findActiveWithServiceType).toHaveBeenCalledWith(100, 0, undefined);
  });

  it('uses empty serviceTypeName when relation missing', async () => {
    const rowNoType = { ...planRow, serviceType: undefined } as ServicePlanEntity;

    findActiveWithServiceType.mockResolvedValue([rowNoType]);
    calculate.mockReturnValue({ totalPrice: 5, basePrice: 5, marginPercent: 0, marginFixed: 0 });
    const result = await controller.list(10, 0, undefined);

    expect(result[0].serviceTypeName).toBe('');
  });

  describe('getCheapest', () => {
    const planCheap = {
      ...planRow,
      id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      name: 'Basic',
    } as ServicePlanEntity;
    const planExpensive = {
      ...planRow,
      id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      name: 'Enterprise',
    } as ServicePlanEntity;

    it('returns the plan with the lowest totalPrice', async () => {
      findAllActiveWithServiceType.mockResolvedValue([planExpensive, planCheap]);
      calculate.mockImplementation((row: ServicePlanEntity) => ({
        basePrice: 0,
        marginPercent: 0,
        marginFixed: 0,
        totalPrice: row.name === 'Basic' ? 9.99 : 99,
      }));

      const result = await controller.getCheapest(undefined);

      expect(findAllActiveWithServiceType).toHaveBeenCalledWith(undefined);
      expect(result.id).toBe(planCheap.id);
      expect(result.totalPrice).toBe(9.99);
    });

    it('breaks ties with lexicographically smaller plan id', async () => {
      const planA = { ...planRow, id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', name: 'A' } as ServicePlanEntity;
      const planB = { ...planRow, id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', name: 'B' } as ServicePlanEntity;

      findAllActiveWithServiceType.mockResolvedValue([planB, planA]);
      calculate.mockReturnValue({ basePrice: 1, marginPercent: 0, marginFixed: 0, totalPrice: 10 });

      const result = await controller.getCheapest(undefined);

      expect(result.id).toBe(planA.id);
    });

    it('forwards serviceTypeId to findAllActiveWithServiceType', async () => {
      findAllActiveWithServiceType.mockResolvedValue([planRow]);
      await controller.getCheapest('22222222-2222-4222-8222-222222222222');
      expect(findAllActiveWithServiceType).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    });

    it('throws NotFoundException when no active plans', async () => {
      findAllActiveWithServiceType.mockResolvedValue([]);
      await expect(controller.getCheapest(undefined)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
