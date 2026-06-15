import { IsEmail, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateAtlassianSiteConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string | null;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(512)
  baseUrl?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  accountEmail?: string;

  /** When omitted, existing token is kept. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  apiToken?: string;
}
