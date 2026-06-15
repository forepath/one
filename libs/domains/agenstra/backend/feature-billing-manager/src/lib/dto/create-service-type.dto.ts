import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';

export class CreateServiceTypeDto {
  @IsNotEmpty({ message: 'Key is required' })
  @IsString({ message: 'Key must be a string' })
  key!: string;

  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsNotEmpty({ message: 'Provider is required' })
  @IsString({ message: 'Provider must be a string' })
  provider!: string;

  @IsOptional()
  @IsObject({ message: 'Config schema must be an object' })
  configSchema?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;
}
