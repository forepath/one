import { IsNotEmpty, IsString, Matches } from 'class-validator';

/** Disable authenticator: possession of current TOTP is the step-up factor. */
export class DisableTotpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{6}$/, { message: 'code must be a 6-digit TOTP value' })
  code!: string;
}
