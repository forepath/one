import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

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

  @IsOptional()
  @IsEmail({}, { message: 'Email must be valid' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'Phone must be a string' })
  phone?: string;
}
