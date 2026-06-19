import { IsObject, IsOptional, IsString } from 'class-validator';

export class PricingPreviewDto {
  @IsOptional()
  @IsString({ message: 'Plan ID must be a string' })
  planId?: string;

  @IsOptional()
  @IsObject({ message: 'Requested config must be an object' })
  requestedConfig?: Record<string, unknown>;
}
