import type { ChatPlanResponse } from '../container-socket/container-socket.types';

/** Plans page filter (`state` query): editable plans, read-only plans (executed / being drafted), or all. */
export type ChatPlanListState = 'editable' | 'readonly';

export interface ChatPlansQuery {
  search?: string;
  state?: ChatPlanListState | null;
  limit: number;
  offset: number;
}

/** `GET /clients/:id/agents/:agentId/plans` */
export interface ChatPlanListResponseDto {
  items: ChatPlanResponse[];
  /** Every plan matching the filter (all pages). */
  total: number;
}

/**
 * `PATCH /clients/:id/agents/:agentId/plans/:planId` — `expectedUpdatedAt` is the version the user edited; a plan
 * changed in between (agent refine, another user, execution) is refused with 409.
 */
export interface UpdateChatPlanDto {
  planMarkdown?: string;
  summary?: string;
  expectedUpdatedAt: string;
}

export type ChatPlanActorType = 'human' | 'ai' | 'system';

export type ChatPlanActionType =
  | 'CREATED'
  | 'DRAFT_UPDATED'
  | 'REFINE_REQUESTED'
  | 'CONTENT_UPDATED'
  | 'EXECUTION_STARTED'
  | 'EXECUTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETRY_REQUESTED';

/** `GET /clients/:id/agents/:agentId/plans/:planId/activity` row (newest first). */
export interface ChatPlanActivityDto {
  id: string;
  planId: string;
  occurredAt: string;
  actorType: ChatPlanActorType;
  actorUserId: string | null;
  actorEmail: string | null;
  actionType: ChatPlanActionType | string;
  payload: Record<string, unknown>;
}
