import { Equals, IsBoolean, IsUUID } from 'class-validator';

export class ConfirmPublicWithdrawalDto {
  @IsUUID('4')
  requestId!: string;

  @IsBoolean()
  @Equals(true)
  acknowledgeWithdrawal!: boolean;
}
