import { Body, Controller, Post } from '@nestjs/common';

import { AvailabilityCheckDto } from '../dto/availability-check.dto';
import { AvailabilityResponseDto } from '../dto/availability-response.dto';
import { AvailabilityService } from '../services/availability.service';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Post('check')
  async check(@Body() dto: AvailabilityCheckDto): Promise<AvailabilityResponseDto> {
    const provider = (dto.requestedConfig?.provider as string | undefined) ?? 'hetzner';
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
