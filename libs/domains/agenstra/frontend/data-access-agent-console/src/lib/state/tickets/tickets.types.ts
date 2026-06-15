export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketStatus = 'draft' | 'todo' | 'in_progress' | 'prototype' | 'done' | 'closed';
export type TicketActorType = 'human' | 'ai' | 'system';

/** Request-only on create; not stored on the ticket. */
export type TicketCreationTemplate = 'empty' | 'specification';

/** Markdown checkboxes in ticket `content`: `[ ]` open, `[x]` / `[X]` done. */
export interface TicketTasksDto {
  open: number;
  done: number;
  /** Counts from all descendant tickets only (not this ticket's body). */
  children: {
    open: number;
    done: number;
  };
}

export const EMPTY_TICKET_TASKS: TicketTasksDto = {
  open: 0,
  done: 0,
  children: { open: 0, done: 0 },
};

/** Direct subtasks only; computed on the client from `parentId` / `children`. */
export interface TicketSubtaskCountsDto {
  open: number;
  done: number;
}

export interface TicketResponseDto {
  id: string;
  shas: {
    short: string;
    long: string;
  };
  clientId: string;
  parentId?: string | null;
  title: string;
  content?: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  createdByUserId?: string | null;
  createdByEmail?: string | null;
  /** Preferred workspace agent for chat/AI when viewing this ticket. */
  preferredChatAgentId?: string | null;
  /** True when autonomous prototyping is enabled for this ticket. */
  automationEligible: boolean;
  createdAt: string;
  updatedAt: string;
  tasks: TicketTasksDto;
  children?: TicketResponseDto[];
  /** Present after tickets are processed in the reducer (not from the API). */
  subtaskCounts?: TicketSubtaskCountsDto;
}

export interface CreateTicketDto {
  clientId?: string;
  parentId?: string | null;
  title: string;
  content?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  creationTemplate?: TicketCreationTemplate;
}

/** POST /tickets response; includes subtasks when template was `specification`. */
export type CreateTicketResultDto = TicketResponseDto & {
  createdChildTickets?: TicketResponseDto[];
};

export interface UpdateTicketDto {
  clientId?: string;
  parentId?: string | null;
  title?: string;
  content?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  preferredChatAgentId?: string | null;
}

export interface MigrateTicketDto {
  targetClientId: string;
}

export interface MigrateTicketResultDto {
  ticket: TicketResponseDto;
}

export interface TicketCommentResponseDto {
  id: string;
  ticketId: string;
  authorUserId?: string | null;
  authorEmail?: string | null;
  body: string;
  createdAt: string;
}

export interface TicketActivityResponseDto {
  id: string;
  ticketId: string;
  occurredAt: string;
  actorType: TicketActorType;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actionType: string;
  payload: Record<string, unknown>;
}

export interface PrototypePromptResponseDto {
  prompt: string;
}

export interface StartBodyGenerationSessionResponseDto {
  generationId: string;
  expiresAt: string;
  activity: TicketActivityResponseDto;
}

export interface ListTicketsParams {
  clientId?: string;
  status?: TicketStatus;
  parentId?: string | null;
}
