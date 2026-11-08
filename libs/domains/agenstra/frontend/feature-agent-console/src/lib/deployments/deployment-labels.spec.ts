import {
  connectionAuthTypeLabel,
  connectionAuthTypesFor,
  connectionTestState,
  deploymentLogFileName,
  deploymentProviderIcon,
  deploymentProviderLabel,
  deploymentRunState,
  deploymentTriggerLabel,
  deploymentWorkflowState,
  isDeploymentWorkflowPending,
  sortNewestStartedFirst,
} from './deployment-labels';

describe('deployment labels', () => {
  it('maps run status and conclusion to a state cell (conclusion wins once completed)', () => {
    expect(deploymentRunState({ status: 'queued' })).toMatchObject({ label: 'Queued', tone: 'info' });
    expect(deploymentRunState({ status: 'in_progress' })).toMatchObject({ label: 'In progress', tone: 'primary' });
    expect(deploymentRunState({ status: 'completed', conclusion: 'success' })).toMatchObject({
      label: 'Succeeded',
      tone: 'success',
    });
    expect(deploymentRunState({ status: 'completed', conclusion: 'timed_out' })).toMatchObject({ tone: 'danger' });
    expect(deploymentRunState({ status: 'completed', conclusion: 'cancelled' })).toMatchObject({ tone: 'warning' });
    expect(deploymentRunState({ status: null })).toMatchObject({ label: 'Not run yet', tone: 'neutral' });
  });

  it('shows disabled workflows as such, otherwise their last run', () => {
    expect(
      deploymentWorkflowState({ enabled: false, lastRunStatus: 'completed', lastRunConclusion: 'success' }),
    ).toMatchObject({ label: 'Disabled' });
    expect(
      deploymentWorkflowState({ enabled: true, lastRunStatus: 'completed', lastRunConclusion: 'failure' }),
    ).toMatchObject({ label: 'Failed', tone: 'danger' });
  });

  it('shows workflows waiting for approval before anything else', () => {
    expect(
      deploymentWorkflowState({
        approvalStatus: 'pending',
        enabled: false,
        lastRunStatus: 'completed',
        lastRunConclusion: 'success',
      }),
    ).toEqual({ label: 'Waiting for approval', tone: 'warning', icon: 'hourglass-split' });
    expect(
      deploymentWorkflowState({
        approvalStatus: 'approved',
        enabled: true,
        lastRunStatus: null,
        lastRunConclusion: null,
      }),
    ).toMatchObject({ label: 'Not run yet' });
    expect(isDeploymentWorkflowPending({ approvalStatus: 'pending' })).toBe(true);
    expect(isDeploymentWorkflowPending({ approvalStatus: 'approved' })).toBe(false);
  });

  it('sorts runs and jobs newest first by start time (fallback created, missing last)', () => {
    const rows = [
      { id: 'old', startedAt: '2026-11-01T08:00:00.000Z', createdAt: '2026-11-01T07:59:00.000Z' },
      { id: 'queued', startedAt: null, createdAt: '2026-11-03T08:00:00.000Z' },
      { id: 'none', startedAt: null, createdAt: null },
      { id: 'new', startedAt: '2026-11-02T08:00:00.000Z', createdAt: '2026-11-02T07:59:00.000Z' },
    ];

    expect(sortNewestStartedFirst(rows).map((row) => row.id)).toEqual(['queued', 'new', 'old', 'none']);

    const jobs = [
      { id: 'pending', startedAt: null },
      { id: 'build', startedAt: '2026-11-01T08:00:00.000Z' },
      { id: 'deploy', startedAt: '2026-11-01T08:05:00.000Z' },
    ];

    expect(sortNewestStartedFirst(jobs).map((job) => job.id)).toEqual(['deploy', 'build', 'pending']);
  });

  it('labels providers, triggers and auth types', () => {
    expect(deploymentProviderLabel('github')).toBe('GitHub Actions');
    expect(deploymentProviderIcon('jenkins')).toBe('gear-wide-connected');
    expect(deploymentTriggerLabel('agent')).toBe('Environment');
    expect(deploymentTriggerLabel('external')).toBe('Provider');
    expect(connectionAuthTypeLabel('app', 'github')).toBe('GitHub App');
    expect(connectionAuthTypeLabel('token', 'jenkins')).toBe('API token');
    expect(connectionAuthTypesFor('github')).toEqual(['app', 'token']);
    expect(connectionAuthTypesFor('gitlab')).toEqual(['token']);
  });

  it('maps the persisted connection test status', () => {
    expect(connectionTestState('ok')).toMatchObject({ tone: 'success' });
    expect(connectionTestState('failed')).toMatchObject({ tone: 'danger' });
    expect(connectionTestState('untested')).toMatchObject({ tone: 'neutral' });
  });

  it('builds file-system safe log file names', () => {
    expect(deploymentLogFileName(['Deploy API', '#42', 'build / test'])).toBe('deploy-api-42-build-test.log');
    expect(deploymentLogFileName([null, ' '])).toBe('deployment.log');
  });
});
