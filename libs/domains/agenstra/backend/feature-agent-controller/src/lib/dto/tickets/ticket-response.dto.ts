import { TicketPriority, TicketStatus } from '../../entities/ticket.enums';

import { TicketActivityResponseDto } from './ticket-activity-response.dto';

/** Checkbox counts aggregated from all descendant tickets' descriptions (not this ticket). */
export class TicketTasksChildrenDto {
  open!: number;
  done!: number;
}

/** Markdown task checkboxes in `content`: `[ ]` open, `[x]` / `[X]` done; `children` sums descendants only. */
export class TicketTasksDto {
  open!: number;
  done!: number;
  children!: TicketTasksChildrenDto;
}

export class TicketShasDto {
  /** Stable short ticket reference (derived from internal ticket id). */
  short!: string;
  /** Stable full ticket reference hash (derived from internal ticket id). */
  long!: string;
}

export class TicketResponseDto {
  id!: string;
  shas!: TicketShasDto;
  clientId!: string;
  parentId?: string | null;
  title!: string;
  content?: string | null;
  priority!: TicketPriority;
  status!: TicketStatus;
  createdByUserId?: string | null;
  createdByEmail?: string | null;
  /** Preferred workspace agent for chat/AI when viewing this ticket. */
  preferredChatAgentId?: string | null;
  /** True when autonomous prototyping is enabled for this ticket (`ticket_automation.eligible`). */
  automationEligible!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
  tasks!: TicketTasksDto;
  children?: TicketResponseDto[];
}

/** Response for `POST /tickets`; includes optional subtasks when `creationTemplate` was `specification`. */
export class CreateTicketResponseDto extends TicketResponseDto {
  createdChildTickets?: TicketResponseDto[];
}

export class PrototypePromptResponseDto {
  prompt!: string;
}

export class StartBodyGenerationSessionResponseDto {
  generationId!: string;
  expiresAt!: string;
  /** Activity row created for this session (same as in GET …/activity, newest-first order). */
  activity!: TicketActivityResponseDto;
}
