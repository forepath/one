import { IsOptional, IsString } from 'class-validator';

export class BackorderCancelDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  reason?: string;
}
