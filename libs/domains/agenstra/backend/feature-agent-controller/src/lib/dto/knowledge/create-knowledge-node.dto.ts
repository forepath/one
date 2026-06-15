import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { KnowledgeNodeType } from '../../entities/knowledge-node.enums';

export class CreateKnowledgeNodeDto {
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @IsEnum(KnowledgeNodeType)
  nodeType!: KnowledgeNodeType;

  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  content?: string;
}
