export type KnowledgeNodeType = 'folder' | 'page';
export type KnowledgeRelationSourceType = 'ticket' | 'page';
export type KnowledgeRelationTargetType = 'ticket' | 'folder' | 'page';
export type KnowledgeActorType = 'human' | 'ai' | 'system';
export type KnowledgeActionType =
  | 'CREATED'
  | 'FIELD_UPDATED'
  | 'CONTENT_UPDATED'
  | 'PARENT_CHANGED'
  | 'SORT_ORDER_CHANGED'
  | 'DELETED'
  | 'DUPLICATED'
  | 'RELATION_ADDED'
  | 'RELATION_REMOVED';

export interface KnowledgeNodeShasDto {
  short: string;
  long: string;
}

export interface KnowledgeNodeDto {
  id: string;
  shas: KnowledgeNodeShasDto;
  clientId: string;
  nodeType: KnowledgeNodeType;
  parentId?: string | null;
  title: string;
  content?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children?: KnowledgeNodeDto[];
}

export interface CreateKnowledgeNodeDto {
  clientId?: string;
  parentId?: string | null;
  nodeType: KnowledgeNodeType;
  title: string;
  content?: string;
}

export interface UpdateKnowledgeNodeDto {
  parentId?: string | null;
  title?: string;
  content?: string | null;
}

export interface KnowledgeRelationDto {
  id: string;
  clientId: string;
  sourceType: KnowledgeRelationSourceType;
  sourceId: string;
  targetType: KnowledgeRelationTargetType;
  targetNodeId?: string | null;
  targetTicketLongSha?: string | null;
  createdAt: string;
}

export interface CreateKnowledgeRelationDto {
  clientId: string;
  sourceType: KnowledgeRelationSourceType;
  sourceId: string;
  targetType: KnowledgeRelationTargetType;
  targetNodeId?: string;
  targetTicketSha?: string;
}

export interface KnowledgePageActivityDto {
  id: string;
  pageId: string;
  occurredAt: string;
  actorType: KnowledgeActorType;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actionType: KnowledgeActionType;
  payload: Record<string, unknown>;
}
