import { createReducer, on } from '@ngrx/store';

import type {
  ChatMessage,
  DeviceCapabilityStatus,
  GpuAccessStatus,
  ModelStatus,
  ProjectEstimate,
} from '../../types/project-estimator.types';
import type { ForepathLlmMemoryProfileId } from '../../constants/forepath-llm-memory.constants';

import { buildProjectEstimatorDebugState } from './project-estimator.debug';
import { ProjectEstimatorActions } from './project-estimator.actions';

export interface ProjectEstimatorState {
  deviceCapability: DeviceCapabilityStatus;
  gpuAccessStatus: GpuAccessStatus;
  unsupportedReason: string | null;
  deviceMaxMemoryProfileId: ForepathLlmMemoryProfileId | null;
  activeMemoryProfileId: ForepathLlmMemoryProfileId | null;
  modelStatus: ModelStatus;
  modelLoadProgress: number;
  modelLoadText: string | null;
  messages: ChatMessage[];
  currentEstimate: ProjectEstimate | null;
  estimating: boolean;
  error: string | null;
}

export const initialProjectEstimatorState: ProjectEstimatorState = {
  deviceCapability: 'pending',
  gpuAccessStatus: 'not-applicable',
  unsupportedReason: null,
  deviceMaxMemoryProfileId: null,
  activeMemoryProfileId: null,
  modelStatus: 'idle',
  modelLoadProgress: 0,
  modelLoadText: null,
  messages: [],
  currentEstimate: null,
  estimating: false,
  error: null,
};

export const projectEstimatorReducer = createReducer(
  initialProjectEstimatorState,
  on(ProjectEstimatorActions.initializeEstimator, (state) => ({
    ...state,
    deviceCapability: 'pending' as const,
    gpuAccessStatus: 'not-applicable' as const,
    unsupportedReason: null,
    error: null,
  })),
  on(ProjectEstimatorActions.gpuAccessRequired, (state) => ({
    ...state,
    deviceCapability: 'pending' as const,
    gpuAccessStatus: 'pending' as const,
    unsupportedReason: null,
  })),
  on(ProjectEstimatorActions.requestGpuAccess, (state) => ({
    ...state,
    deviceCapability: 'checking' as const,
    gpuAccessStatus: 'requesting' as const,
    unsupportedReason: null,
    error: null,
  })),
  on(ProjectEstimatorActions.checkDeviceCapability, (state) => ({
    ...state,
    deviceCapability: 'checking' as const,
    unsupportedReason: null,
  })),
  on(
    ProjectEstimatorActions.checkDeviceCapabilitySuccess,
    (state, { supported, reason, deviceMaxMemoryProfileId, activeMemoryProfileId }) => ({
      ...state,
      deviceCapability: supported ? ('supported' as const) : ('unsupported' as const),
      gpuAccessStatus: supported
        ? ('granted' as const)
        : state.gpuAccessStatus === 'requesting'
          ? ('denied' as const)
          : ('not-applicable' as const),
      unsupportedReason: supported ? null : reason,
      deviceMaxMemoryProfileId: supported ? (deviceMaxMemoryProfileId ?? null) : null,
      activeMemoryProfileId: supported ? (activeMemoryProfileId ?? deviceMaxMemoryProfileId ?? null) : null,
    }),
  ),
  on(ProjectEstimatorActions.preloadModel, (state) => ({
    ...state,
    modelStatus: 'loading' as const,
    modelLoadProgress: 0,
    modelLoadText: null,
    error: null,
  })),
  on(ProjectEstimatorActions.preloadModelProgress, (state, { progress, text }) => ({
    ...state,
    modelLoadProgress: progress,
    modelLoadText: text,
  })),
  on(ProjectEstimatorActions.preloadModelSuccess, (state, { activeMemoryProfileId }) => ({
    ...state,
    modelStatus: 'ready' as const,
    modelLoadProgress: 1,
    activeMemoryProfileId,
  })),
  on(ProjectEstimatorActions.changeMemoryProfile, (state) => ({
    ...state,
    modelStatus: 'loading' as const,
    modelLoadProgress: 0,
    modelLoadText: null,
    error: null,
  })),
  on(ProjectEstimatorActions.preloadModelFailure, (state, { error }) => ({
    ...state,
    modelStatus: 'error' as const,
    error,
  })),
  on(ProjectEstimatorActions.submitProjectDescription, (state) => ({
    ...state,
    estimating: true,
    error: null,
  })),
  on(ProjectEstimatorActions.estimateProjectSuccess, (state, { userMessage, assistantMessage, estimate }) => ({
    ...state,
    estimating: false,
    messages: [...state.messages, userMessage, assistantMessage],
    currentEstimate: estimate,
    error: null,
  })),
  on(ProjectEstimatorActions.estimateProjectFailure, (state, { error }) => ({
    ...state,
    estimating: false,
    error,
  })),
  on(ProjectEstimatorActions.clearEstimateError, (state) => ({
    ...state,
    error: null,
  })),
  on(ProjectEstimatorActions.startOver, (state) => ({
    ...state,
    messages: [],
    currentEstimate: null,
    estimating: false,
    error: null,
  })),
  on(ProjectEstimatorActions.setDebugState, (_state, { preset }) => buildProjectEstimatorDebugState(preset)),
);
