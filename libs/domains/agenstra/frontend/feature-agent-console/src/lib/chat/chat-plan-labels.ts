import type { FpcBadgeColor } from '@forepath/shared/frontend/ui-components';

/**
 * Human-readable state labels for chat plans. This consolidates status + phase into one operator-facing summary.
 */
export function chatPlanStateLabel(status: string, phase: string): string {
  if (status === 'ready' && phase === 'draft') {
    return $localize`:@@featureChat-planStateDraftAvailable:Draft available`;
  }

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
      return phase || status;
  }
}

export function chatPlanStateBadgeColor(status: string, phase: string): FpcBadgeColor {
  if (status === 'ready' && phase === 'draft') {
    return 'info';
  }

  switch (status) {
    case 'ready':
    case 'executed':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'danger';
    case 'executing':
      return 'warning';
    default:
      return 'secondary';
  }
}
