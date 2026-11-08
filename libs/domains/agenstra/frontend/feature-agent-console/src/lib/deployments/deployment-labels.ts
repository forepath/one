import {
  DEPLOYMENT_PROVIDER_AUTH_TYPES,
  type ConnectionAuthType,
  type ConnectionTestStatus,
  type DeploymentProvider,
  type DeploymentRunConclusion,
  type DeploymentRunStatus,
  type DeploymentRunTriggerType,
  type DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import type { FpcTableState } from '@forepath/shared/frontend/ui-components';

/**
 * Readable labels of the workspace deployments page and the admin connections page. Runs / jobs report a normalized
 * status (`queued`, `in_progress`, `completed`) and, once completed, a conclusion (`success`, `failure`, …); the
 * conclusion is the more telling value, so it wins once the run completed.
 */

export function deploymentRunStatusLabel(status: DeploymentRunStatus | null | undefined): string {
  switch (status) {
    case 'queued':
      return $localize`:@@featureDeployments-statusQueued:Queued`;
    case 'in_progress':
      return $localize`:@@featureDeployments-statusInProgress:In progress`;
    case 'completed':
      return $localize`:@@featureDeployments-statusCompleted:Completed`;
    default:
      return $localize`:@@featureDeployments-statusNeverRun:Not run yet`;
  }
}

export function deploymentRunConclusionLabel(conclusion: DeploymentRunConclusion | null | undefined): string {
  switch (conclusion) {
    case 'success':
      return $localize`:@@featureDeployments-conclusionSuccess:Succeeded`;
    case 'failure':
      return $localize`:@@featureDeployments-conclusionFailure:Failed`;
    case 'cancelled':
      return $localize`:@@featureDeployments-conclusionCancelled:Cancelled`;
    case 'skipped':
      return $localize`:@@featureDeployments-conclusionSkipped:Skipped`;
    case 'timed_out':
      return $localize`:@@featureDeployments-conclusionTimedOut:Timed out`;
    case 'neutral':
      return $localize`:@@featureDeployments-conclusionNeutral:Neutral`;
    default:
      return deploymentRunStatusLabel('completed');
  }
}

/** State cell / badge of a run or job. */
export function deploymentRunState(item: {
  status: DeploymentRunStatus | null | undefined;
  conclusion?: DeploymentRunConclusion | null;
}): FpcTableState {
  switch (item.status) {
    case 'queued':
      return { label: deploymentRunStatusLabel('queued'), tone: 'info', icon: 'clock' };
    case 'in_progress':
      return { label: deploymentRunStatusLabel('in_progress'), tone: 'primary', icon: 'arrow-repeat' };
    case 'completed': {
      const label = deploymentRunConclusionLabel(item.conclusion);

      switch (item.conclusion) {
        case 'success':
          return { label, tone: 'success', icon: 'check-circle-fill' };
        case 'failure':
        case 'timed_out':
          return { label, tone: 'danger', icon: 'x-circle-fill' };
        case 'cancelled':
          return { label, tone: 'warning', icon: 'stop-circle' };
        default:
          return { label, tone: 'neutral', icon: 'dash-circle' };
      }
    }
    default:
      return { label: deploymentRunStatusLabel(null), tone: 'neutral', icon: 'dash-circle', severity: 6 };
  }
}

/** Label of a workflow an environment proposed / changed that waits for a workspace admin. */
export function deploymentWorkflowPendingLabel(): string {
  return $localize`:@@featureDeployments-workflowPendingApproval:Waiting for approval`;
}

/** Whether a workflow waits for approval (nobody can start runs meanwhile). */
export function isDeploymentWorkflowPending(workflow: Pick<DeploymentWorkflowSummary, 'approvalStatus'>): boolean {
  return workflow.approvalStatus === 'pending';
}

/** State cell of a workflow (workflows table): waiting for approval, disabled, otherwise the last run. */
export function deploymentWorkflowState(
  workflow: Pick<DeploymentWorkflowSummary, 'enabled' | 'lastRunStatus' | 'lastRunConclusion'> &
    Partial<Pick<DeploymentWorkflowSummary, 'approvalStatus'>>,
): FpcTableState {
  if (workflow.approvalStatus === 'pending') {
    return { label: deploymentWorkflowPendingLabel(), tone: 'warning', icon: 'hourglass-split' };
  }

  if (!workflow.enabled) {
    return {
      label: $localize`:@@featureDeployments-workflowDisabled:Disabled`,
      tone: 'neutral',
      icon: 'pause-circle',
      severity: 7,
    };
  }

  return deploymentRunState({ status: workflow.lastRunStatus, conclusion: workflow.lastRunConclusion });
}

export function deploymentProviderLabel(provider: DeploymentProvider | string): string {
  switch (provider) {
    case 'github':
      return $localize`:@@featureDeployments-providerGithub:GitHub Actions`;
    case 'gitlab':
      return $localize`:@@featureDeployments-providerGitlab:GitLab CI/CD`;
    case 'jenkins':
      return $localize`:@@featureDeployments-providerJenkins:Jenkins`;
    default:
      return provider;
  }
}

/** Bootstrap icon (without `bi-`) of a provider. */
export function deploymentProviderIcon(provider: DeploymentProvider | string): string {
  switch (provider) {
    case 'github':
      return 'github';
    case 'gitlab':
      return 'gitlab';
    default:
      return 'gear-wide-connected';
  }
}

export function deploymentTriggerLabel(triggeredBy: DeploymentRunTriggerType): string {
  switch (triggeredBy) {
    case 'agent':
      return $localize`:@@featureDeployments-triggerAgent:Environment`;
    case 'external':
      return $localize`:@@featureDeployments-triggerExternal:Provider`;
    default:
      return $localize`:@@featureDeployments-triggerUser:Console`;
  }
}

/** Auth variant label; the token wording follows the provider (GitHub PAT, GitLab access token, Jenkins API token). */
export function connectionAuthTypeLabel(authType: ConnectionAuthType, provider: DeploymentProvider): string {
  if (authType === 'app') {
    return $localize`:@@featureDeploymentConnections-authApp:GitHub App`;
  }

  switch (provider) {
    case 'gitlab':
      return $localize`:@@featureDeploymentConnections-authTokenGitlab:Access token`;
    case 'jenkins':
      return $localize`:@@featureDeploymentConnections-authTokenJenkins:API token`;
    default:
      return $localize`:@@featureDeploymentConnections-authTokenGithub:Personal access token`;
  }
}

/** Auth variants the provider supports (first = default). */
export function connectionAuthTypesFor(provider: DeploymentProvider): readonly ConnectionAuthType[] {
  return DEPLOYMENT_PROVIDER_AUTH_TYPES[provider];
}

/** Persisted result of the last connection test. */
export function connectionTestState(status: ConnectionTestStatus | null | undefined): FpcTableState {
  switch (status) {
    case 'ok':
      return {
        label: $localize`:@@featureDeploymentConnections-testOk:Connected`,
        tone: 'success',
        icon: 'check-circle-fill',
      };
    case 'failed':
      return {
        label: $localize`:@@featureDeploymentConnections-testFailed:Failed`,
        tone: 'danger',
        icon: 'x-circle-fill',
      };
    default:
      return {
        label: $localize`:@@featureDeploymentConnections-testUntested:Not tested`,
        tone: 'neutral',
        icon: 'question-circle',
      };
  }
}

/**
 * Runs / jobs newest first by start time: `startedAt` (runs fall back to `createdAt`, so a queued run that has not
 * started yet stays on top); rows without any time go last; ties keep their order.
 */
export function sortNewestStartedFirst<T extends { startedAt: string | null; createdAt?: string | null }>(
  rows: readonly T[],
): T[] {
  const time = (row: T): number => {
    const value = row.startedAt ?? row.createdAt ?? null;
    const parsed = value ? Date.parse(value) : Number.NaN;

    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };

  return rows
    .map((row, index) => ({ row, index, time: time(row) }))
    .sort((a, b) => (a.time === b.time ? a.index - b.index : b.time - a.time))
    .map((entry) => entry.row);
}

/** File name of a downloaded log (`<workflow>-<run>[-<job>].log`, file-system safe). */
export function deploymentLogFileName(parts: readonly (string | null | undefined)[]): string {
  const base = parts
    .filter((part): part is string => !!part && !!part.trim())
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');

  return `${base || 'deployment'}.log`;
}
