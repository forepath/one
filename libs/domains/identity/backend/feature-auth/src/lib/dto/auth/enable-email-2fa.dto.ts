import { IsOptional, IsString, Matches } from 'class-validator';

/** Optional emailed code when enabling email 2FA (confirm-once). */
export class EnableEmail2faDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{6}$/, { message: 'code must be a 6-character alphanumeric value' })
  code?: string;
}
