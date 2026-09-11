import { IsNotEmpty, IsString } from 'class-validator';

/** Step-up password for sensitive 2FA mutations. */
export class CurrentPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
