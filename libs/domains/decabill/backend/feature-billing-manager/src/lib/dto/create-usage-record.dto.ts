import { IsIn, IsISO8601, IsNumber, IsObject, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';

import type { UsageAttachmentType } from '../entities/usage-record.entity';

export class CreateUsageRecordDto {
  @IsUUID('4', { message: 'Subscription ID must be a UUID' })
  subscriptionId!: string;

  @IsISO8601({}, { message: 'periodStart must be an ISO date string' })
  periodStart!: string;

  @IsISO8601({}, { message: 'periodEnd must be an ISO date string' })
  periodEnd!: string;

  @IsOptional()
  @IsObject({ message: 'usagePayload must be an object' })
  usagePayload?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4', { message: 'meterId must be a UUID' })
  meterId?: string;

  @ValidateIf((dto: CreateUsageRecordDto) => dto.meterId != null)
  @IsNumber({}, { message: 'value must be a number when meterId is set' })
  @Min(0, { message: 'value must be greater than or equal to 0 when meterId is set' })
  value?: number;

  @IsOptional()
  @IsIn(['plan', 'addon'])
  attachmentType?: UsageAttachmentType;

  @ValidateIf((dto: CreateUsageRecordDto) => (dto.attachmentType ?? 'plan') === 'addon')
  @IsUUID('4', { message: 'addonId must be a UUID when attachmentType is addon' })
  addonId?: string;
}

export class UpdateUsageMeterEntryDto {
  @IsOptional()
  @IsISO8601({}, { message: 'periodStart must be an ISO date string' })
  periodStart?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'periodEnd must be an ISO date string' })
  periodEnd?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsObject()
  usagePayload?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['plan', 'addon'])
  attachmentType?: UsageAttachmentType;

  @IsOptional()
  @IsUUID('4')
  meterId?: string;

  @IsOptional()
  @IsUUID('4')
  addonId?: string | null;
}
