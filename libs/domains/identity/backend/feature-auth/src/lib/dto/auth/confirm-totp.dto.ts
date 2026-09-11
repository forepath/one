import { IsNotEmpty, IsString, Matches } from 'class-validator';

/** Confirm authenticator enrollment with a TOTP code (password was verified at setup). */
export class ConfirmTotpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{6}$/, { message: 'code must be a 6-digit TOTP value' })
  code!: string;
}
