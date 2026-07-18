import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePersonalAccessTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  scopes!: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdatePersonalAccessTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  scopes!: string[];
}

export class ExchangePersonalAccessTokenDto {
  @IsString()
  @MinLength(1)
  token!: string;
}

export class PersonalAccessTokenResponseDto {
  id!: string;
  name!: string;
  tokenPrefix!: string;
  scopes!: string[];
  expiresAt!: string | null;
  revokedAt!: string | null;
  lastUsedAt!: string | null;
  createdAt!: string;
  /** Present only on create. */
  token?: string;
}

export class PersonalAccessTokenScopeDto {
  scope!: string;
}
