import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateAtlassianSiteConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  @MaxLength(512)
  baseUrl!: string;

  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  accountEmail!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(4096)
  apiToken!: string;
}
