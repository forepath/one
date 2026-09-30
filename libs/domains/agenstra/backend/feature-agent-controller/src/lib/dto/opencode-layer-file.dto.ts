import { IsIn, IsOptional, IsString } from 'class-validator';

export type OpencodeLayerFileEntryKind = 'file' | 'directory';

export class OpencodeLayerFileResponseDto {
  id!: string;
  scope!: 'global' | 'workspace';
  clientId?: string | null;
  path!: string;
  /** Same as path (paths are emitted as entered). */
  emittedPath!: string;
  entryKind!: OpencodeLayerFileEntryKind;
  content!: string;
  contentSha!: string;
  updatedAt!: Date;
}

export class OpencodeLayerFileListEntryDto {
  name!: string;
  path!: string;
  entryKind!: OpencodeLayerFileEntryKind;
}

export class OpencodeLayerFileListResponseDto {
  path!: string;
  entries!: OpencodeLayerFileListEntryDto[];
}

export class UpsertOpencodeLayerFileDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsIn(['file', 'directory'])
  entryKind?: OpencodeLayerFileEntryKind;
}

export class CreateOpencodeLayerFileDto {
  @IsString()
  path!: string;

  @IsOptional()
  @IsIn(['file', 'directory'])
  entryKind?: OpencodeLayerFileEntryKind;

  @IsOptional()
  @IsString()
  content?: string;
}
