export class UsageSummaryDto {
  subscriptionId!: string;
  periodStart!: Date;
  periodEnd!: Date;
  usagePayload!: Record<string, unknown>;
}
