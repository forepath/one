/** Lifecycle status for a chat-scoped plan aggregate. */
export enum ChatPlanStatus {
  PENDING = 'pending',
  EXPLORING = 'exploring',
  READY = 'ready',
  REFINING = 'refining',
  EXECUTING = 'executing',
  EXECUTED = 'executed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/** Coarse phase for UI badges / hydrate cards. */
export enum ChatPlanPhase {
  EXPLORE = 'explore',
  DRAFT = 'draft',
  REFINE = 'refine',
  READY = 'ready',
}

/** Machine-oriented failure labels stored on `chat_plan.failure_code`. */
export enum ChatPlanFailureCode {
  AGENT_PROVIDER_ERROR = 'agent_provider_error',
  AGENT_NO_PLAN_STATUS = 'agent_no_plan_status',
  ACTIVE_PLAN_EXISTS = 'active_plan_exists',
  INVALID_STATUS = 'invalid_status',
  CANCELLED = 'cancelled',
  ORCHESTRATOR_ERROR = 'orchestrator_error',
}

/** Statuses that block creating another plan for the same agent+chat. */
export const CHAT_PLAN_ACTIVE_STATUSES: readonly ChatPlanStatus[] = [
  ChatPlanStatus.PENDING,
  ChatPlanStatus.EXPLORING,
  ChatPlanStatus.REFINING,
  ChatPlanStatus.EXECUTING,
];

/**
 * Statuses in which a plan's content may be edited by a workspace user — and only while it never entered execution
 * (`chat_plan.execution_started_at IS NULL`). Streaming statuses are excluded because the agent writes the draft then.
 */
export const CHAT_PLAN_EDITABLE_STATUSES: readonly ChatPlanStatus[] = [
  ChatPlanStatus.READY,
  ChatPlanStatus.FAILED,
  ChatPlanStatus.CANCELLED,
];

/** Who caused a `chat_plan_activity` row. */
export enum ChatPlanActorType {
  HUMAN = 'human',
  AI = 'ai',
  SYSTEM = 'system',
}

/** `chat_plan_activity.action_type` values. */
export enum ChatPlanActionType {
  CREATED = 'CREATED',
  /** The agent finished a planning turn with plan content (payload: `phase`, `ready`). */
  DRAFT_UPDATED = 'DRAFT_UPDATED',
  REFINE_REQUESTED = 'REFINE_REQUESTED',
  /** A workspace user edited the plan (payload: `fields`). */
  CONTENT_UPDATED = 'CONTENT_UPDATED',
  EXECUTION_STARTED = 'EXECUTION_STARTED',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RETRY_REQUESTED = 'RETRY_REQUESTED',
}

/** Bounds for user edits of a plan (REST). */
export const CHAT_PLAN_LIMITS = {
  planMarkdownMaxLength: 200_000,
  summaryMaxLength: 512,
  searchMaxLength: 200,
  listDefaultLimit: 25,
  listMaxLimit: 100,
  activityDefaultLimit: 50,
  activityMaxLimit: 200,
} as const;
