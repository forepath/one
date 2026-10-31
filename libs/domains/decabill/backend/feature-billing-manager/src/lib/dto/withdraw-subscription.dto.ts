import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class WithdrawSubscriptionDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  @MaxLength(500)
  reason?: string;

  /**
   * Confirms that ending the subscription deletes provisioned data. Required when the subscription runs a Loadweaver
   * cluster (error LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED otherwise).
   */
  @IsOptional()
  @IsBoolean({ message: 'confirmDataTeardown must be a boolean' })
  confirmDataTeardown?: boolean;
}
