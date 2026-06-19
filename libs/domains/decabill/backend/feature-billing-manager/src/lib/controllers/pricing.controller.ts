import { Body, Controller, Post } from '@nestjs/common';

import { PricingPreviewDto } from '../dto/pricing-preview.dto';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { PricingService } from '../services/pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly servicePlansRepository: ServicePlansRepository,
  ) {}

  @Post('preview')
  async preview(@Body() dto: PricingPreviewDto) {
    if (!dto.planId) {
      return { totalPrice: 0, basePrice: 0, marginPercent: 0, marginFixed: 0 };
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(dto.planId);

    return this.pricingService.calculate(plan);
  }
}
