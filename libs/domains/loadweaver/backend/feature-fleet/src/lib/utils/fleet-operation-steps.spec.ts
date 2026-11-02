import {
  cloneDeploymentDocument,
  currentStep,
  initialSteps,
  operationStatus,
  planBundle,
  planOutcome,
  restoreDocuments,
  restoreOutcome,
  restoreResourceName,
  updateStep,
  validateRestoreParams,
  type RestoreOperationParams,
} from './fleet-operation-steps';

const B1 = '11111111-1111-4111-8111-111111111111';
const OP = 'abcdef12-0000-4000-8000-000000000000';
const params: RestoreOperationParams = {
  backups: [{ backupId: B1, volume: 'data' }],
  target: { project: 'shop', deployment: 'web' },
  mode: 'replace',
  apply: true,
};

describe('fleet operation steps (3.20)', () => {
  it('plans restore, clone and final-backup steps', () => {
    expect(initialSteps('cross-cluster-restore').map((s) => s.key)).toEqual([
      'validate',
      'transfer',
      'restore-plan',
      'restore-apply',
      'restore-wait',
    ]);
    expect(
      initialSteps('clone')
        .map((s) => s.key)
        .slice(0, 3),
    ).toEqual(['validate', 'deployment-plan', 'deployment-apply']);
    expect(initialSteps('final-backup').map((s) => s.key)).toContain('volumes-wait');
  });

  it('walks steps and derives the operation status', () => {
    let steps = initialSteps('cross-cluster-restore');
    const now = new Date('2026-10-20T10:00:00Z');

    expect(currentStep(steps)?.key).toBe('validate');
    steps = updateStep(steps, 'validate', { status: 'succeeded', detail: { a: 1 } }, now);
    expect(steps[0]).toMatchObject({
      status: 'succeeded',
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
    });
    expect(operationStatus('cross-cluster-restore', steps)).toBe('running');
    steps = updateStep(steps, 'transfer', { status: 'waiting' }, now);
    expect(operationStatus('cross-cluster-restore', steps)).toBe('waiting');
    expect(steps[1].finishedAt).toBeNull();
    steps = updateStep(steps, 'transfer', { status: 'failed', error: 'x' }, now);
    expect(operationStatus('cross-cluster-restore', steps)).toBe('failed');
  });

  it('keeps final backups going after a failed step (best effort)', () => {
    let steps = initialSteps('final-backup');

    steps = updateStep(steps, 'platform-postgres', { status: 'failed' });
    expect(operationStatus('final-backup', steps)).toBe('running');
    for (const key of ['platform-opensearch', 'platform-etcd', 'volumes', 'volumes-wait', 'copies'])
      steps = updateStep(steps, key, { status: key === 'platform-etcd' ? 'skipped' : 'succeeded' });
    expect(operationStatus('final-backup', steps)).toBe('failed');
    expect(operationStatus('final-backup', updateStep(steps, 'platform-postgres', { status: 'succeeded' }))).toBe(
      'succeeded',
    );
  });

  it('validates input', () => {
    expect(validateRestoreParams('cross-cluster-restore', params)).toEqual([]);
    expect(validateRestoreParams('clone', params)).toContain('clone needs the source deployment');
    expect(
      validateRestoreParams('cross-cluster-restore', {
        ...params,
        backups: [
          { backupId: 'x', volume: 'data' },
          { backupId: B1, volume: 'data' },
        ],
      }),
    ).toEqual(['invalid backup id x', 'each target volume at most once']);
  });

  it('renders Restore resources and the plan bundle', () => {
    const docs = restoreDocuments(OP, params, { [B1]: 'imported-1' });

    expect(docs).toEqual([
      {
        apiVersion: 'loadweaver.com/v1',
        kind: 'Restore',
        metadata: { name: 'fleet-abcdef12-data', project: 'shop' },
        spec: {
          description: `Fleet operation ${OP}: backup ${B1} of another cluster`,
          backup: 'imported-1',
          target: { deployment: 'web', volume: 'data', mode: 'replace' },
        },
      },
    ]);
    expect(planBundle([{ a: 1 }, { b: 2 }])).toBe('{"a":1}\n---\n{"b":2}');
    expect(restoreResourceName(OP, 'My_Vol.1')).toBe('fleet-abcdef12-my-vol-1');
  });

  it('rewrites a deployment for the clone target', () => {
    expect(
      cloneDeploymentDocument(
        {
          kind: 'Deployment',
          metadata: { name: 'web', project: 'shop', labels: { tier: 'web' }, uid: 'x' },
          spec: { compose: 'y' },
        },
        { project: 'staging', deployment: 'web-copy' },
      ),
    ).toEqual({
      apiVersion: 'loadweaver.com/v1',
      kind: 'Deployment',
      metadata: { name: 'web-copy', project: 'staging', labels: { tier: 'web' } },
      spec: { compose: 'y' },
    });
    expect(() => cloneDeploymentDocument({ kind: 'Policy', spec: {} }, params.target)).toThrow('not a deployment');
  });

  it('maps plan and restore states', () => {
    expect(planOutcome('applied')).toBe('applied');
    expect(planOutcome('rolled-back')).toBe('failed');
    expect(planOutcome('pending')).toBe('pending');
    expect(restoreOutcome('done')).toBe('succeeded');
    expect(restoreOutcome('failed')).toBe('failed');
    expect(restoreOutcome('running')).toBe('pending');
  });
});
