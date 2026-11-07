/** Who caused an `initiative_activity` row. */
export enum InitiativeActorType {
  HUMAN = 'human',
  AI = 'ai',
  SYSTEM = 'system',
}

/** `initiative_activity.action_type` values (stored as varchar(64); stable API contract). */
export enum InitiativeActionType {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  ITERATION_STARTED = 'ITERATION_STARTED',
  ARTIFACT_CREATED = 'ARTIFACT_CREATED',
  ARTIFACT_UPDATED = 'ARTIFACT_UPDATED',
  ARTIFACT_ACCEPTED = 'ARTIFACT_ACCEPTED',
  ARTIFACT_DELETED = 'ARTIFACT_DELETED',
  ARTIFACT_PUBLISHED = 'ARTIFACT_PUBLISHED',
  WORK_ITEM_CREATED = 'WORK_ITEM_CREATED',
  WORK_ITEM_UPDATED = 'WORK_ITEM_UPDATED',
  WORK_ITEM_DELETED = 'WORK_ITEM_DELETED',
  WORK_ITEMS_REORDERED = 'WORK_ITEMS_REORDERED',
  DEPENDENCIES_CHANGED = 'DEPENDENCIES_CHANGED',
  UNKNOWN_RESOLVED = 'UNKNOWN_RESOLVED',
  TRANSFERRED = 'TRANSFERRED',
  RELEASED = 'RELEASED',
  STORY_PLANNED = 'STORY_PLANNED',
  RUN_STARTED = 'RUN_STARTED',
  RUN_ACCEPTED = 'RUN_ACCEPTED',
  RUN_DISCARDED = 'RUN_DISCARDED',
  RUN_FAILED = 'RUN_FAILED',
  RUN_CANCELLED = 'RUN_CANCELLED',
  PROPOSAL_CREATED = 'PROPOSAL_CREATED',
  PROPOSAL_ACCEPTED = 'PROPOSAL_ACCEPTED',
  PROPOSAL_REJECTED = 'PROPOSAL_REJECTED',
  FINDING_CREATED = 'FINDING_CREATED',
  FINDING_UPDATED = 'FINDING_UPDATED',
  DECISION_CREATED = 'DECISION_CREATED',
  DECISION_DECIDED = 'DECISION_DECIDED',
  RETROSPECTIVE_VERDICT = 'RETROSPECTIVE_VERDICT',
}

/** Run failure labels stored on `initiative_runs.failure_code`. */
export enum InitiativeRunFailureCode {
  AGENT_PROVIDER_ERROR = 'agent_provider_error',
  AGENT_NO_STATUS = 'agent_no_status',
  ORCHESTRATOR_ERROR = 'orchestrator_error',
}

/** Decision status (`initiative_decisions.status`): agents only propose; humans accept. */
export enum InitiativeDecisionStatus {
  PROPOSED = 'proposed',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}
