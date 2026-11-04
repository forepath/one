import { createAction, props } from '@ngrx/store';

import type { ChatPlanResponse } from '../container-socket/container-socket.types';

import type { ChatPlanActivityDto, ChatPlansQuery, UpdateChatPlanDto } from './chat-plans.types';

/** One page of an agent's plans (search / state filter / paging). */
export const loadChatPlans = createAction(
  '[Chat Plans] Load',
  props<{ clientId: string; agentId: string; query: ChatPlansQuery }>(),
);

export const loadChatPlansSuccess = createAction(
  '[Chat Plans] Load Success',
  props<{ clientId: string; agentId: string; plans: ChatPlanResponse[]; total: number }>(),
);

export const loadChatPlansFailure = createAction('[Chat Plans] Load Failure', props<{ error: string }>());

/** Opened plan (deep links open plans that are not on the listed page). */
export const loadChatPlan = createAction(
  '[Chat Plans] Load Plan',
  props<{ clientId: string; agentId: string; planId: string }>(),
);

export const loadChatPlanSuccess = createAction('[Chat Plans] Load Plan Success', props<{ plan: ChatPlanResponse }>());

export const loadChatPlanFailure = createAction(
  '[Chat Plans] Load Plan Failure',
  props<{ planId: string; error: string }>(),
);

export const clearSelectedChatPlan = createAction('[Chat Plans] Clear Selected Plan');

export const updateChatPlan = createAction(
  '[Chat Plans] Update',
  props<{ clientId: string; agentId: string; planId: string; dto: UpdateChatPlanDto }>(),
);

export const updateChatPlanSuccess = createAction('[Chat Plans] Update Success', props<{ plan: ChatPlanResponse }>());

export const updateChatPlanFailure = createAction(
  '[Chat Plans] Update Failure',
  props<{ error: string; conflict: boolean }>(),
);

export const loadChatPlanActivity = createAction(
  '[Chat Plans] Load Activity',
  props<{ clientId: string; agentId: string; planId: string }>(),
);

export const loadChatPlanActivitySuccess = createAction(
  '[Chat Plans] Load Activity Success',
  props<{ planId: string; activity: ChatPlanActivityDto[] }>(),
);

export const loadChatPlanActivityFailure = createAction(
  '[Chat Plans] Load Activity Failure',
  props<{ planId: string; error: string }>(),
);

/** Live plan snapshot from `chatPlanUpsert` (clients socket). */
export const chatPlanUpsertReceived = createAction('[Chat Plans] Upsert Received', props<{ plan: ChatPlanResponse }>());

export const clearChatPlansError = createAction('[Chat Plans] Clear Error');
