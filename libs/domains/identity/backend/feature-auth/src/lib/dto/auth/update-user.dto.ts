import { UserRole } from '@forepath/identity/backend';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @IsOptional()
  password?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  /** Only applies when the email changes: keep the new address confirmed instead of requiring re-confirmation. */
  @IsBoolean()
  @IsOptional()
  emailConfirmed?: boolean;

  /** Only applies when the email changes to an unconfirmed address: whether to email a code (default true). */
  @IsBoolean()
  @IsOptional()
  sendConfirmationEmail?: boolean;
}
