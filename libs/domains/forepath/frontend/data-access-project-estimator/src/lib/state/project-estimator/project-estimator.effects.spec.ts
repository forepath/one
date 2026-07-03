import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { ForepathDeviceCapabilityService } from '../../services/forepath-device-capability.service';
import { ForepathLocalLlmService } from '../../services/forepath-local-llm.service';
import { ForepathLlmMemoryProfileService } from '../../services/forepath-llm-memory-profile.service';
import { ForepathPricingCalculatorService } from '../../services/forepath-pricing-calculator.service';
import { FOREPATH_LLM_MEMORY_PROFILE_STANDARD } from '../../constants/forepath-llm-memory.constants';

import { ProjectEstimatorActions } from './project-estimator.actions';
import {
  checkDeviceCapability$,
  estimateProject$,
  initializeEstimator$,
  preloadModel$,
  requestGpuAccess$,
} from './project-estimator.effects';
import { shouldAutoRequestGpuAccess } from '../../utils/forepath-estimator-capability.utils';

jest.mock('../../utils/forepath-estimator-capability.utils', () => ({
  ...jest.requireActual('../../utils/forepath-estimator-capability.utils'),
  shouldAutoRequestGpuAccess: jest.fn(),
}));

describe('projectEstimatorEffects', () => {
  let actions$: Actions;
  let capabilityService: jest.Mocked<ForepathDeviceCapabilityService>;
  let memoryProfileService: jest.Mocked<Pick<ForepathLlmMemoryProfileService, 'setProfile' | 'getProfile'>>;
  let localLlmService: jest.Mocked<ForepathLocalLlmService>;
  let pricingCalculator: jest.Mocked<ForepathPricingCalculatorService>;
  let store: { dispatch: jest.Mock };

  beforeEach(() => {
    capabilityService = {
      checkCapability: jest.fn(),
      probeEnvironment: jest.fn(),
      requestGpuAccess: jest.fn(),
    } as never;

    memoryProfileService = {
      setProfile: jest.fn(),
      getProfile: jest.fn().mockReturnValue(FOREPATH_LLM_MEMORY_PROFILE_STANDARD),
    };

    localLlmService = {
      preload: jest.fn(),
      generateBreakdown: jest.fn(),
      buildSystemPrompt: jest.fn(),
      unload: jest.fn(),
    } as never;

    pricingCalculator = {
      calculateEstimate: jest.fn(),
      buildCatalogPromptContext: jest.fn(),
    } as never;

    store = {
      dispatch: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: ForepathDeviceCapabilityService, useValue: capabilityService },
        { provide: ForepathLocalLlmService, useValue: localLlmService },
        { provide: ForepathPricingCalculatorService, useValue: pricingCalculator },
        { provide: Store, useValue: store },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  it('should auto-request gpu access when consent was previously granted', (done) => {
    actions$ = of(ProjectEstimatorActions.initializeEstimator());
    capabilityService.probeEnvironment.mockReturnValue({
      awaitingGpuPermission: true,
      unsupportedReason: null,
    });
    jest.mocked(shouldAutoRequestGpuAccess).mockReturnValue(true);

    initializeEstimator$(actions$, capabilityService).subscribe((action) => {
      expect(action).toEqual(ProjectEstimatorActions.requestGpuAccess());
      done();
    });
  });

  it('should require gpu permission when webgpu is available', (done) => {
    actions$ = of(ProjectEstimatorActions.initializeEstimator());
    capabilityService.probeEnvironment.mockReturnValue({
      awaitingGpuPermission: true,
      unsupportedReason: null,
    });
    jest.mocked(shouldAutoRequestGpuAccess).mockReturnValue(false);

    initializeEstimator$(actions$, capabilityService).subscribe((action) => {
      expect(action).toEqual(ProjectEstimatorActions.gpuAccessRequired());
      done();
    });
  });

  it('should mark unsupported devices during initialization', (done) => {
    actions$ = of(ProjectEstimatorActions.initializeEstimator());
    capabilityService.probeEnvironment.mockReturnValue({
      awaitingGpuPermission: false,
      unsupportedReason: 'WebGPU is required to run the local estimation model on this device.',
    });

    initializeEstimator$(actions$, capabilityService).subscribe((action) => {
      expect(action).toEqual(
        ProjectEstimatorActions.checkDeviceCapabilitySuccess({
          supported: false,
          reason: 'WebGPU is required to run the local estimation model on this device.',
        }),
      );
      done();
    });
  });

  it('should emit capability success when gpu access is granted', (done) => {
    actions$ = of(ProjectEstimatorActions.requestGpuAccess());
    capabilityService.requestGpuAccess.mockResolvedValue({
      supported: true,
      reason: null,
      memoryProfile: FOREPATH_LLM_MEMORY_PROFILE_STANDARD,
    });

    requestGpuAccess$(actions$, capabilityService, memoryProfileService as never).subscribe((action) => {
      expect(memoryProfileService.setProfile).toHaveBeenCalledWith(FOREPATH_LLM_MEMORY_PROFILE_STANDARD);
      expect(action).toEqual(
        ProjectEstimatorActions.checkDeviceCapabilitySuccess({
          supported: true,
          reason: null,
          deviceMaxMemoryProfileId: 'standard',
          activeMemoryProfileId: 'standard',
        }),
      );
      done();
    });
  });

  it('should emit capability success when device is supported', (done) => {
    actions$ = of(ProjectEstimatorActions.checkDeviceCapability());
    capabilityService.checkCapability.mockResolvedValue({
      supported: true,
      reason: null,
      memoryProfile: FOREPATH_LLM_MEMORY_PROFILE_STANDARD,
    });

    checkDeviceCapability$(actions$, capabilityService, memoryProfileService as never).subscribe((action) => {
      expect(memoryProfileService.setProfile).toHaveBeenCalledWith(FOREPATH_LLM_MEMORY_PROFILE_STANDARD);
      expect(action).toEqual(
        ProjectEstimatorActions.checkDeviceCapabilitySuccess({
          supported: true,
          reason: null,
          deviceMaxMemoryProfileId: 'standard',
          activeMemoryProfileId: 'standard',
        }),
      );
      done();
    });
  });

  it('should preload model and dispatch progress updates', (done) => {
    actions$ = of(ProjectEstimatorActions.preloadModel());
    localLlmService.preload.mockImplementation(async (onProgress) => {
      onProgress?.({ progress: 0.5, text: 'Loading weights' });
    });

    preloadModel$(actions$, localLlmService, memoryProfileService as never, store as never).subscribe((action) => {
      expect(localLlmService.preload).toHaveBeenCalled();
      expect(store.dispatch).toHaveBeenCalledWith(
        ProjectEstimatorActions.preloadModelProgress({ progress: 0.5, text: 'Loading weights' }),
      );
      expect(action).toEqual(ProjectEstimatorActions.preloadModelSuccess({ activeMemoryProfileId: 'standard' }));
      done();
    });
  });

  it('should estimate project on valid description', (done) => {
    const breakdown = {
      summary: 'Custom app',
      lineItems: [
        {
          serviceId: 'software-development' as const,
          description: 'Implementation',
          billingUnits: 10,
        },
      ],
      assumptions: ['Standard rate'],
      confidence: 'medium' as const,
    };
    const estimate = {
      summary: 'Custom app',
      lineItems: [],
      subtotalNet: 337.6,
      assumptions: ['Standard rate'],
      confidence: 'medium' as const,
      disclaimer: 'Indicative only',
    };

    actions$ = of(ProjectEstimatorActions.submitProjectDescription({ description: 'Build a custom app' }));
    localLlmService.generateBreakdown.mockResolvedValue(breakdown);
    pricingCalculator.calculateEstimate.mockReturnValue(estimate);

    estimateProject$(actions$, localLlmService, pricingCalculator).subscribe((action) => {
      expect(action.type).toBe('[Project Estimator] Estimate Project Success');
      if (action.type === '[Project Estimator] Estimate Project Success') {
        expect(action.estimate).toEqual(estimate);
        expect(action.userMessage.content).toBe('Build a custom app');
      }
      done();
    });
  });

  it('should fail when description is empty', (done) => {
    actions$ = of(ProjectEstimatorActions.submitProjectDescription({ description: '   ' }));

    estimateProject$(actions$, localLlmService, pricingCalculator).subscribe((action) => {
      expect(action).toEqual(
        ProjectEstimatorActions.estimateProjectFailure({ error: 'Please describe your project first.' }),
      );
      done();
    });
  });

  it('should fail when local model throws', (done) => {
    actions$ = of(ProjectEstimatorActions.submitProjectDescription({ description: 'Build a portal' }));
    localLlmService.generateBreakdown.mockRejectedValue(new Error('Model unavailable'));

    estimateProject$(actions$, localLlmService, pricingCalculator).subscribe((action) => {
      expect(action).toEqual(ProjectEstimatorActions.estimateProjectFailure({ error: 'Model unavailable' }));
      done();
    });
  });
});
