import { ProjectEstimatorActions } from './project-estimator.actions';
import { initialProjectEstimatorState, projectEstimatorReducer } from './project-estimator.reducer';

describe('projectEstimatorReducer', () => {
  it('should require gpu permission when estimator initializes on a capable browser', () => {
    const state = projectEstimatorReducer(initialProjectEstimatorState, ProjectEstimatorActions.gpuAccessRequired());

    expect(state.deviceCapability).toBe('pending');
    expect(state.gpuAccessStatus).toBe('pending');
  });

  it('should set checking state when gpu access is requested', () => {
    const state = projectEstimatorReducer(initialProjectEstimatorState, ProjectEstimatorActions.requestGpuAccess());

    expect(state.deviceCapability).toBe('checking');
    expect(state.gpuAccessStatus).toBe('requesting');
  });

  it('should set checking state when capability check starts', () => {
    const state = projectEstimatorReducer(
      initialProjectEstimatorState,
      ProjectEstimatorActions.checkDeviceCapability(),
    );

    expect(state.deviceCapability).toBe('checking');
  });

  it('should mark device as supported', () => {
    const state = projectEstimatorReducer(
      initialProjectEstimatorState,
      ProjectEstimatorActions.checkDeviceCapabilitySuccess({
        supported: true,
        reason: null,
        deviceMaxMemoryProfileId: 'standard',
        activeMemoryProfileId: 'balanced',
      }),
    );

    expect(state.deviceCapability).toBe('supported');
    expect(state.gpuAccessStatus).toBe('granted');
    expect(state.deviceMaxMemoryProfileId).toBe('standard');
    expect(state.activeMemoryProfileId).toBe('balanced');
    expect(state.unsupportedReason).toBeNull();
  });

  it('should mark gpu access as denied when permission request fails', () => {
    const requestingState = projectEstimatorReducer(
      initialProjectEstimatorState,
      ProjectEstimatorActions.requestGpuAccess(),
    );
    const state = projectEstimatorReducer(
      requestingState,
      ProjectEstimatorActions.checkDeviceCapabilitySuccess({
        supported: false,
        reason: 'WebGPU adapter could not be initialized on this device.',
      }),
    );

    expect(state.deviceCapability).toBe('unsupported');
    expect(state.gpuAccessStatus).toBe('denied');
  });

  it('should mark device as unsupported with reason', () => {
    const state = projectEstimatorReducer(
      initialProjectEstimatorState,
      ProjectEstimatorActions.checkDeviceCapabilitySuccess({
        supported: false,
        reason: 'WebGPU unavailable',
      }),
    );

    expect(state.deviceCapability).toBe('unsupported');
    expect(state.gpuAccessStatus).toBe('not-applicable');
    expect(state.unsupportedReason).toBe('WebGPU unavailable');
  });

  it('should append messages and store estimate on success', () => {
    const userMessage = {
      id: 'user-1',
      role: 'user' as const,
      content: 'Build a portal',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const estimate = {
      summary: 'Portal build',
      lineItems: [],
      subtotalNet: 100,
      assumptions: [],
      confidence: 'medium' as const,
      disclaimer: 'Indicative only',
    };
    const assistantMessage = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'Portal build',
      timestamp: '2026-01-01T00:00:01.000Z',
      estimate,
    };

    const state = projectEstimatorReducer(
      { ...initialProjectEstimatorState, estimating: true },
      ProjectEstimatorActions.estimateProjectSuccess({
        userMessage,
        assistantMessage,
        estimate,
      }),
    );

    expect(state.estimating).toBe(false);
    expect(state.messages).toHaveLength(2);
    expect(state.currentEstimate).toEqual(estimate);
  });

  it('should store preload and estimate errors', () => {
    const preloadErrorState = projectEstimatorReducer(
      initialProjectEstimatorState,
      ProjectEstimatorActions.preloadModelFailure({ error: 'Model failed' }),
    );
    const estimateErrorState = projectEstimatorReducer(
      { ...initialProjectEstimatorState, estimating: true },
      ProjectEstimatorActions.estimateProjectFailure({ error: 'Parse failed' }),
    );

    expect(preloadErrorState.modelStatus).toBe('error');
    expect(preloadErrorState.error).toBe('Model failed');
    expect(estimateErrorState.estimating).toBe(false);
    expect(estimateErrorState.error).toBe('Parse failed');
  });

  it('should apply debug presets without touching the LLM', () => {
    const state = projectEstimatorReducer(
      initialProjectEstimatorState,
      ProjectEstimatorActions.setDebugState({ preset: 'withEstimate' }),
    );

    expect(state.deviceCapability).toBe('supported');
    expect(state.modelStatus).toBe('ready');
    expect(state.messages).toHaveLength(2);
    expect(state.currentEstimate?.subtotalNet).toBeGreaterThan(0);
  });

  it('should clear conversation state on start over', () => {
    const withEstimate = projectEstimatorReducer(
      initialProjectEstimatorState,
      ProjectEstimatorActions.setDebugState({ preset: 'withEstimate' }),
    );
    const state = projectEstimatorReducer(withEstimate, ProjectEstimatorActions.startOver());

    expect(state.messages).toEqual([]);
    expect(state.currentEstimate).toBeNull();
    expect(state.error).toBeNull();
    expect(state.estimating).toBe(false);
    expect(state.modelStatus).toBe('ready');
  });
});
