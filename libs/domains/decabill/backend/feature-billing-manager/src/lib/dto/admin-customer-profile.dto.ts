import { IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

import type { CustomerTrustLevel } from '../trust-score/trust-score.types';

import { CustomerProfileDto } from './customer-profile.dto';

export class AdminOfferProfileCountsDto {
  draft!: number;
  archived!: number;
  accepted!: number;
  declined!: number;
  expired!: number;
  revoked!: number;
}

export class CreateAdminCustomerProfileDto extends CustomerProfileDto {
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId!: string;
}

export class AddCustomerProfileCustomDataDto {
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Key must contain only letters, numbers, dots, underscores, or hyphens',
  })
  key!: string;

  @IsString()
  @MaxLength(4096)
  value!: string;
}

export class UpdateCustomerProfileCustomDataDto {
  @IsString()
  @MaxLength(4096)
  value!: string;
}

export class AdminCustomerProfileListItemDto {
  id!: string;
  userId!: string;
  customerNumber!: string;
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
  customerNumber!: string;
  numberScope!: string;
  datevDebtorNumber?: number | null;
  userEmail?: string;
  isComplete!: boolean;
  stripeCustomerId?: string;
  autoBillingEnabled?: boolean;
  hasPaymentMethodOnFile?: boolean;
  supportsAutoPayment?: boolean;
  trustScore?: number | null;
  trustLevel?: CustomerTrustLevel | null;
  trustScoreUpdatedAt?: Date | null;
  offerCounts?: AdminOfferProfileCountsDto;
  customData!: Record<string, string>;
  createdAt!: Date;
  updatedAt!: Date;
}

export class PaginatedAdminCustomerProfilesResponseDto {
  items!: AdminCustomerProfileListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
