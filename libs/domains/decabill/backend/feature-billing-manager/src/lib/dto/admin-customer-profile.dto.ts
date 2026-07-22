import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

import type { CustomerTrustLevel } from '../trust-score/trust-score.types';

import { CustomerProfileDto } from './customer-profile.dto';

export class CreateAdminCustomerProfileDto extends CustomerProfileDto {
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId!: string;
}

export class AdminCustomerProfileListItemDto {
  id!: string;
  userId!: string;
  userEmail?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  country?: string;
  isComplete!: boolean;
  stripeCustomerId?: string;
  trustScore?: number | null;
  trustLevel?: CustomerTrustLevel | null;
  trustScoreUpdatedAt?: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AdminCustomerProfileDetailDto extends CustomerProfileDto {
  id!: string;
  userId!: string;
  userEmail?: string;
  isComplete!: boolean;
  stripeCustomerId?: string;
  autoBillingEnabled?: boolean;
  hasPaymentMethodOnFile?: boolean;
  supportsAutoPayment?: boolean;
  trustScore?: number | null;
  trustLevel?: CustomerTrustLevel | null;
  trustScoreUpdatedAt?: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class PaginatedAdminCustomerProfilesResponseDto {
  items!: AdminCustomerProfileListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
