import { UserRole } from '@forepath/identity/backend';
import { IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  /**
   * Admin only: create the account with its email already confirmed. No confirmation email is sent.
   * Defaults to false (the user must confirm their email via the emailed code).
   */
  @IsBoolean()
  @IsOptional()
  emailConfirmed?: boolean;

  /**
   * Admin only: whether to email a confirmation code to an unconfirmed account. Defaults to true.
   * With false the account stays unconfirmed until an admin confirms it (POST /users/:id/confirm-email).
   */
  @IsBoolean()
  @IsOptional()
  sendConfirmationEmail?: boolean;
}
