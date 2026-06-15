/**
 * Human-readable labels for ticket automation run API values (status, phase, step kinds, failure codes).
 * Mirrors backend enums in `ticket-automation.enums.ts` and OpenAPI; unknown values pass through.
 */

export function ticketAutomationRunStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return $localize`:@@featureTicketsBoard-runStatusPending:Pending`;
    case 'running':
      return $localize`:@@featureTicketsBoard-runStatusRunning:Running`;
    case 'succeeded':
      return $localize`:@@featureTicketsBoard-runStatusSucceeded:Succeeded`;
    case 'failed':
      return $localize`:@@featureTicketsBoard-runStatusFailed:Failed`;
    case 'timed_out':
      return $localize`:@@featureTicketsBoard-runStatusTimedOut:Timed out`;
    case 'escalated':
      return $localize`:@@featureTicketsBoard-runStatusEscalated:Escalated`;
    case 'cancelled':
      return $localize`:@@featureTicketsBoard-runStatusCancelled:Cancelled`;
    default:
      return status;
  }
}

export function ticketAutomationRunPhaseLabel(phase: string): string {
  switch (phase) {
    case 'pre_improve':
      return $localize`:@@featureTicketsBoard-runPhasePreImprove:Pre-improve`;
    case 'workspace_prep':
      return $localize`:@@featureTicketsBoard-runPhaseWorkspacePrep:Workspace prep`;
    case 'agent_loop':
      return $localize`:@@featureTicketsBoard-runPhaseAgentLoop:Agent loop`;
    case 'verify':
      return $localize`:@@featureTicketsBoard-runPhaseVerify:Verify`;
    case 'finalize':
      return $localize`:@@featureTicketsBoard-runPhaseFinalize:Finalize`;
    default:
      return phase;
  }
}

export function ticketAutomationRunStepKindLabel(kind: string): string {
  switch (kind) {
    case 'vcs_prepare':
      return $localize`:@@featureTicketsBoard-runStepKindVcsPrepare:Repository setup`;
    case 'agent_turn':
      return $localize`:@@featureTicketsBoard-runStepKindAgentTurn:Agent turn`;
    case 'git_commit':
      return $localize`:@@featureTicketsBoard-runStepKindGitCommit:Git commit`;
    case 'git_push':
      return $localize`:@@featureTicketsBoard-runStepKindGitPush:Git push`;
    case 'vcs_branch':
      return $localize`:@@featureTicketsBoard-runStepKindVcsBranch:Branch setup`;
    default:
      return kind;
  }
}

export function ticketAutomationFailureCodeLabel(code: string): string {
  switch (code) {
    case 'approval_missing':
      return $localize`:@@featureTicketsBoard-runFailureApprovalMissing:Approval missing`;
    case 'lease_contention':
      return $localize`:@@featureTicketsBoard-runFailureLeaseContention:Lease contention`;
    case 'vcs_dirty_workspace':
      return $localize`:@@featureTicketsBoard-runFailureVcsDirtyWorkspace:Dirty workspace`;
    case 'vcs_branch_exists':
      return $localize`:@@featureTicketsBoard-runFailureVcsBranchExists:Branch already exists`;
    case 'agent_provider_error':
      return $localize`:@@featureTicketsBoard-runFailureAgentProviderError:Agent provider error`;
    case 'agent_no_completion_marker':
      return $localize`:@@featureTicketsBoard-runFailureAgentNoCompletionMarker:No completion marker`;
    case 'marker_without_verify':
      return $localize`:@@featureTicketsBoard-runFailureMarkerWithoutVerify:Completion marker without verify profile`;
    case 'verify_command_failed':
      return $localize`:@@featureTicketsBoard-runFailureVerifyCommandFailed:Verify command failed`;
    case 'commit_failed':
      return $localize`:@@featureTicketsBoard-runFailureCommitFailed:Git commit failed`;
    case 'push_failed':
      return $localize`:@@featureTicketsBoard-runFailurePushFailed:Git push failed`;
    case 'budget_exceeded':
      return $localize`:@@featureTicketsBoard-runFailureBudgetExceeded:Budget exceeded`;
    case 'human_escalation':
      return $localize`:@@featureTicketsBoard-runFailureHumanEscalation:Human escalation`;
    case 'orchestrator_stale':
      return $localize`:@@featureTicketsBoard-runFailureOrchestratorStale:Orchestrator stale`;
    default:
      return code;
  }
}

export function ticketAutomationCancellationReasonLabel(reason: string): string {
  switch (reason) {
    case 'user_request':
      return $localize`:@@featureTicketsBoard-runCancelUserRequest:User request`;
    case 'approval_invalidated':
      return $localize`:@@featureTicketsBoard-runCancelApprovalInvalidated:Approval invalidated`;
    case 'lease_expired':
      return $localize`:@@featureTicketsBoard-runCancelLeaseExpired:Lease expired`;
    case 'system_shutdown':
      return $localize`:@@featureTicketsBoard-runCancelSystemShutdown:System shutdown`;
    default:
      return reason;
  }
}
