export enum ProjectStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

/**
 * How a project's tracked time turns into billable amounts.
 * - `hourly`: tracked hours × hourly rate, unlimited.
 * - `capped`: tracked hours × hourly rate, but the cumulative billed amount never exceeds `priceLimitNet`.
 * - `fixed`: the agreed fixed price `priceLimitNet` is billed (at once or in instalments), regardless of tracked hours.
 */
export enum ProjectPricingModel {
  HOURLY = 'hourly',
  CAPPED = 'capped',
  FIXED = 'fixed',
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
  ATTACHMENT_ADDED = 'ATTACHMENT_ADDED',
  ATTACHMENT_REMOVED = 'ATTACHMENT_REMOVED',
  LOCKED = 'LOCKED',
}

export const TERMINAL_PROJECT_TICKET_STATUSES: ProjectTicketStatus[] = [
  ProjectTicketStatus.DONE,
  ProjectTicketStatus.CLOSED,
];
