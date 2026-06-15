export enum KnowledgeNodeType {
  FOLDER = 'folder',
  PAGE = 'page',
}

export enum KnowledgeRelationSourceType {
  TICKET = 'ticket',
  PAGE = 'page',
}

export enum KnowledgeRelationTargetType {
  TICKET = 'ticket',
  FOLDER = 'folder',
  PAGE = 'page',
}

export enum KnowledgeActorType {
  HUMAN = 'human',
  AI = 'ai',
  SYSTEM = 'system',
}

/** Stored as varchar(64) in DB; values are stable API contract. */
export enum KnowledgeActionType {
  CREATED = 'CREATED',
  FIELD_UPDATED = 'FIELD_UPDATED',
  CONTENT_UPDATED = 'CONTENT_UPDATED',
  PARENT_CHANGED = 'PARENT_CHANGED',
  SORT_ORDER_CHANGED = 'SORT_ORDER_CHANGED',
  DELETED = 'DELETED',
  DUPLICATED = 'DUPLICATED',
  RELATION_ADDED = 'RELATION_ADDED',
  RELATION_REMOVED = 'RELATION_REMOVED',
}
