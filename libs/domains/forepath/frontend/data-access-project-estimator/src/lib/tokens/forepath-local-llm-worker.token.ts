import { InjectionToken } from '@angular/core';

export type ForepathLocalLlmWorkerFactory = () => Worker;

export const FOREPATH_LOCAL_LLM_WORKER_FACTORY = new InjectionToken<ForepathLocalLlmWorkerFactory>(
  'FOREPATH_LOCAL_LLM_WORKER_FACTORY',
);
