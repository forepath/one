import { Test } from '@nestjs/testing';

import { BillingIntervalType, ServicePlanEntity } from '../entities/service-plan.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { InvoiceTaxContextService } from '../services/invoice-tax-context.service';
import { PricingService } from '../services/pricing.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';
import { TaxCalculationService } from '../services/tax-calculation.service';
import { TaxPreviewService } from '../services/tax-preview.service';
import { TaxRateConfigService } from '../services/tax-rate-config.service';

import { PricingController } from './pricing.controller';

describe('PricingController', () => {
  const planRow = {
    id: '11111111-1111-4111-8111-111111111111',
    serviceTypeId: '22222222-2222-4222-8222-222222222222',
    name: 'Pro',
    billingIntervalType: BillingIntervalType.MONTH,
    billingIntervalValue: 1,
    billInAdvance: false,
    basePrice: '10',
    marginPercent: '0',
    marginFixed: '0',
    taxCategory: 'standard',
    providerConfigDefaults: { serverType: 'cx11' },
  } as unknown as ServicePlanEntity;

  const authReq = { user: { id: 'user-1', roles: ['user'] } };

  let controller: PricingController;
  let findPlanById: jest.Mock;
  let findServiceTypeById: jest.Mock;
  let calculate: jest.Mock;
  let getServerTypes: jest.Mock;

  beforeEach(async () => {
    findPlanById = jest.fn().mockResolvedValue(planRow);
    findServiceTypeById = jest.fn().mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      provider: 'hetzner',
      providerDefaults: { HETZNER_API_TOKEN: 'tenant-token' },
    });
    calculate = jest.fn().mockImplementation((plan: ServicePlanEntity, baseOverride?: number) => ({
      basePrice: baseOverride ?? Number(plan.basePrice),
      marginPercent: 0,
      marginFixed: 0,
      totalPrice: baseOverride ?? Number(plan.basePrice),
    }));
    getServerTypes = jest.fn().mockResolvedValue([
      { id: 'cx11', priceMonthly: 4.15 },
      { id: 'cpx11', priceMonthly: 6.49 },
    ]);

    const moduleRef = await Test.createTestingModule({
      controllers: [PricingController],
      providers: [
        { provide: ServicePlansRepository, useValue: { findByIdOrThrow: findPlanById } },
        { provide: ServiceTypesRepository, useValue: { findByIdOrThrow: findServiceTypeById } },
        { provide: PricingService, useValue: { calculate } },
        TaxRateConfigService,
        TaxCalculationService,
        { provide: ProviderServerTypesService, useValue: { getServerTypes } },
        {
          provide: InvoiceTaxContextService,
          useValue: {
            resolveForUser: jest.fn().mockResolvedValue({
              treatment: {
                taxMode: 'domestic_vat',
                taxCountryCode: 'DE',
                chargeVat: true,
                invoiceNote: '',
                einvoiceTaxCategoryCode: 'S',
                issuerIsInEu: true,
              },
              forceChargeNonEuIssuerEuB2b: false,
            }),
          },
        },
        {
          provide: TaxPreviewService,
          useValue: { preview: jest.fn() },
        },
        { provide: ProviderServerTypesService, useValue: { getServerTypes } },
      ],
    }).compile();

    controller = moduleRef.get(PricingController);
  });

  it('returns zeroed preview when planId is missing', async () => {
    const result = await controller.preview({ planId: '' }, authReq as never);

    expect(result).toEqual({
      totalPrice: 0,
      basePrice: 0,
      marginPercent: 0,
      marginFixed: 0,
      taxTotal: 0,
      totalGross: 0,
      taxRate: 0,
      taxCategory: 'standard',
    });
    expect(findPlanById).not.toHaveBeenCalled();
  });

  it('uses requested server type price when catalog match exists', async () => {
    const result = await controller.preview(
      {
        planId: planRow.id,
        requestedConfig: { serverType: 'cpx11' },
      },
      authReq as never,
    );

    expect(getServerTypes).toHaveBeenCalledWith('hetzner', { HETZNER_API_TOKEN: 'tenant-token' });
    expect(calculate).toHaveBeenCalledWith(planRow, 6.49);
    expect(result.totalPrice).toBe(6.49);
    expect(result.totalGross).toBeCloseTo(7.72, 2);
    expect(result.taxRate).toBe(19);
    expect(result.taxCategory).toBe('standard');
  });

  it('falls back to plan pricing when server type catalog price is missing', async () => {
    getServerTypes.mockResolvedValue([{ id: 'cx11', priceMonthly: 4.15 }]);

    const result = await controller.preview(
      {
        planId: planRow.id,
        requestedConfig: { serverType: 'unknown-type' },
      },
      authReq as never,
    );

    expect(calculate).toHaveBeenCalledWith(planRow);
    expect(result.totalPrice).toBe(10);
    expect(result.totalGross).toBeCloseTo(11.9, 2);
  });

  it('applies reduced tax category from plan', async () => {
    findPlanById.mockResolvedValue({
      ...planRow,
      taxCategory: 'reduced',
      providerConfigDefaults: {},
    });

    const result = await controller.preview({ planId: planRow.id }, authReq as never);

    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ taxCategory: 'reduced' }));
    expect(result.taxCategory).toBe('reduced');
    expect(result.taxRate).toBe(7);
    expect(result.totalGross).toBeCloseTo(10.7, 2);
  });
});
