import { createActionGroup, emptyProps, props } from '@ngrx/store';

import type { ChatMessage, ProjectEstimate } from '../../types/project-estimator.types';
import type { ForepathLlmMemoryProfileId } from '../../constants/forepath-llm-memory.constants';

import type { ProjectEstimatorDebugPreset } from './project-estimator.debug';

export const ProjectEstimatorActions = createActionGroup({
  source: 'Project Estimator',
  events: {
    'Initialize Estimator': emptyProps(),
    'Gpu Access Required': emptyProps(),
    'Request Gpu Access': emptyProps(),
    'Check Device Capability': emptyProps(),
    'Check Device Capability Success': props<{
      supported: boolean;
      reason: string | null;
      deviceMaxMemoryProfileId?: ForepathLlmMemoryProfileId | null;
      activeMemoryProfileId?: ForepathLlmMemoryProfileId | null;
    }>(),
    'Preload Model': emptyProps(),
    'Preload Model Progress': props<{ progress: number; text: string }>(),
    'Preload Model Success': props<{ activeMemoryProfileId: ForepathLlmMemoryProfileId }>(),
    'Preload Model Failure': props<{ error: string }>(),
    'Change Memory Profile': props<{ profileId: ForepathLlmMemoryProfileId }>(),
    'Submit Project Description': props<{ description: string }>(),
    'Estimate Project Success': props<{
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
      estimate: ProjectEstimate;
    }>(),
    'Estimate Project Failure': props<{ error: string }>(),
    'Clear Estimate Error': emptyProps(),
    'Start Over': emptyProps(),
    'Set Debug State': props<{ preset: ProjectEstimatorDebugPreset }>(),
  },
});
