import { Public } from '@forepath/identity/backend';
import { Controller, Get, NotFoundException, ParseIntPipe, Query } from '@nestjs/common';

import { PublicServicePlanOfferingDto } from '../dto/public-service-plan-offering.dto';
import { ServicePlanEntity } from '../entities/service-plan.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { PricingService } from '../services/pricing.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';
import { WithdrawalPolicyService } from '../services/withdrawal-policy.service';
import { normalizeStoredProviderDefaults } from '../utils/provider-env-defaults.utils';
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

    const offerings = await Promise.all(rows.map((row) => this.mapToOffering(row)));
    let bestOffering = offerings[0];
    let bestPrice = bestOffering.totalPriceFrom ?? bestOffering.totalPrice;

    for (let i = 1; i < offerings.length; i++) {
      const offering = offerings[i];
      const price = offering.totalPriceFrom ?? offering.totalPrice;

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

    return Promise.all(rows.map((row) => this.mapToOffering(row)));
  }

  private async mapToOffering(row: ServicePlanEntity): Promise<PublicServicePlanOfferingDto> {
    const totalPrice = this.pricingService.calculate(row).totalPrice;
    const allowCustomerServerTypeSelection = row.allowCustomerServerTypeSelection === true;
    const allowedServerTypes = normalizeAllowedServerTypes(row.allowedServerTypes);
    let totalPriceFrom: number | undefined;

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
        const fromPricing = this.pricingService.calculate(row, lowestBase);

        totalPriceFrom = fromPricing.totalPrice;

        if (totalPriceFrom >= totalPrice) {
          totalPriceFrom = undefined;
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
      totalPrice,
      ...(totalPriceFrom != null ? { totalPriceFrom } : {}),
      orderingHighlights: row.orderingHighlights ?? [],
      allowCustomerLocationSelection: row.allowCustomerLocationSelection === true,
      allowCustomerServerTypeSelection,
      withdrawalPolicy: this.withdrawalPolicyService.buildPolicyInfo({
        disallowStatutoryWithdrawal: row.serviceType?.disallowStatutoryWithdrawal ?? false,
      }),
    };
  }
}
