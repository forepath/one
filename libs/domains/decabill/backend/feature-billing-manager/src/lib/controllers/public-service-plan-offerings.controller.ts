import { Public } from '@forepath/identity/backend';
import { Controller, Get, NotFoundException, ParseIntPipe, Query } from '@nestjs/common';

import { PublicServicePlanOfferingDto } from '../dto/public-service-plan-offering.dto';
import { ServicePlanEntity } from '../entities/service-plan.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { PricingService } from '../services/pricing.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';
import { TaxCalculationService } from '../services/tax-calculation.service';
import { InvoiceTaxContextService } from '../services/invoice-tax-context.service';
import { WithdrawalPolicyService } from '../services/withdrawal-policy.service';
import { normalizeStoredProviderDefaults } from '../utils/provider-env-defaults.utils';
import { enrichPricingWithTax } from '../utils/pricing-tax.utils';
import { resolvePlanTaxCategory } from '../utils/plan-tax.utils';
import { normalizeAllowedServerTypes } from '../utils/provider-server-type.utils';
import { resolveLowestServerTypePriceMonthly } from '../utils/server-type-billing.utils';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Controller('public/service-plan-offerings')
@Public()
export class PublicServicePlanOfferingsController {
  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly pricingService: PricingService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
    private readonly providerServerTypesService: ProviderServerTypesService,
  ) {}

  /**
   * Single active offering with the lowest customer total price (for "from …" copy). Tie-break: lexicographic plan id.
   */
  @Get('cheapest')
  async getCheapest(@Query('serviceTypeId') serviceTypeId?: string): Promise<PublicServicePlanOfferingDto> {
    const rows = await this.servicePlansRepository.findAllActiveWithServiceType(serviceTypeId);

    if (rows.length === 0) {
      throw new NotFoundException('No active service plan offerings');
    }

    const computeOptions = await this.resolveIssuerComputeOptions();
    const offerings = await Promise.all(rows.map((row) => this.mapToOffering(row, computeOptions)));
    let bestOffering = offerings[0];
    let bestPrice = bestOffering.totalGrossFrom ?? bestOffering.totalGross;

    for (let i = 1; i < offerings.length; i++) {
      const offering = offerings[i];
      const price = offering.totalGrossFrom ?? offering.totalGross;

      if (price < bestPrice || (price === bestPrice && offering.id < bestOffering.id)) {
        bestPrice = price;
        bestOffering = offering;
      }
    }

    return bestOffering;
  }

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('serviceTypeId') serviceTypeId?: string,
  ): Promise<PublicServicePlanOfferingDto[]> {
    const rawLimit = limit ?? DEFAULT_LIMIT;
    const take = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1), MAX_LIMIT);
    const rawOffset = offset ?? 0;
    const skip = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);
    const rows = await this.servicePlansRepository.findActiveWithServiceType(take, skip, serviceTypeId);
    const computeOptions = await this.resolveIssuerComputeOptions();

    return Promise.all(rows.map((row) => this.mapToOffering(row, computeOptions)));
  }

  private async resolveIssuerComputeOptions() {
    const taxContext = await this.invoiceTaxContextService.resolveIssuerDefault();

    return {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    };
  }

  private async mapToOffering(
    row: ServicePlanEntity,
    computeOptions: Awaited<ReturnType<PublicServicePlanOfferingsController['resolveIssuerComputeOptions']>>,
  ): Promise<PublicServicePlanOfferingDto> {
    const taxCategory = resolvePlanTaxCategory(row);
    const pricingWithTax = enrichPricingWithTax(
      this.pricingService.calculate(row),
      taxCategory,
      this.taxCalculationService,
      computeOptions,
    );
    const allowCustomerServerTypeSelection = row.allowCustomerServerTypeSelection === true;
    const allowedServerTypes = normalizeAllowedServerTypes(row.allowedServerTypes);
    let totalPriceFrom: number | undefined;
    let totalGrossFrom: number | undefined;

    if (allowCustomerServerTypeSelection && allowedServerTypes.length > 0) {
      const provider = row.serviceType?.provider;
      const providerDefaults = normalizeStoredProviderDefaults(row.serviceType?.providerDefaults);
      const lowestBase = await resolveLowestServerTypePriceMonthly(
        this.providerServerTypesService,
        provider,
        allowedServerTypes,
        providerDefaults,
      );

      if (lowestBase != null) {
        const fromPricing = enrichPricingWithTax(
          this.pricingService.calculate(row, lowestBase),
          taxCategory,
          this.taxCalculationService,
          computeOptions,
        );

        totalPriceFrom = fromPricing.totalPrice;
        totalGrossFrom = fromPricing.totalGross;

        if (totalPriceFrom >= pricingWithTax.totalPrice) {
          totalPriceFrom = undefined;
          totalGrossFrom = undefined;
        }
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      serviceTypeId: row.serviceTypeId,
      serviceTypeName: row.serviceType?.name ?? '',
      billingIntervalType: row.billingIntervalType,
      billingIntervalValue: row.billingIntervalValue,
      totalPrice: pricingWithTax.totalPrice,
      totalGross: pricingWithTax.totalGross,
      taxRate: pricingWithTax.taxRate,
      ...(totalPriceFrom != null ? { totalPriceFrom } : {}),
      ...(totalGrossFrom != null ? { totalGrossFrom } : {}),
      orderingHighlights: row.orderingHighlights ?? [],
      allowCustomerLocationSelection: row.allowCustomerLocationSelection === true,
      allowCustomerServerTypeSelection,
      withdrawalPolicy: this.withdrawalPolicyService.buildPolicyInfo({
        disallowStatutoryWithdrawal: row.serviceType?.disallowStatutoryWithdrawal ?? false,
      }),
    };
  }
}
