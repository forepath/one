import { createReducer, on } from '@ngrx/store';

import type { ChatPlanResponse } from '../container-socket/container-socket.types';

import {
  chatPlanUpsertReceived,
  clearChatPlansError,
  clearSelectedChatPlan,
  loadChatPlan,
  loadChatPlanActivity,
  loadChatPlanActivityFailure,
  loadChatPlanActivitySuccess,
  loadChatPlanFailure,
  loadChatPlans,
  loadChatPlansFailure,
  loadChatPlansSuccess,
  loadChatPlanSuccess,
  updateChatPlan,
  updateChatPlanFailure,
  updateChatPlanSuccess,
} from './chat-plans.actions';
import type { ChatPlanActivityDto } from './chat-plans.types';

export interface ChatPlansState {
  /** Workspace / agent of the listed page. */
  clientId: string | null;
  agentId: string | null;
  plans: ChatPlanResponse[];
  total: number;
  loading: boolean;
  /** Opened plan (kept separately: it may not be on the listed page). */
  selectedPlan: ChatPlanResponse | null;
  selectedPlanLoading: boolean;
  saving: boolean;
  activityByPlanId: Record<string, ChatPlanActivityDto[]>;
  activityLoadingPlanId: string | null;
  error: string | null;
  /** Last save was refused because the plan changed or became read-only (409). */
  conflict: boolean;
}

export const initialChatPlansState: ChatPlansState = {
  clientId: null,
  agentId: null,
  plans: [],
  total: 0,
  loading: false,
  selectedPlan: null,
  selectedPlanLoading: false,
  saving: false,
  activityByPlanId: {},
  activityLoadingPlanId: null,
  error: null,
  conflict: false,
};

/**
 * Newer snapshot wins: live socket updates and REST responses can arrive out of order, so a snapshot older than the
 * stored one is ignored.
 */
function newer(current: ChatPlanResponse, incoming: ChatPlanResponse): ChatPlanResponse {
  return incoming.updatedAt >= current.updatedAt ? { ...current, ...incoming } : current;
}

function mergePlan(state: ChatPlansState, plan: ChatPlanResponse): ChatPlansState {
  const plans = state.plans.some((existing) => existing.id === plan.id)
    ? state.plans.map((existing) => (existing.id === plan.id ? newer(existing, plan) : existing))
    : state.plans;
  const selectedPlan =
    state.selectedPlan && state.selectedPlan.id === plan.id ? newer(state.selectedPlan, plan) : state.selectedPlan;

  return plans === state.plans && selectedPlan === state.selectedPlan ? state : { ...state, plans, selectedPlan };
}

export const chatPlansReducer = createReducer(
  initialChatPlansState,
  on(loadChatPlans, (state, { clientId, agentId }) => {
    const sameScope = state.clientId === clientId && state.agentId === agentId;

    return {
      ...state,
      clientId,
      agentId,
      // Another workspace / agent: never show the previous agent's plans while loading.
      plans: sameScope ? state.plans : [],
      total: sameScope ? state.total : 0,
      loading: true,
      error: null,
    };
  }),
  on(loadChatPlansSuccess, (state, { clientId, agentId, plans, total }) =>
    state.clientId === clientId && state.agentId === agentId ? { ...state, plans, total, loading: false } : state,
  ),
  on(loadChatPlansFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadChatPlan, (state, { planId }) => ({
    ...state,
    selectedPlan: state.selectedPlan?.id === planId ? state.selectedPlan : null,
    selectedPlanLoading: true,
  })),
  on(loadChatPlanSuccess, (state, { plan }) => ({
    ...mergePlan(state, plan),
    selectedPlan: state.selectedPlan?.id === plan.id ? newer(state.selectedPlan, plan) : plan,
    selectedPlanLoading: false,
  })),
  on(loadChatPlanFailure, (state, { error }) => ({ ...state, selectedPlanLoading: false, error })),
  on(clearSelectedChatPlan, (state) => ({ ...state, selectedPlan: null, selectedPlanLoading: false, conflict: false })),
  on(updateChatPlan, (state) => ({ ...state, saving: true, error: null, conflict: false })),
  on(updateChatPlanSuccess, (state, { plan }) => ({ ...mergePlan(state, plan), saving: false })),
  on(updateChatPlanFailure, (state, { error, conflict }) => ({ ...state, saving: false, error, conflict })),
  on(loadChatPlanActivity, (state, { planId }) => ({ ...state, activityLoadingPlanId: planId })),
  on(loadChatPlanActivitySuccess, (state, { planId, activity }) => ({
    ...state,
    activityByPlanId: { ...state.activityByPlanId, [planId]: activity },
    activityLoadingPlanId: state.activityLoadingPlanId === planId ? null : state.activityLoadingPlanId,
  })),
  on(loadChatPlanActivityFailure, (state, { planId, error }) => ({
    ...state,
    activityLoadingPlanId: state.activityLoadingPlanId === planId ? null : state.activityLoadingPlanId,
    error,
  })),
  on(chatPlanUpsertReceived, (state, { plan }) => mergePlan(state, plan)),
  on(clearChatPlansError, (state) => ({ ...state, error: null, conflict: false })),
);
