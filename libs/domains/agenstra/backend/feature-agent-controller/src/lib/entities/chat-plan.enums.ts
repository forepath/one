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
