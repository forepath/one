import { Body, Controller, Post } from '@nestjs/common';

import { PricingPreviewDto } from '../dto/pricing-preview.dto';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { PricingService } from '../services/pricing.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';
import { TaxCalculationService } from '../services/tax-calculation.service';
import { normalizeStoredProviderDefaults } from '../utils/provider-env-defaults.utils';
import { enrichPricingWithStandardTax } from '../utils/pricing-tax.utils';
import { resolveServerTypePriceMonthly } from '../utils/server-type-billing.utils';

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly providerServerTypesService: ProviderServerTypesService,
  ) {}

  @Post('preview')
  async preview(@Body() dto: PricingPreviewDto) {
    if (!dto.planId) {
      return {
        totalPrice: 0,
        basePrice: 0,
        marginPercent: 0,
        marginFixed: 0,
        taxTotal: 0,
        totalGross: 0,
        taxRate: 0,
      };
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(dto.planId);
    const requestedServerType = dto.requestedConfig?.['serverType'];
    const serverTypeId =
      typeof requestedServerType === 'string' && requestedServerType.trim()
        ? requestedServerType.trim()
        : typeof plan.providerConfigDefaults?.['serverType'] === 'string'
          ? String(plan.providerConfigDefaults['serverType']).trim()
          : '';

    if (serverTypeId) {
      const serviceType = await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId);
      const providerDefaults = normalizeStoredProviderDefaults(serviceType.providerDefaults);
      const priceMonthly = await resolveServerTypePriceMonthly(
        this.providerServerTypesService,
        serviceType.provider,
        serverTypeId,
        providerDefaults,
      );

      if (priceMonthly != null) {
        return enrichPricingWithStandardTax(
          this.pricingService.calculate(plan, priceMonthly),
          this.taxCalculationService,
        );
      }
    }

    return enrichPricingWithStandardTax(this.pricingService.calculate(plan), this.taxCalculationService);
  }
}
