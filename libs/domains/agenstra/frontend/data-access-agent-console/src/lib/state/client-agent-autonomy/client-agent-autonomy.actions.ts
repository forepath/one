import { createAction, props } from '@ngrx/store';

import type { ClientAgentAutonomyResponseDto, UpsertClientAgentAutonomyDto } from './client-agent-autonomy.types';

export const loadClientAgentAutonomy = createAction(
  '[Client Agent Autonomy] Load',
  props<{ clientId: string; agentId: string }>(),
);

export const loadClientAgentAutonomySuccess = createAction(
  '[Client Agent Autonomy] Load Success',
  props<{ autonomy: ClientAgentAutonomyResponseDto }>(),
);

export const loadClientAgentAutonomyFailure = createAction(
  '[Client Agent Autonomy] Load Failure',
  props<{ error: string }>(),
);

export const upsertClientAgentAutonomy = createAction(
  '[Client Agent Autonomy] Upsert',
  props<{ clientId: string; agentId: string; dto: UpsertClientAgentAutonomyDto }>(),
);

export const upsertClientAgentAutonomySuccess = createAction(
  '[Client Agent Autonomy] Upsert Success',
  props<{ autonomy: ClientAgentAutonomyResponseDto }>(),
);

export const upsertClientAgentAutonomyFailure = createAction(
  '[Client Agent Autonomy] Upsert Failure',
  props<{ error: string }>(),
);

export const clearClientAgentAutonomyError = createAction('[Client Agent Autonomy] Clear Error');

export const clearClientAgentAutonomy = createAction('[Client Agent Autonomy] Clear State');
