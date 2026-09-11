import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  /** Second-factor code (email OTP or TOTP) when LOGIN_2FA_REQUIRED was returned. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{6}$/, { message: 'code must be a 6-character alphanumeric value' })
  code?: string;
}
