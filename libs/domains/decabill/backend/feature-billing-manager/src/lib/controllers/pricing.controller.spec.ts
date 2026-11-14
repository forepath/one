import { Test } from '@nestjs/testing';

import { BillingIntervalType, ServicePlanEntity } from '../entities/service-plan.entity';
import { AddonsRepository } from '../repositories/addons.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { AddonService } from '../services/addon.service';
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
    autoRecalculatePriceDaily: false,
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
  let resolveOrderAddonSelection: jest.Mock;

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
    resolveOrderAddonSelection = jest.fn().mockResolvedValue({ compatible: [], incompatible: [] });

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
        { provide: AddonService, useValue: { resolveOrderAddonSelection } },
        { provide: AddonsRepository, useValue: { findByIds: jest.fn().mockResolvedValue([]) } },
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
      addonLines: [],
      addonsTotal: 0,
      grandTotal: 0,
    });
    expect(findPlanById).not.toHaveBeenCalled();
  });

  it('uses requested server type price when customer server type selection is enabled', async () => {
    findPlanById.mockResolvedValue({
      ...planRow,
      allowCustomerServerTypeSelection: true,
      allowedServerTypes: ['cx11', 'cpx11'],
    });

    const result = await controller.preview(
      {
        planId: planRow.id,
        requestedConfig: { serverType: 'cpx11' },
      },
      authReq as never,
    );

    expect(getServerTypes).toHaveBeenCalledWith('hetzner', { HETZNER_API_TOKEN: 'tenant-token' });
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ allowCustomerServerTypeSelection: true }), 6.49);
    expect(result.totalPrice).toBe(6.49);
    expect(result.totalGross).toBeCloseTo(7.72, 2);
    expect(result.taxRate).toBe(19);
    expect(result.taxCategory).toBe('standard');
  });

  it('resolves catalog price from requested provider when customer provider selection is enabled', async () => {
    findPlanById.mockResolvedValue({
      ...planRow,
      allowCustomerServerTypeSelection: true,
      allowCustomerProviderSelection: true,
      allowedServerTypes: ['cx11', 's-1vcpu-1gb'],
      allowedProviders: ['hetzner', 'digital-ocean'],
      providerConfigDefaults: { serverType: 'cx11' },
    });
    findServiceTypeById.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      provider: 'hetzner',
      allowedProviders: ['hetzner', 'digital-ocean'],
      providerDefaults: {
        HETZNER_API_TOKEN: 'tenant-token',
        DIGITALOCEAN_API_TOKEN: 'do-token',
      },
    });
    getServerTypes.mockImplementation(async (providerId: string) => {
      if (providerId === 'digital-ocean') {
        return [{ id: 's-1vcpu-1gb', priceMonthly: 6 }];
      }

      return [
        { id: 'cx11', priceMonthly: 4.15 },
        { id: 'cpx11', priceMonthly: 6.49 },
      ];
    });

    const result = await controller.preview(
      {
        planId: planRow.id,
        requestedConfig: { provider: 'digital-ocean', serverType: 's-1vcpu-1gb' },
      },
      authReq as never,
    );

    expect(getServerTypes).toHaveBeenCalledWith('digital-ocean', {
      HETZNER_API_TOKEN: 'tenant-token',
      DIGITALOCEAN_API_TOKEN: 'do-token',
    });
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ allowCustomerProviderSelection: true }), 6);
    expect(result.totalPrice).toBe(6);
  });

  it('ignores provisioning default server type when customer selection is disabled', async () => {
    findPlanById.mockResolvedValue({
      ...planRow,
      allowCustomerServerTypeSelection: false,
      providerConfigDefaults: { serverType: 'cpx11' },
    });

    const result = await controller.preview(
      {
        planId: planRow.id,
        requestedConfig: { serverType: 'cpx11' },
      },
      authReq as never,
    );

    expect(getServerTypes).not.toHaveBeenCalled();
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ allowCustomerServerTypeSelection: false }));
    expect(result.totalPrice).toBe(10);
  });

  it('falls back to plan pricing when server type catalog price is missing', async () => {
    findPlanById.mockResolvedValue({
      ...planRow,
      allowCustomerServerTypeSelection: true,
      allowedServerTypes: ['cx11', 'cpx11'],
    });
    getServerTypes.mockResolvedValue([{ id: 'cx11', priceMonthly: 4.15 }]);

    const result = await controller.preview(
      {
        planId: planRow.id,
        requestedConfig: { serverType: 'unknown-type' },
      },
      authReq as never,
    );

    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ allowCustomerServerTypeSelection: true }));
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

  it('marks incompatible addons invalid and excludes them from totals', async () => {
    findPlanById.mockResolvedValue({
      ...planRow,
      providerConfigDefaults: { allowedAddonIds: ['addon-1', 'addon-2'] },
    });
    resolveOrderAddonSelection.mockResolvedValue({
      compatible: [
        {
          id: 'addon-1',
          name: 'Compatible',
          basePrice: '5',
          priceIntervalType: BillingIntervalType.MONTH,
          priceIntervalValue: 1,
        },
      ],
      incompatible: [
        {
          id: 'addon-2',
          name: 'Incompatible',
          basePrice: '3',
          priceIntervalType: BillingIntervalType.MONTH,
          priceIntervalValue: 1,
        },
      ],
    });

    const result = await controller.preview(
      {
        planId: planRow.id,
        addonIds: ['addon-1', 'addon-2'],
        requestedConfig: { provider: 'digital-ocean' },
      },
      authReq as never,
    );

    expect(result.addonLines).toEqual([
      { addonId: 'addon-1', name: 'Compatible', periodPrice: 5 },
      { addonId: 'addon-2', name: 'Incompatible', periodPrice: 3, invalid: true },
    ]);
    expect(result.addonsTotal).toBe(5);
    expect(result.grandTotal).toBe(15);
  });
});
