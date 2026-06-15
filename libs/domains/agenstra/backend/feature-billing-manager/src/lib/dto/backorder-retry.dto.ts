import { IsObject, IsOptional, IsString } from 'class-validator';

export class BackorderRetryDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  reason?: string;

  @IsOptional()
  @IsObject({ message: 'Override config must be an object' })
  overrideConfig?: Record<string, unknown>;
}
