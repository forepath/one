import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

import { KnowledgeRelationSourceType, KnowledgeRelationTargetType } from '../../entities/knowledge-node.enums';

export class CreateKnowledgeRelationDto {
  @IsUUID('4')
  clientId!: string;

  @IsEnum(KnowledgeRelationSourceType)
  sourceType!: KnowledgeRelationSourceType;

  @IsUUID('4')
  sourceId!: string;

  @IsEnum(KnowledgeRelationTargetType)
  targetType!: KnowledgeRelationTargetType;

  @IsOptional()
  @ValidateIf(
    (o) => o.targetType === KnowledgeRelationTargetType.FOLDER || o.targetType === KnowledgeRelationTargetType.PAGE,
  )
  @IsUUID('4')
  targetNodeId?: string;

  @IsOptional()
  @ValidateIf((o) => o.targetType === KnowledgeRelationTargetType.TICKET)
  @IsString()
  @MaxLength(40)
  targetTicketSha?: string;
}
