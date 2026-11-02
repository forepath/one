import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  /**
   * One-time admin claim token. Only needed for the first account when the deployment enables the claim
   * (`ADMIN_CLAIM_TOKEN_SHA256`, e.g. Loadweaver Cloud); ignored otherwise.
   */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  adminClaimToken?: string;
}
