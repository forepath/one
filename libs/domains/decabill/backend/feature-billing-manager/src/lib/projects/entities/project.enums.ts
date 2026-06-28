export enum ProjectStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum ProjectTicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ProjectTicketStatus {
  DRAFT = 'draft',
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  PROTOTYPE = 'prototype',
  DONE = 'done',
  CLOSED = 'closed',
}

export enum ProjectTicketActorType {
  HUMAN = 'human',
  AI = 'ai',
  SYSTEM = 'system',
}

/** Stored as varchar(64) in DB; values are stable API contract. */
export enum ProjectTicketActionType {
  CREATED = 'CREATED',
  FIELD_UPDATED = 'FIELD_UPDATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  PRIORITY_CHANGED = 'PRIORITY_CHANGED',
  PARENT_CHANGED = 'PARENT_CHANGED',
  MILESTONE_CHANGED = 'MILESTONE_CHANGED',
  DELETED = 'DELETED',
  COMMENT_ADDED = 'COMMENT_ADDED',
}

export const TERMINAL_PROJECT_TICKET_STATUSES: ProjectTicketStatus[] = [
  ProjectTicketStatus.DONE,
  ProjectTicketStatus.CLOSED,
];
