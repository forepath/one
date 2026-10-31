import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CancelSubscriptionDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  reason?: string;

  /**
   * Confirms that ending the subscription deletes provisioned data. Required when the subscription runs a Loadweaver
   * cluster (error LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED otherwise).
   */
  @IsOptional()
  @IsBoolean({ message: 'confirmDataTeardown must be a boolean' })
  confirmDataTeardown?: boolean;
}
