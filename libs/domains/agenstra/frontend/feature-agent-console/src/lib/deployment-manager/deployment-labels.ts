import type { FpcTableState } from '@forepath/shared/frontend/ui-components';

/**
 * Readable labels for deployment run / job states (3.38 D7). Runs and jobs report a provider status
 * (`queued`, `in_progress`, `completed`, …) and, once completed, a conclusion (`success`, `failure`, …); the
 * conclusion is the more telling value, so it wins when present. Unknown values fall back to the raw value.
 */
const STATE_LABELS: Record<string, string> = {
  queued: $localize`:@@featureDeploymentLabels-queued:Queued`,
  pending: $localize`:@@featureDeploymentLabels-pending:Pending`,
  waiting: $localize`:@@featureDeploymentLabels-waiting:Waiting`,
  requested: $localize`:@@featureDeploymentLabels-requested:Requested`,
  in_progress: $localize`:@@featureDeploymentLabels-inProgress:In progress`,
  running: $localize`:@@featureDeploymentLabels-running:Running`,
  completed: $localize`:@@featureDeploymentLabels-completed:Completed`,
  success: $localize`:@@featureDeploymentLabels-success:Succeeded`,
  failure: $localize`:@@featureDeploymentLabels-failure:Failed`,
  failed: $localize`:@@featureDeploymentLabels-failure:Failed`,
  cancelled: $localize`:@@featureDeploymentLabels-cancelled:Cancelled`,
  skipped: $localize`:@@featureDeploymentLabels-skipped:Skipped`,
  neutral: $localize`:@@featureDeploymentLabels-neutral:Neutral`,
  timed_out: $localize`:@@featureDeploymentLabels-timedOut:Timed out`,
  action_required: $localize`:@@featureDeploymentLabels-actionRequired:Action required`,
  stale: $localize`:@@featureDeploymentLabels-stale:Stale`,
};

const ACTIVE = new Set(['queued', 'pending', 'waiting', 'requested', 'in_progress', 'running']);

/** The value that best describes a run / job: the conclusion once there is one, the status otherwise. */
export function deploymentEffectiveState(item: { status: string; conclusion?: string | null }): string {
  const status = (item.status ?? '').toLowerCase();
  const conclusion = (item.conclusion ?? '').toLowerCase();

  return conclusion && !ACTIVE.has(status) ? conclusion : status;
}

/** Readable label of a status / conclusion (raw value when unknown). */
export function deploymentStateLabel(value: string | null | undefined): string {
  const key = (value ?? '').toLowerCase();

  return STATE_LABELS[key] ?? value ?? '';
}

/** Whether a run / job is still queued or running (cancel is possible). */
export function deploymentIsActive(item: { status: string }): boolean {
  return ACTIVE.has((item.status ?? '').toLowerCase());
}

/** State column / badge of a run or job. */
export function deploymentTableState(item: { status: string; conclusion?: string | null }): FpcTableState {
  const state = deploymentEffectiveState(item);
  const label = deploymentStateLabel(state);

  switch (state) {
    case 'success':
    case 'completed':
      return { label, tone: 'success', icon: 'check-circle' };
    case 'in_progress':
    case 'running':
      return { label, tone: 'primary', icon: 'arrow-repeat' };
    case 'queued':
    case 'pending':
    case 'waiting':
    case 'requested':
      return { label, tone: 'info', icon: 'clock' };
    case 'failure':
    case 'failed':
    case 'timed_out':
      return { label, tone: 'danger', icon: 'x-circle' };
    case 'action_required':
      return { label, tone: 'warning', icon: 'exclamation-triangle' };
    case 'cancelled':
      return { label, tone: 'warning', icon: 'stop-circle' };
    default:
      return { label, tone: 'neutral', icon: 'dash-circle' };
  }
}
