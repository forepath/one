import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class AvailabilityCheckDto {
  @IsNotEmpty({ message: 'Service type ID is required' })
  @IsString({ message: 'Service type ID must be a string' })
  serviceTypeId!: string;

  @IsNotEmpty({ message: 'Region is required' })
  @IsString({ message: 'Region must be a string' })
  region!: string;

  @IsNotEmpty({ message: 'Server type is required' })
  @IsString({ message: 'Server type must be a string' })
  serverType!: string;

  @IsOptional()
  @IsObject({ message: 'Requested config must be an object' })
  requestedConfig?: Record<string, unknown>;
}
