import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class RequestPublicWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^SUB-\d{6}$/i)
  subscriptionNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  customerName!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;

  @IsDateString({ strict: true })
  orderedOn!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  receivedOn?: string;
}
