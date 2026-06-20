import { Public } from '@forepath/identity/backend';
import { Controller, Get, NotFoundException, ParseIntPipe, Query } from '@nestjs/common';

import { PublicServicePlanOfferingDto } from '../dto/public-service-plan-offering.dto';
import { ServicePlanEntity } from '../entities/service-plan.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { PricingService } from '../services/pricing.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Controller('public/service-plan-offerings')
@Public()
export class PublicServicePlanOfferingsController {
  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly pricingService: PricingService,
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

    let bestRow = rows[0];
    let bestPrice = this.pricingService.calculate(bestRow).totalPrice;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const price = this.pricingService.calculate(row).totalPrice;

      if (price < bestPrice || (price === bestPrice && row.id < bestRow.id)) {
        bestPrice = price;
        bestRow = row;
      }
    }

    return this.mapToOffering(bestRow);
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

    return rows.map((row) => this.mapToOffering(row));
  }

  private mapToOffering(row: ServicePlanEntity): PublicServicePlanOfferingDto {
    const totalPrice = this.pricingService.calculate(row).totalPrice;

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      serviceTypeId: row.serviceTypeId,
      serviceTypeName: row.serviceType?.name ?? '',
      billingIntervalType: row.billingIntervalType,
      billingIntervalValue: row.billingIntervalValue,
      totalPrice,
      orderingHighlights: row.orderingHighlights ?? [],
      allowCustomerLocationSelection: row.allowCustomerLocationSelection === true,
    };
  }
}
