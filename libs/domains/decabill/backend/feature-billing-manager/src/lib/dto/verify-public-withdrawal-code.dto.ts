import { IsNotEmpty, IsString, IsUUID, Matches } from 'class-validator';

export class VerifyPublicWithdrawalCodeDto {
  @IsUUID('4')
  requestId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9]{6}$/i)
  code!: string;
}
