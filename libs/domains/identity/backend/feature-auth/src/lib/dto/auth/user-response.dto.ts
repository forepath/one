import { UserRole } from '@forepath/identity/backend';

export class UserResponseDto {
  id!: string;
  email!: string;
  role!: UserRole;
  emailConfirmedAt?: string;
  lockedAt?: string | null;
  totpEnabled?: boolean;
  email2faEnabled?: boolean;
  createdAt!: string;
  updatedAt!: string;
}
