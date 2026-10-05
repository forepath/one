/**
 * Human-readable labels for chat plan status / phase (mirrors backend chat-plan.enums).
 */

export function chatPlanStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return $localize`:@@featureChat-planStatusPending:Pending`;
    case 'exploring':
      return $localize`:@@featureChat-planStatusExploring:Exploring`;
    case 'ready':
      return $localize`:@@featureChat-planStatusReady:Ready`;
    case 'refining':
      return $localize`:@@featureChat-planStatusRefining:Refining`;
    case 'executing':
      return $localize`:@@featureChat-planStatusExecuting:Executing`;
    case 'executed':
      return $localize`:@@featureChat-planStatusExecuted:Executed`;
    case 'failed':
      return $localize`:@@featureChat-planStatusFailed:Failed`;
    case 'cancelled':
      return $localize`:@@featureChat-planStatusCancelled:Cancelled`;
    default:
      return status;
  }
}

export function chatPlanPhaseLabel(phase: string): string {
  switch (phase) {
    case 'explore':
      return $localize`:@@featureChat-planPhaseExplore:Explore`;
    case 'draft':
      return $localize`:@@featureChat-planPhaseDraft:Draft`;
    case 'refine':
      return $localize`:@@featureChat-planPhaseRefine:Refine`;
    case 'ready':
      return $localize`:@@featureChat-planPhaseReady:Ready`;
    default:
      return phase;
  }
}
