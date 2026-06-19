import { IsOptional, IsString } from 'class-validator';

export class ResumeSubscriptionDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  reason?: string;
}
