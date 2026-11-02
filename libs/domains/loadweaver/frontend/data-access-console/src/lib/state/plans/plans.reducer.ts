import { createReducer, on } from '@ngrx/store';

import type { Plan, PlanListQuery } from '../../types/plans.types';
import {
  applyPlan,
  approvePlan,
  cancelPlan,
  clearPlanActionError,
  discardPlan,
  disconnectPlansLive,
  loadPlan,
  loadPlanFailure,
  loadPlans,
  loadPlansFailure,
  loadPlansSuccess,
  loadPlanSuccess,
  planActionFailure,
  planActionSuccess,
  planPatched,
  plansLiveConnected,
  plansSnapshotReceived,
  type PlanAction,
} from './plans.actions';

export interface ConsolePlansState {
  plans: Plan[];
  /** The server filters of the list. */
  query: PlanListQuery;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: Plan | null;
  selectedLoading: boolean;
  selectedError: string | null;
  /** The plan action in flight. */
  acting: PlanAction | null;
  actionError: string | null;
  live: boolean;
}

export const initialConsolePlansState: ConsolePlansState = {
  plans: [],
  query: {},
  loading: false,
  error: null,
  selectedId: null,
  selected: null,
  selectedLoading: false,
  selectedError: null,
  acting: null,
  actionError: null,
  live: false,
};

/**
 * A plan from the socket or an action into the list (newest first). Socket plans carry no approvals, so the ones
 * read over REST are kept.
 */
function upsert(plans: Plan[], plan: Plan): Plan[] {
  const index = plans.findIndex((p) => p.id === plan.id);

  if (index < 0) return [plan, ...plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return plans.map((p, i) => (i === index ? merge(p, plan) : p));
}

function merge(previous: Plan | null, next: Plan): Plan {
  return previous && previous.id === next.id && next.approvals.length === 0 && previous.approvals.length > 0
    ? { ...next, approvals: previous.approvals }
    : next;
}

function withPlan(state: ConsolePlansState, plan: Plan, fromSocket: boolean): ConsolePlansState {
  return {
    ...state,
    plans: upsert(state.plans, plan),
    selected: state.selectedId === plan.id ? (fromSocket ? merge(state.selected, plan) : plan) : state.selected,
  };
}

function sameQuery(a: PlanListQuery, b: PlanListQuery): boolean {
  return (a.status ?? null) === (b.status ?? null) && (a.project ?? null) === (b.project ?? null);
}

export const consolePlansReducer = createReducer(
  initialConsolePlansState,
  on(loadPlans, (state, { query, silent }) => ({
    ...state,
    plans: sameQuery(query, state.query) ? state.plans : [],
    query,
    loading: !silent,
    error: null,
  })),
  on(loadPlansSuccess, (state, { plans }) => ({ ...state, plans, loading: false })),
  on(loadPlansFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadPlan, (state, { id, silent }) => ({
    ...state,
    selectedId: id,
    selected: state.selected?.id === id ? state.selected : null,
    selectedLoading: !silent,
    selectedError: null,
    actionError: state.selectedId === id ? state.actionError : null,
  })),
  on(loadPlanSuccess, (state, { plan }) =>
    state.selectedId === plan.id
      ? { ...withPlan(state, plan, false), selectedLoading: false }
      : { ...state, plans: upsert(state.plans, plan) },
  ),
  on(loadPlanFailure, (state, { id, error }) =>
    state.selectedId === id ? { ...state, selectedLoading: false, selectedError: error } : state,
  ),
  on(approvePlan, (state) => ({ ...state, acting: 'approve' as const, actionError: null })),
  on(applyPlan, (state) => ({ ...state, acting: 'apply' as const, actionError: null })),
  on(cancelPlan, (state) => ({ ...state, acting: 'cancel' as const, actionError: null })),
  on(discardPlan, (state) => ({ ...state, acting: 'discard' as const, actionError: null })),
  on(planActionSuccess, (state, { plan }) => ({ ...withPlan(state, plan, false), acting: null })),
  on(planActionFailure, (state, { error }) => ({ ...state, acting: null, actionError: error })),
  on(clearPlanActionError, (state) => ({ ...state, actionError: null })),
  on(plansLiveConnected, (state, { connected }) => ({ ...state, live: connected })),
  on(disconnectPlansLive, (state) => ({ ...state, live: false })),
  on(plansSnapshotReceived, (state, { plans }) => plans.reduce((s, plan) => withPlan(s, plan, true), state)),
  on(planPatched, (state, { plan }) => withPlan(state, plan, true)),
);
