import { createAction, props } from '@ngrx/store';

import type {
  AgentTaskRemovedEvent,
  AgentTaskResponseDto,
  AgentTaskRunResponseDto,
  CreateAgentTaskDto,
  UpdateAgentTaskDto,
} from './agent-tasks.types';

export const loadAgentTasks = createAction('[Agent Tasks] Load', props<{ clientId: string }>());

export const loadAgentTasksSuccess = createAction(
  '[Agent Tasks] Load Success',
  props<{ clientId: string; tasks: AgentTaskResponseDto[] }>(),
);

export const loadAgentTasksFailure = createAction('[Agent Tasks] Load Failure', props<{ error: string }>());

export const createAgentTask = createAction(
  '[Agent Tasks] Create',
  props<{ clientId: string; agentId: string; dto: CreateAgentTaskDto }>(),
);

export const createAgentTaskSuccess = createAction(
  '[Agent Tasks] Create Success',
  props<{ task: AgentTaskResponseDto }>(),
);

export const createAgentTaskFailure = createAction('[Agent Tasks] Create Failure', props<{ error: string }>());

export const updateAgentTask = createAction(
  '[Agent Tasks] Update',
  props<{ clientId: string; agentId: string; taskId: string; dto: UpdateAgentTaskDto }>(),
);

export const updateAgentTaskSuccess = createAction(
  '[Agent Tasks] Update Success',
  props<{ task: AgentTaskResponseDto }>(),
);

export const updateAgentTaskFailure = createAction('[Agent Tasks] Update Failure', props<{ error: string }>());

export const deleteAgentTask = createAction(
  '[Agent Tasks] Delete',
  props<{ clientId: string; agentId: string; taskId: string }>(),
);

export const deleteAgentTaskSuccess = createAction('[Agent Tasks] Delete Success', props<{ taskId: string }>());

export const deleteAgentTaskFailure = createAction('[Agent Tasks] Delete Failure', props<{ error: string }>());

export const runAgentTaskNow = createAction(
  '[Agent Tasks] Run Now',
  props<{ clientId: string; agentId: string; taskId: string }>(),
);

export const runAgentTaskNowSuccess = createAction(
  '[Agent Tasks] Run Now Success',
  props<{ taskId: string; queued: boolean }>(),
);

export const runAgentTaskNowFailure = createAction(
  '[Agent Tasks] Run Now Failure',
  props<{ taskId: string; error: string }>(),
);

/**
 * First page of a task's session history. `refresh` re-reads the newest page and merges it into the pages that are
 * already loaded (live progress) instead of resetting the infinite scroll.
 */
export const loadAgentTaskRuns = createAction(
  '[Agent Tasks] Load Runs',
  props<{ clientId: string; agentId: string; taskId: string; refresh?: boolean }>(),
);

export const loadAgentTaskRunsSuccess = createAction(
  '[Agent Tasks] Load Runs Success',
  props<{ taskId: string; runs: AgentTaskRunResponseDto[]; hasMore: boolean; refresh?: boolean }>(),
);

export const loadAgentTaskRunsFailure = createAction('[Agent Tasks] Load Runs Failure', props<{ error: string }>());

/** Next page of the session history (infinite scroll). */
export const loadMoreAgentTaskRuns = createAction(
  '[Agent Tasks] Load More Runs',
  props<{ clientId: string; agentId: string; taskId: string }>(),
);

export const loadMoreAgentTaskRunsSuccess = createAction(
  '[Agent Tasks] Load More Runs Success',
  props<{ taskId: string; runs: AgentTaskRunResponseDto[]; hasMore: boolean }>(),
);

export const loadMoreAgentTaskRunsFailure = createAction(
  '[Agent Tasks] Load More Runs Failure',
  props<{ taskId: string; error: string }>(),
);

/** Live `agentTaskUpsert` (task created / changed by a user, the agent or a run). */
export const agentTaskUpsertReceived = createAction(
  '[Agent Tasks] Upsert Received',
  props<{ task: AgentTaskResponseDto }>(),
);

export const agentTaskRemovedReceived = createAction(
  '[Agent Tasks] Removed Received',
  props<{ event: AgentTaskRemovedEvent }>(),
);

/** Run snapshot from `agentTaskRunChatUpsert`. */
export const agentTaskRunReceived = createAction(
  '[Agent Tasks] Run Received',
  props<{ run: AgentTaskRunResponseDto }>(),
);

export const clearAgentTasksError = createAction('[Agent Tasks] Clear Error');
