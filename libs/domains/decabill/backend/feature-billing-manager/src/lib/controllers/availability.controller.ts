import { RequireScopes } from '@forepath/identity/backend';
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';

import { AvailabilityCheckDto } from '../dto/availability-check.dto';
import { AvailabilityResponseDto } from '../dto/availability-response.dto';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { AvailabilityService } from '../services/availability.service';
import { resolveEffectiveProvider, resolveServiceTypeAllowedProviders } from '../utils/provider-selection.utils';

@Controller('availability')
@RequireScopes('subscriptions:write')
export class AvailabilityController {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly serviceTypesRepository: ServiceTypesRepository,
  ) {}

  @Post('check')
  async check(@Body() dto: AvailabilityCheckDto): Promise<AvailabilityResponseDto> {
    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(dto.serviceTypeId);
    const typeAllowed = resolveServiceTypeAllowedProviders(serviceType);
    // AvailabilityCheckDto has no planId; treat the service-type allowlist as selectable.
    const provider = resolveEffectiveProvider(
      serviceType,
      { allowCustomerProviderSelection: true, allowedProviders: typeAllowed },
      dto.requestedConfig,
    );

    if (!provider) {
      throw new BadRequestException('No provider is configured for this service type');
    }

    const response = await this.availabilityService.checkAvailability(provider, dto.region, dto.serverType);

    return {
      isAvailable: response.isAvailable,
      reason: response.reason,
      alternatives: response.alternatives,
    };
  }

  @Post('alternatives')
  async alternatives(@Body() dto: AvailabilityCheckDto): Promise<AvailabilityResponseDto> {
    return await this.check(dto);
  }
}
