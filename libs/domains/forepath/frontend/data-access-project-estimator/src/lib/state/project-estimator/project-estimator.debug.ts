import { FOREPATH_ESTIMATE_DISCLAIMER } from '../../constants/forepath-service-catalog.constants';
import type { ChatMessage, ProjectEstimate } from '../../types/project-estimator.types';

import type { ProjectEstimatorState } from './project-estimator.reducer';
import { initialProjectEstimatorState } from './project-estimator.reducer';

export type ProjectEstimatorDebugPreset =
  | 'reset'
  | 'awaitingGpuPermission'
  | 'checkingDevice'
  | 'unsupportedDevice'
  | 'modelWarmup'
  | 'readyEmpty'
  | 'generating'
  | 'modelLoadError'
  | 'estimateError'
  | 'withEstimate';

export interface ProjectEstimatorDebugPresetOption {
  preset: ProjectEstimatorDebugPreset;
  label: string;
  description: string;
}

export const PROJECT_ESTIMATOR_DEBUG_PRESETS: readonly ProjectEstimatorDebugPresetOption[] = [
  { preset: 'reset', label: 'Reset', description: 'Initial store state' },
  { preset: 'awaitingGpuPermission', label: 'GPU permission', description: 'GPU access permission guard' },
  { preset: 'checkingDevice', label: 'Checking device', description: 'Device capability spinner' },
  { preset: 'unsupportedDevice', label: 'Unsupported', description: 'Device fallback panel' },
  { preset: 'modelWarmup', label: 'Model warmup', description: 'Supported chat with loading overlay' },
  { preset: 'readyEmpty', label: 'Ready (empty)', description: 'Composer only, no messages' },
  { preset: 'generating', label: 'Generating', description: 'Estimate generation overlay' },
  { preset: 'modelLoadError', label: 'Model load error', description: 'Chat with model preload error' },
  { preset: 'estimateError', label: 'Estimate error', description: 'Chat with estimate failure alert' },
  { preset: 'withEstimate', label: 'With estimate', description: 'Chat with sample user and assistant messages' },
] as const;

const MOCK_ESTIMATE: ProjectEstimate = {
  summary: 'Customer portal with API integration and managed hosting support.',
  lineItems: [
    {
      serviceId: 'software-development',
      serviceName: 'Software Development',
      description: 'Customer portal MVP and API integration',
      billingUnits: 320,
      unitLabel: '15-minute billing unit',
      unitPrice: 33.76,
      lineTotal: 10803.2,
    },
    {
      serviceId: 'it-systems',
      serviceName: 'IT Systems',
      description: 'Managed hosting support for 3 months',
      billingUnits: 96,
      rateTier: 'standard',
      unitLabel: '15-minute billing unit',
      unitPrice: 30.54,
      lineTotal: 2931.84,
    },
  ],
  subtotalNet: 13735.04,
  assumptions: [
    'Timeline assumes a 3-month delivery window.',
    'Travel costs excluded unless on-site work is required.',
  ],
  confidence: 'medium',
  disclaimer: FOREPATH_ESTIMATE_DISCLAIMER,
};

const MOCK_USER_MESSAGE: ChatMessage = {
  id: 'debug-user-1',
  role: 'user',
  content: 'We need a customer portal, API integration, and managed hosting support for 3 months.',
  timestamp: '2026-07-02T10:00:00.000Z',
};

const MOCK_ASSISTANT_MESSAGE: ChatMessage = {
  id: 'debug-assistant-1',
  role: 'assistant',
  content: 'Based on your description, this looks like a portal build with ongoing managed hosting support.',
  timestamp: '2026-07-02T10:00:05.000Z',
  estimate: MOCK_ESTIMATE,
};

export function buildProjectEstimatorDebugState(preset: ProjectEstimatorDebugPreset): ProjectEstimatorState {
  switch (preset) {
    case 'reset':
      return { ...initialProjectEstimatorState };

    case 'awaitingGpuPermission':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'pending',
        gpuAccessStatus: 'pending',
        unsupportedReason: null,
      };

    case 'checkingDevice':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'checking',
        gpuAccessStatus: 'requesting',
        unsupportedReason: null,
      };

    case 'unsupportedDevice':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'unsupported',
        gpuAccessStatus: 'not-applicable',
        unsupportedReason: 'WebGPU is not available in this browser.',
        modelStatus: 'idle',
        estimating: false,
        error: null,
      };

    case 'modelWarmup':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'supported',
        gpuAccessStatus: 'granted',
        unsupportedReason: null,
        modelStatus: 'loading',
        modelLoadProgress: 0.45,
        modelLoadText: 'Loading model weights...',
        estimating: false,
        error: null,
        messages: [],
        currentEstimate: null,
      };

    case 'readyEmpty':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'supported',
        gpuAccessStatus: 'granted',
        unsupportedReason: null,
        deviceMaxMemoryProfileId: 'balanced',
        activeMemoryProfileId: 'balanced',
        modelStatus: 'ready',
        modelLoadProgress: 1,
        modelLoadText: null,
        estimating: false,
        error: null,
        messages: [],
        currentEstimate: null,
      };

    case 'generating':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'supported',
        gpuAccessStatus: 'granted',
        unsupportedReason: null,
        deviceMaxMemoryProfileId: 'balanced',
        activeMemoryProfileId: 'balanced',
        modelStatus: 'ready',
        modelLoadProgress: 1,
        modelLoadText: null,
        estimating: true,
        error: null,
        messages: [],
        currentEstimate: null,
      };

    case 'modelLoadError':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'supported',
        gpuAccessStatus: 'granted',
        unsupportedReason: null,
        modelStatus: 'error',
        modelLoadProgress: 0.2,
        modelLoadText: null,
        estimating: false,
        error: 'Local model files could not be loaded. Deploy the MLC model artifacts or check network access.',
        messages: [],
        currentEstimate: null,
      };

    case 'estimateError':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'supported',
        gpuAccessStatus: 'granted',
        unsupportedReason: null,
        deviceMaxMemoryProfileId: 'balanced',
        activeMemoryProfileId: 'balanced',
        modelStatus: 'ready',
        modelLoadProgress: 1,
        modelLoadText: null,
        estimating: false,
        error: 'Failed to parse model output.',
        messages: [],
        currentEstimate: null,
      };

    case 'withEstimate':
      return {
        ...initialProjectEstimatorState,
        deviceCapability: 'supported',
        gpuAccessStatus: 'granted',
        unsupportedReason: null,
        deviceMaxMemoryProfileId: 'balanced',
        activeMemoryProfileId: 'balanced',
        modelStatus: 'ready',
        modelLoadProgress: 1,
        modelLoadText: null,
        estimating: false,
        error: null,
        messages: [MOCK_USER_MESSAGE, MOCK_ASSISTANT_MESSAGE],
        currentEstimate: MOCK_ESTIMATE,
      };
  }
}
