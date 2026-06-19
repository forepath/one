import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

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
  createdAt!: Date;
  updatedAt!: Date;
}

export class PaginatedAdminCustomerProfilesResponseDto {
  items!: AdminCustomerProfileListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
