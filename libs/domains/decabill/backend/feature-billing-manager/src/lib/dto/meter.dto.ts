import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

import { METER_AGGREGATORS, type MeterAggregator } from '../entities/meter.entity';

export class CreateMeterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  unitLabel?: string;

  @IsIn(METER_AGGREGATORS)
  aggregator!: MeterAggregator;

  @IsNumber()
  @Min(0)
  defaultUnitPriceNet!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMeterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  unitLabel?: string | null;

  @IsOptional()
  @IsIn(METER_AGGREGATORS)
  aggregator?: MeterAggregator;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultUnitPriceNet?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AttachMeterDto {
  @IsUUID('4')
  meterId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceNet?: number | null;
}

export class UpdateAttachedMeterDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceNet?: number | null;
}

export class MeterAttachmentInputDto {
  @IsUUID('4')
  meterId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceNet?: number | null;
}
