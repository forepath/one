import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { ExportFormat } from '@forepath/marpdown/marpdown/shared';

export class ExportPresentationDto {
  @IsEnum(ExportFormat)
  format!: ExportFormat;
}

export class WriteAssetDto {
  @IsNotEmpty()
  @IsString()
  content!: string;

  @IsOptional()
  @IsEnum(['utf-8', 'base64'])
  encoding?: 'utf-8' | 'base64';
}

export class CreateAssetDto {
  @IsEnum(['file', 'directory'])
  type!: 'file' | 'directory';

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsEnum(['utf-8', 'base64'])
  encoding?: 'utf-8' | 'base64';

  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class MoveAssetDto {
  @IsString()
  @IsNotEmpty()
  destinationPath!: string;
}

export class FileNodeDto {
  name!: string;
  path!: string;
  type!: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
}

export class AssetContentDto {
  content!: string;
  encoding!: 'base64';
  mimeType!: string;
  size!: number;
}
