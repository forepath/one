import { IsISO8601, IsObject, IsUUID } from 'class-validator';

export class CreateUsageRecordDto {
  @IsUUID('4', { message: 'Subscription ID must be a UUID' })
  subscriptionId!: string;

  @IsISO8601({}, { message: 'periodStart must be an ISO date string' })
  periodStart!: string;

  @IsISO8601({}, { message: 'periodEnd must be an ISO date string' })
  periodEnd!: string;

  @IsObject({ message: 'usagePayload must be an object' })
  usagePayload!: Record<string, unknown>;
}
