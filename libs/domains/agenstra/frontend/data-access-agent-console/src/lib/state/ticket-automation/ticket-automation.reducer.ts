import { createReducer, on } from '@ngrx/store';

import {
  approveTicketAutomation,
  approveTicketAutomationFailure,
  approveTicketAutomationSuccess,
  cancelTicketAutomationRun,
  cancelTicketAutomationRunFailure,
  cancelTicketAutomationRunSuccess,
  clearTicketAutomation,
  clearTicketAutomationError,
  ticketBoardAutomationRunStepAppended,
  ticketBoardAutomationRunUpsert,
  ticketBoardAutomationUpsert,
  loadTicketAutomation,
  loadTicketAutomationFailure,
  loadTicketAutomationRunDetail,
  loadTicketAutomationRunDetailFailure,
  loadTicketAutomationRunDetailSuccess,
  loadTicketAutomationRuns,
  loadTicketAutomationRunsFailure,
  loadTicketAutomationRunsSuccess,
  loadTicketAutomationSuccess,
  patchTicketAutomation,
  patchTicketAutomationFailure,
  patchTicketAutomationSuccess,
  unapproveTicketAutomation,
  unapproveTicketAutomationFailure,
  unapproveTicketAutomationSuccess,
} from './ticket-automation.actions';
import type { TicketAutomationResponseDto, TicketAutomationRunResponseDto } from './ticket-automation.types';

export interface TicketAutomationState {
  activeTicketId: string | null;
  config: TicketAutomationResponseDto | null;
  runs: TicketAutomationRunResponseDto[];
  runDetail: TicketAutomationRunResponseDto | null;
  /** Latest known run payloads (board socket + clients chat); used to hydrate chat automation cards live. */
  runCacheByRunId: Record<string, TicketAutomationRunResponseDto>;
  loadingConfig: boolean;
  loadingRuns: boolean;
  loadingRunDetail: boolean;
  saving: boolean;
  error: string | null;
}

export const initialTicketAutomationState: TicketAutomationState = {
  activeTicketId: null,
  config: null,
  runs: [],
  runDetail: null,
  runCacheByRunId: {},
  loadingConfig: false,
  loadingRuns: false,
  loadingRunDetail: false,
  saving: false,
  error: null,
};

function mergeRunInList(
  runs: TicketAutomationRunResponseDto[],
  run: TicketAutomationRunResponseDto,
): TicketAutomationRunResponseDto[] {
  const idx = runs.findIndex((r) => r.id === run.id);

  if (idx < 0) {
    return [...runs, run];
  }

  const next = [...runs];

  next[idx] = run;

  return next;
}

function mergeIntoRunCache(
  cache: Record<string, TicketAutomationRunResponseDto>,
  incoming: TicketAutomationRunResponseDto,
): Record<string, TicketAutomationRunResponseDto> {
  const prev = cache[incoming.id];

  if (!prev) {
    return { ...cache, [incoming.id]: incoming };
  }

  const prevT = Date.parse(prev.updatedAt);
  const nextT = Date.parse(incoming.updatedAt);

  if (!Number.isNaN(prevT) && !Number.isNaN(nextT) && nextT < prevT) {
    return cache;
  }

  const merged: TicketAutomationRunResponseDto = {
    ...prev,
    ...incoming,
    steps: incoming.steps ?? prev.steps,
    ticketStatusBefore:
      incoming.ticketStatusBefore && incoming.ticketStatusBefore.length > 0
        ? incoming.ticketStatusBefore
        : prev.ticketStatusBefore,
  };

  return { ...cache, [incoming.id]: merged };
}

function foldRunsIntoRunCache(
  cache: Record<string, TicketAutomationRunResponseDto>,
  runs: TicketAutomationRunResponseDto[],
): Record<string, TicketAutomationRunResponseDto> {
  return runs.reduce((acc, run) => mergeIntoRunCache(acc, run), cache);
}

export const ticketAutomationReducer = createReducer(
  initialTicketAutomationState,
  on(loadTicketAutomation, (state, { ticketId }) => ({
    ...state,
    activeTicketId: ticketId,
    loadingConfig: true,
    error: null,
    ...(state.activeTicketId !== ticketId ? { runs: [], runDetail: null, config: null } : {}),
  })),
  on(loadTicketAutomationSuccess, (state, { config }) => ({
    ...state,
    loadingConfig: false,
    config,
    error: null,
  })),
  on(loadTicketAutomationFailure, (state, { error }) => ({
    ...state,
    loadingConfig: false,
    error,
  })),
  on(patchTicketAutomation, approveTicketAutomation, unapproveTicketAutomation, cancelTicketAutomationRun, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(
    patchTicketAutomationSuccess,
    approveTicketAutomationSuccess,
    unapproveTicketAutomationSuccess,
    (state, { config }) => ({
      ...state,
      saving: false,
      config,
      error: null,
    }),
  ),
  on(
    patchTicketAutomationFailure,
    approveTicketAutomationFailure,
    unapproveTicketAutomationFailure,
    cancelTicketAutomationRunFailure,
    (state, { error }) => ({
      ...state,
      saving: false,
      error,
    }),
  ),
  on(loadTicketAutomationRuns, (state) => ({
    ...state,
    loadingRuns: true,
    error: null,
  })),
  on(loadTicketAutomationRunsSuccess, (state, { runs }) => ({
    ...state,
    loadingRuns: false,
    runs,
    runCacheByRunId: foldRunsIntoRunCache(state.runCacheByRunId, runs),
    error: null,
  })),
  on(loadTicketAutomationRunsFailure, (state, { error }) => ({
    ...state,
    loadingRuns: false,
    error,
  })),
  on(loadTicketAutomationRunDetail, (state) => ({
    ...state,
    loadingRunDetail: true,
    error: null,
  })),
  on(loadTicketAutomationRunDetailSuccess, (state, { run }) => ({
    ...state,
    loadingRunDetail: false,
    runDetail: run,
    runs: mergeRunInList(state.runs, run),
    runCacheByRunId: mergeIntoRunCache(state.runCacheByRunId, run),
    error: null,
  })),
  on(loadTicketAutomationRunDetailFailure, (state, { error }) => ({
    ...state,
    loadingRunDetail: false,
    error,
  })),
  on(cancelTicketAutomationRunSuccess, (state, { run }) => ({
    ...state,
    saving: false,
    runs: mergeRunInList(state.runs, run),
    runDetail: state.runDetail?.id === run.id ? run : state.runDetail,
    runCacheByRunId: mergeIntoRunCache(state.runCacheByRunId, run),
    error: null,
  })),
  on(clearTicketAutomationError, (state) => ({ ...state, error: null })),
  on(clearTicketAutomation, () => ({ ...initialTicketAutomationState })),
  on(ticketBoardAutomationUpsert, (state, { config }) => {
    if (state.activeTicketId !== config.ticketId) {
      return state;
    }

    return { ...state, config, error: null };
  }),
  on(ticketBoardAutomationRunUpsert, (state, { run }) => {
    const runCacheByRunId = mergeIntoRunCache(state.runCacheByRunId, run);

    if (state.activeTicketId !== run.ticketId) {
      return { ...state, runCacheByRunId };
    }

    const runs = mergeRunInList(state.runs, run);
    const runDetail =
      state.runDetail?.id === run.id
        ? {
            ...state.runDetail,
            ...run,
            steps: run.steps ?? state.runDetail.steps,
          }
        : state.runDetail;

    return { ...state, runCacheByRunId, runs, runDetail, error: null };
  }),
  on(ticketBoardAutomationRunStepAppended, (state, { runId, step }) => {
    if (state.runDetail?.id !== runId) {
      return state;
    }

    const prev = state.runDetail.steps ?? [];

    if (prev.some((s) => s.id === step.id)) {
      return state;
    }

    const nextSteps = [...prev, step].sort((a, b) => a.stepIndex - b.stepIndex);
    const updatedRun: TicketAutomationRunResponseDto = { ...state.runDetail, steps: nextSteps };

    return {
      ...state,
      runDetail: updatedRun,
      runs: mergeRunInList(state.runs, updatedRun),
      runCacheByRunId: mergeIntoRunCache(state.runCacheByRunId, updatedRun),
    };
  }),
);
