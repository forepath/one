import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

import { CustomerType } from '../constants/customer-type.constants';

export class SupplierProfileFieldsDto {
  @IsOptional()
  @IsString({ message: 'First name must be a string' })
  firstName?: string;

  @IsOptional()
  @IsString({ message: 'Last name must be a string' })
  lastName?: string;

  @IsOptional()
  @IsString({ message: 'Company must be a string' })
  company?: string;

  @IsOptional()
  @IsEnum(CustomerType, { message: 'Customer type must be business or consumer' })
  customerType?: CustomerType;

  @IsOptional()
  @IsString({ message: 'VAT ID must be a string' })
  @MaxLength(32, { message: 'VAT ID must be at most 32 characters' })
  vatId?: string | null;

  @IsOptional()
  @IsString({ message: 'Address line 1 must be a string' })
  addressLine1?: string;

  @IsOptional()
  @IsString({ message: 'Address line 2 must be a string' })
  addressLine2?: string;

  @IsOptional()
  @IsString({ message: 'Postal code must be a string' })
  postalCode?: string;

  @IsOptional()
  @IsString({ message: 'City must be a string' })
  city?: string;

  @IsOptional()
  @IsString({ message: 'State must be a string' })
  state?: string;

  @IsOptional()
  @IsString({ message: 'Country must be a string' })
  @Length(2, 2, { message: 'Country must be ISO 3166-1 alpha-2' })
  country?: string;

  /** Optional; the console sends '' for "no email" (also used to clear it), so only non-empty values are checked. */
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsEmail({}, { message: 'Email must be valid' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'Phone must be a string' })
  phone?: string;

  /** Default expense account number for this supplier's invoices (accounting). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(/^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/, { message: 'Invalid account number' })
  defaultExpenseAccountNumber?: string | null;
}

export class CreateAdminSupplierProfileDto extends SupplierProfileFieldsDto {}

export class AddSupplierProfileCustomDataDto {
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

export class UpdateSupplierProfileCustomDataDto {
  @IsString()
  @MaxLength(4096)
  value!: string;
}

export class AdminSupplierProfileListItemDto {
  id!: string;
  supplierNumber!: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  country?: string;
  isComplete!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AdminSupplierProfileDetailDto extends SupplierProfileFieldsDto {
  id!: string;
  supplierNumber!: string;
  numberScope!: string;
  datevCreditorNumber?: number | null;
  isComplete!: boolean;
  vatIdValidationStatus?: string;
  vatIdValidatedAt?: Date | null;
  vatIdValidationSource?: string | null;
  customData!: Record<string, string>;
  createdAt!: Date;
  updatedAt!: Date;
}

export class PaginatedAdminSupplierProfilesResponseDto {
  items!: AdminSupplierProfileListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class SupplierContractResponseDto {
  id!: string;
  supplierId!: string;
  contractNumber!: string;
  createdAt!: Date;
}
