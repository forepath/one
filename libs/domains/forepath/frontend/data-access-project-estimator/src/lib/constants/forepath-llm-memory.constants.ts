export const FOREPATH_MIN_DEVICE_MEMORY_GB = 4;

export const FOREPATH_MIN_HARDWARE_CONCURRENCY = 4;

export const FOREPATH_LOCAL_LLM_MODEL_ID_STANDARD = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

export const FOREPATH_LOCAL_LLM_MODEL_ID_LITE = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

export const FOREPATH_MEMORY_HEADROOM_MAX_HEAP_USAGE = 0.82;

export const FOREPATH_MEMORY_PRESSURE_MESSAGE =
  'Your browser is low on memory. Close other tabs or apps, then reload this page before trying again.';

export const FOREPATH_DEVICE_LOST_MESSAGE =
  'The local model ran out of GPU memory. Close other tabs, reload this page, and try a shorter project description.';

export interface ForepathLlmMemoryProfile {
  modelId: string;
  contextWindowSize: number;
  maxTokens: number;
  prefillChunkSize: number;
  useCompactPrompt: boolean;
  profileId: ForepathLlmMemoryProfileId;
}

export type ForepathLlmMemoryProfileId = 'lite' | 'balanced' | 'standard';

export const FOREPATH_LLM_MEMORY_PROFILE_LITE: ForepathLlmMemoryProfile = {
  modelId: FOREPATH_LOCAL_LLM_MODEL_ID_LITE,
  contextWindowSize: 2048,
  maxTokens: 896,
  prefillChunkSize: 256,
  useCompactPrompt: true,
  profileId: 'lite',
};

export const FOREPATH_LLM_MEMORY_PROFILE_BALANCED: ForepathLlmMemoryProfile = {
  modelId: FOREPATH_LOCAL_LLM_MODEL_ID_STANDARD,
  contextWindowSize: 2048,
  maxTokens: 1024,
  prefillChunkSize: 512,
  useCompactPrompt: false,
  profileId: 'balanced',
};

export const FOREPATH_LLM_MEMORY_PROFILE_STANDARD: ForepathLlmMemoryProfile = {
  modelId: FOREPATH_LOCAL_LLM_MODEL_ID_STANDARD,
  contextWindowSize: 2048,
  maxTokens: 1024,
  prefillChunkSize: 768,
  useCompactPrompt: false,
  profileId: 'standard',
};

export function resolveForepathLlmMemoryProfile(input: {
  deviceMemoryGb: number | undefined;
  hardwareConcurrency: number;
}): ForepathLlmMemoryProfile | null {
  const { deviceMemoryGb, hardwareConcurrency } = input;

  if (deviceMemoryGb !== undefined && deviceMemoryGb < FOREPATH_MIN_DEVICE_MEMORY_GB) {
    return null;
  }

  if (deviceMemoryGb === undefined && hardwareConcurrency < FOREPATH_MIN_HARDWARE_CONCURRENCY) {
    return null;
  }

  if (deviceMemoryGb === undefined || deviceMemoryGb < 6) {
    return FOREPATH_LLM_MEMORY_PROFILE_LITE;
  }

  if (deviceMemoryGb < 8) {
    return FOREPATH_LLM_MEMORY_PROFILE_BALANCED;
  }

  return FOREPATH_LLM_MEMORY_PROFILE_STANDARD;
}
