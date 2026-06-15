import {
  KnowledgeNodeType,
  KnowledgeRelationSourceType,
  KnowledgeRelationTargetType,
} from '../../entities/knowledge-node.enums';

export class KnowledgeNodeShasDto {
  short!: string;
  long!: string;
}

export class KnowledgeNodeResponseDto {
  id!: string;
  shas!: KnowledgeNodeShasDto;
  clientId!: string;
  nodeType!: KnowledgeNodeType;
  parentId?: string | null;
  title!: string;
  content?: string | null;
  sortOrder!: number;
  createdAt!: Date;
  updatedAt!: Date;
  children?: KnowledgeNodeResponseDto[];
}

export class KnowledgeRelationResponseDto {
  id!: string;
  clientId!: string;
  sourceType!: KnowledgeRelationSourceType;
  sourceId!: string;
  targetType!: KnowledgeRelationTargetType;
  targetNodeId?: string | null;
  targetTicketLongSha?: string | null;
  createdAt!: Date;
}

export class KnowledgePromptContextResponseDto {
  promptSections!: string[];
}
