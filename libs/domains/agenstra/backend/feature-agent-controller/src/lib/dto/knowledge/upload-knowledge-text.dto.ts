import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { KnowledgeNodeResponseDto } from './knowledge-response.dto';

export enum KnowledgeUploadOnConflict {
  REJECT = 'reject',
  REPLACE = 'replace',
  NUMBER = 'number',
}

export class UploadKnowledgeTextFileDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  filename!: string;

  @IsString()
  @MaxLength(10_485_760)
  content!: string;
}

export class UploadKnowledgeTextDto {
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @IsOptional()
  @IsEnum(KnowledgeUploadOnConflict)
  onConflict?: KnowledgeUploadOnConflict;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UploadKnowledgeTextFileDto)
  files!: UploadKnowledgeTextFileDto[];
}

export class UploadKnowledgeTextRejectedDto {
  filename!: string;
  reason!: string;
}

export class UploadKnowledgeTextResultDto {
  created!: KnowledgeNodeResponseDto[];
  updated!: KnowledgeNodeResponseDto[];
  rejected!: UploadKnowledgeTextRejectedDto[];
}
