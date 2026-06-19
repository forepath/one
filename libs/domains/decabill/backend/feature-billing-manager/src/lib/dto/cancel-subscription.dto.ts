import { IsOptional, IsString } from 'class-validator';

export class CancelSubscriptionDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  reason?: string;
}
