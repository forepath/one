import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateServiceTypeDto {
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'Provider must be a string' })
  provider?: string;

  @IsOptional()
  @IsObject({ message: 'Config schema must be an object' })
  configSchema?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;
}
