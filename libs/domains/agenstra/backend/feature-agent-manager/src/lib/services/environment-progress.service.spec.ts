import type { EnvironmentProgressDto } from '../dto/environment-progress.dto';

import {
  CREATE_ENVIRONMENT_PROGRESS_STEPS,
  EnvironmentProgressService,
  RECONCILE_ENVIRONMENT_PROGRESS_STEPS,
} from './environment-progress.service';

describe('EnvironmentProgressService', () => {
  let service: EnvironmentProgressService;
  let emitted: EnvironmentProgressDto[];

  beforeEach(() => {
    service = new EnvironmentProgressService();
    emitted = [];
    service.registerBroadcaster((progress) => emitted.push(progress));
  });

  it('should start a running operation at 0% and broadcast it', () => {
    const tracker = service.start({
      agentName: 'new-env',
      operation: 'create',
      steps: CREATE_ENVIRONMENT_PROGRESS_STEPS,
    });

    expect(tracker.operationId).toEqual(expect.any(String));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(
      expect.objectContaining({
        operationId: tracker.operationId,
        agentId: null,
        agentName: 'new-env',
        operation: 'create',
        status: 'running',
        step: 'preparing',
        stepIndex: 0,
        stepCount: CREATE_ENVIRONMENT_PROGRESS_STEPS.length,
        progress: 0,
      }),
    );
    expect(service.list()).toHaveLength(1);
  });

  it('should compute weighted progress from completed steps and in-step fraction', () => {
    const tracker = service.start({
      agentName: 'env',
      operation: 'create',
      steps: [
        { step: 'pullingImage', weight: 50 },
        { step: 'creatingContainer', weight: 50 },
      ],
    });

    tracker.reportStepProgress(0.5);
    expect(service.list()[0].progress).toBe(25);

    tracker.advance('creatingContainer');
    expect(service.list()[0]).toEqual(expect.objectContaining({ step: 'creatingContainer', progress: 50 }));

    tracker.reportStepProgress(1);
    // Running operations never report 100%.
    expect(service.list()[0].progress).toBe(99);
  });

  it('should not emit when in-step progress does not change the integer percentage', () => {
    const tracker = service.start({
      agentName: 'env',
      operation: 'create',
      steps: [{ step: 'pullingImage', weight: 100 }],
    });

    emitted = [];
    tracker.reportStepProgress(0.001);
    tracker.reportStepProgress(0.002);

    expect(emitted).toHaveLength(0);

    tracker.reportStepProgress(0.1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].progress).toBe(10);
  });

  it('should ignore regressions to earlier steps and lower fractions', () => {
    const tracker = service.start({
      agentName: 'env',
      operation: 'update',
      steps: RECONCILE_ENVIRONMENT_PROGRESS_STEPS,
    });

    tracker.advance('recreatingContainer');
    const progressAfterAdvance = service.list()[0].progress;

    tracker.advance('summarizingContext');
    tracker.reportStepProgress(-1);

    expect(service.list()[0]).toEqual(
      expect.objectContaining({ step: 'recreatingContainer', progress: progressAfterAdvance }),
    );
  });

  it('should ignore unknown steps', () => {
    const tracker = service.start({
      agentName: 'env',
      operation: 'update',
      steps: RECONCILE_ENVIRONMENT_PROGRESS_STEPS,
    });

    tracker.advance('pullingImage');

    expect(service.list()[0].step).toBe('queued');
  });

  it('should attach the agent id once known', () => {
    const tracker = service.start({ agentName: 'env', operation: 'create', steps: CREATE_ENVIRONMENT_PROGRESS_STEPS });

    tracker.setAgentId('agent-1');

    expect(service.list()[0].agentId).toBe('agent-1');
    expect(emitted.at(-1)?.agentId).toBe('agent-1');
  });

  it('should broadcast completion at 100% and drop the operation', () => {
    const tracker = service.start({ agentName: 'env', operation: 'create', steps: CREATE_ENVIRONMENT_PROGRESS_STEPS });

    tracker.complete();

    expect(emitted.at(-1)).toEqual(expect.objectContaining({ status: 'completed', progress: 100, step: 'finalizing' }));
    expect(service.list()).toEqual([]);

    emitted = [];
    tracker.advance('finalizing');
    tracker.complete();
    expect(emitted).toEqual([]);
  });

  it('should broadcast failures with an error message and drop the operation', () => {
    const tracker = service.start({
      agentId: 'a1',
      agentName: 'env',
      operation: 'update',
      steps: RECONCILE_ENVIRONMENT_PROGRESS_STEPS,
    });

    tracker.fail(new Error('boom'));

    expect(emitted.at(-1)).toEqual(expect.objectContaining({ status: 'failed', error: 'boom', agentId: 'a1' }));
    expect(service.list()).toEqual([]);
  });

  it('should accept string failure reasons', () => {
    const tracker = service.start({
      agentName: 'env',
      operation: 'update',
      steps: RECONCILE_ENVIRONMENT_PROGRESS_STEPS,
    });

    tracker.fail('aborted');

    expect(emitted.at(-1)?.error).toBe('aborted');
  });

  it('should list operations oldest first', () => {
    jest.useFakeTimers();

    try {
      jest.setSystemTime(Date.parse('2024-01-01T00:00:00Z'));
      service.start({ agentName: 'first', operation: 'create', steps: CREATE_ENVIRONMENT_PROGRESS_STEPS });
      jest.setSystemTime(Date.parse('2024-01-01T00:00:05Z'));
      service.start({ agentName: 'second', operation: 'create', steps: CREATE_ENVIRONMENT_PROGRESS_STEPS });

      expect(service.list().map((op) => op.agentName)).toEqual(['first', 'second']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should reject empty step plans', () => {
    expect(() => service.start({ agentName: 'env', operation: 'create', steps: [] })).toThrow();
  });

  it('should keep tracking when the broadcaster throws', () => {
    service.registerBroadcaster(() => {
      throw new Error('socket down');
    });

    const tracker = service.start({ agentName: 'env', operation: 'create', steps: CREATE_ENVIRONMENT_PROGRESS_STEPS });

    expect(() => tracker.advance('pullingImage')).not.toThrow();
    expect(service.list()[0].step).toBe('pullingImage');
  });

  it('should work without a registered broadcaster', () => {
    const standalone = new EnvironmentProgressService();
    const tracker = standalone.start({
      agentName: 'env',
      operation: 'create',
      steps: CREATE_ENVIRONMENT_PROGRESS_STEPS,
    });

    tracker.advance('creatingContainer');

    expect(standalone.list()[0].step).toBe('creatingContainer');
  });
});
