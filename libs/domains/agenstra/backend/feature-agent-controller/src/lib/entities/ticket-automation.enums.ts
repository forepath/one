/** Terminal and non-terminal states for a ticket automation run. */
export enum TicketAutomationRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  TIMED_OUT = 'timed_out',
  ESCALATED = 'escalated',
  CANCELLED = 'cancelled',
}

export enum TicketAutomationRunPhase {
  PRE_IMPROVE = 'pre_improve',
  WORKSPACE_PREP = 'workspace_prep',
  AGENT_LOOP = 'agent_loop',
  VERIFY = 'verify',
  FINALIZE = 'finalize',
}

export enum TicketAutomationLeaseStatus {
  ACTIVE = 'active',
  RELEASED = 'released',
  EXPIRED = 'expired',
}

/** Machine-oriented failure labels stored on `ticket_automation_run.failure_code`. */
export enum TicketAutomationFailureCode {
  APPROVAL_MISSING = 'approval_missing',
  LEASE_CONTENTION = 'lease_contention',
  VCS_DIRTY_WORKSPACE = 'vcs_dirty_workspace',
  VCS_BRANCH_EXISTS = 'vcs_branch_exists',
  AGENT_PROVIDER_ERROR = 'agent_provider_error',
  AGENT_NO_COMPLETION_MARKER = 'agent_no_completion_marker',
  MARKER_WITHOUT_VERIFY = 'marker_without_verify',
  VERIFY_COMMAND_FAILED = 'verify_command_failed',
  /** Git commit after successful verification failed (e.g. empty index, hook, or I/O). */
  COMMIT_FAILED = 'commit_failed',
  /** `git push` after a successful automation commit failed (auth, remote, or hook). */
  PUSH_FAILED = 'push_failed',
  BUDGET_EXCEEDED = 'budget_exceeded',
  HUMAN_ESCALATION = 'human_escalation',
  ORCHESTRATOR_STALE = 'orchestrator_stale',
}

export enum TicketAutomationCancellationReason {
  USER_REQUEST = 'user_request',
  APPROVAL_INVALIDATED = 'approval_invalidated',
  LEASE_EXPIRED = 'lease_expired',
  SYSTEM_SHUTDOWN = 'system_shutdown',
}
