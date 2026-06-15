import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class UpdateKnowledgeNodeDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID('4')
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string | null;
}
