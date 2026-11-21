import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

import { CustomerType } from '../constants/customer-type.constants';
import { EINVOICE_FORMAT_VALUES } from '../constants/e-invoice-format.constants';

export class CustomerProfileDto {
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

  /** E-invoice format override (XRechnung for public buyers, Peppol …); empty = issuer default. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsIn(EINVOICE_FORMAT_VALUES, { message: 'Unknown e-invoice format' })
  einvoiceFormat?: string | null;

  /** BT-10 buyer reference (Leitweg-ID for German public buyers). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buyerReference?: string | null;

  /** Electronic address `scheme:id` (Peppol EAS code), e.g. `0088:4012345000009`. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(/^[0-9A-Z]{2,4}:[^\s]{1,128}$/, { message: 'E-invoice endpoint must be scheme:id' })
  einvoiceEndpoint?: string | null;
}
