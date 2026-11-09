import { createReducer, on } from '@ngrx/store';

import {
  clearInitiativeError,
  initiativeActivityLiveCreated,
  initiativeArtifactLiveRemoved,
  initiativeArtifactLiveUpsert,
  initiativeDecisionLiveUpsert,
  initiativeFindingLiveUpsert,
  initiativeLiveRemoved,
  initiativeLiveUpsert,
  initiativeProposalLiveUpsert,
  initiativeRunLiveUpsert,
  initiativeRunTurnLiveAppended,
  initiativeWorkItemsLiveChanged,
  loadInitiativeArtifactVersionSuccess,
  loadInitiativeDetailFailure,
  loadInitiativeDetailSuccess,
  loadInitiatives,
  loadInitiativesFailure,
  loadInitiativesSuccess,
  openInitiativeArtifact,
  openInitiativeArtifactSuccess,
  openInitiativeRun,
  openInitiativeRunSuccess,
  reloadInitiative,
  reloadInitiativeOverviewSuccess,
  runInitiativeCommand,
  runInitiativeCommandFailure,
  runInitiativeCommandSuccess,
  selectInitiative,
} from './initiatives.actions';
import type {
  InitiativeActivityDto,
  InitiativeArtifactDto,
  InitiativeArtifactVersionDto,
  InitiativeBuildActionDto,
  InitiativeCommand,
  InitiativeDecisionDto,
  InitiativeDto,
  InitiativeFindingDto,
  InitiativeOverviewDto,
  InitiativeProposalDto,
  InitiativeRunDto,
  InitiativeWorkItemDto,
  InitiativeWorkItemsDto,
} from './initiatives.types';

export interface InitiativesState {
  clientId: string | null;
  list: InitiativeDto[];
  total: number;
  listLoading: boolean;
  selectedId: string | null;
  detailLoading: boolean;
  overview: InitiativeOverviewDto | null;
  artifacts: InitiativeArtifactDto[];
  openArtifactId: string | null;
  /** Open document incl. content (refetched when another user saved a new version). */
  openArtifact: InitiativeArtifactDto | null;
  versions: InitiativeArtifactVersionDto[];
  compareVersion: InitiativeArtifactVersionDto | null;
  workItems: InitiativeWorkItemsDto | null;
  runs: InitiativeRunDto[];
  openRunId: string | null;
  openRun: InitiativeRunDto | null;
  proposals: InitiativeProposalDto[];
  findings: InitiativeFindingDto[];
  decisions: InitiativeDecisionDto[];
  activity: InitiativeActivityDto[];
  /** Commands in flight. */
  pending: number;
  /** Outcome of the last transfer / release / plan (skipped items are reported). */
  lastBuildResult: InitiativeBuildActionDto | null;
  lastCommand: InitiativeCommand['type'] | null;
  /** Initiative created by this user (the page opens it). */
  createdId: string | null;
  error: string | null;
  /** The last command was refused because something changed meanwhile (409). */
  conflict: boolean;
}

export const initialInitiativesState: InitiativesState = {
  clientId: null,
  list: [],
  total: 0,
  listLoading: false,
  selectedId: null,
  detailLoading: false,
  overview: null,
  artifacts: [],
  openArtifactId: null,
  openArtifact: null,
  versions: [],
  compareVersion: null,
  workItems: null,
  runs: [],
  openRunId: null,
  openRun: null,
  proposals: [],
  findings: [],
  decisions: [],
  activity: [],
  pending: 0,
  lastBuildResult: null,
  lastCommand: null,
  createdId: null,
  error: null,
  conflict: false,
};

const ACTIVITY_MAX = 200;

/** Insert or replace by id; newest first when `prepend`. */
function upsert<T extends { id: string }>(rows: T[], row: T, prepend = true): T[] {
  const index = rows.findIndex((existing) => existing.id === row.id);

  if (index >= 0) {
    const next = [...rows];

    next[index] = { ...rows[index], ...row };

    return next;
  }

  return prepend ? [row, ...rows] : [...rows, row];
}

/** Live and REST payloads can arrive out of order: never replace a row with an older version. */
function newer<T extends { version: number }>(current: T | null | undefined, next: T): boolean {
  return !current || next.version >= current.version;
}

function applyInitiative(state: InitiativesState, initiative: InitiativeDto): InitiativesState {
  if (state.clientId && initiative.clientId !== state.clientId) {
    return state;
  }

  const existing = state.list.find((row) => row.id === initiative.id);

  if (existing && !newer(existing, initiative)) {
    return state;
  }

  const list = upsert(state.list, initiative).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    ...state,
    list,
    total: existing ? state.total : state.total + 1,
    overview:
      state.overview && state.overview.initiative.id === initiative.id && newer(state.overview.initiative, initiative)
        ? { ...state.overview, initiative }
        : state.overview,
  };
}

function applyArtifact(state: InitiativesState, artifact: InitiativeArtifactDto): InitiativesState {
  if (artifact.initiativeId !== state.selectedId) {
    return state;
  }

  const existing = state.artifacts.find((row) => row.id === artifact.id);

  if (existing && !newer(existing, artifact)) {
    return state;
  }

  const { content: _content, ...metadata } = artifact;
  const openArtifact =
    state.openArtifact?.id === artifact.id && artifact.content !== undefined && newer(state.openArtifact, artifact)
      ? artifact
      : state.openArtifact;

  return { ...state, artifacts: upsert(state.artifacts, metadata, false), openArtifact };
}

function mergeWorkItems(current: InitiativeWorkItemsDto, changed: InitiativeWorkItemDto[]): InitiativeWorkItemsDto {
  if (changed.length === 0) {
    return current;
  }

  const byId = new Map(changed.map((item) => [item.id, item]));

  return {
    ...current,
    items: current.items.map((item) => {
      const next = byId.get(item.id);

      return next && next.version >= item.version ? next : item;
    }),
  };
}

function applyWorkItems(
  state: InitiativesState,
  initiativeId: string,
  workItems: InitiativeWorkItemsDto,
): InitiativesState {
  if (!initiativeId || initiativeId !== state.selectedId) {
    return state;
  }

  if (state.workItems && workItems.initiativeVersion < state.workItems.initiativeVersion) {
    return state;
  }

  return { ...state, workItems };
}

function applyRun(state: InitiativesState, run: InitiativeRunDto): InitiativesState {
  if (run.initiativeId !== state.selectedId) {
    return state;
  }

  const existing = state.runs.find((row) => row.id === run.id);

  if (existing && !newer(existing, run)) {
    return state;
  }

  const { turns, ...metadata } = run;
  const openRun =
    state.openRun?.id === run.id && newer(state.openRun, run)
      ? { ...state.openRun, ...metadata, turns: turns ?? state.openRun.turns }
      : state.openRun;

  return { ...state, runs: upsert(state.runs, metadata), openRun };
}

function forSelected<T extends { initiativeId: string; id: string }>(
  state: InitiativesState,
  key: 'proposals' | 'findings' | 'decisions',
  row: T,
): InitiativesState {
  if (row.initiativeId !== state.selectedId) {
    return state;
  }

  return { ...state, [key]: upsert(state[key] as unknown as T[], row) };
}

export const initiativesReducer = createReducer(
  initialInitiativesState,
  on(loadInitiatives, (state, { clientId }) => ({
    ...state,
    clientId,
    listLoading: true,
    ...(state.clientId !== clientId ? { list: [], total: 0 } : {}),
  })),
  on(loadInitiativesSuccess, (state, { clientId, items, total }) =>
    state.clientId === clientId ? { ...state, list: items, total, listLoading: false } : state,
  ),
  on(loadInitiativesFailure, (state, { error }) => ({ ...state, listLoading: false, error })),
  on(selectInitiative, (state, { id }) =>
    id === state.selectedId
      ? state
      : {
          ...state,
          selectedId: id,
          detailLoading: !!id,
          overview: null,
          artifacts: [],
          openArtifactId: null,
          openArtifact: null,
          versions: [],
          compareVersion: null,
          workItems: null,
          runs: [],
          openRunId: null,
          openRun: null,
          proposals: [],
          findings: [],
          decisions: [],
          activity: [],
          lastBuildResult: null,
          error: null,
          conflict: false,
        },
  ),
  on(loadInitiativeDetailSuccess, (state, detail) =>
    detail.id !== state.selectedId
      ? state
      : {
          ...state,
          detailLoading: false,
          overview: detail.overview,
          artifacts: detail.artifacts,
          workItems: detail.workItems,
          runs: detail.runs,
          proposals: detail.proposals,
          findings: detail.findings,
          decisions: detail.decisions,
          activity: detail.activity,
        },
  ),
  on(loadInitiativeDetailFailure, (state, { error }) => ({ ...state, detailLoading: false, error })),
  on(reloadInitiative, (state, { id }) =>
    id === state.selectedId ? { ...state, error: null, conflict: false } : state,
  ),
  on(reloadInitiativeOverviewSuccess, (state, { overview }) =>
    overview.initiative.id === state.selectedId ? { ...state, overview } : state,
  ),
  on(openInitiativeArtifact, (state, { artifactId }) => ({
    ...state,
    openArtifactId: artifactId,
    openArtifact: artifactId && state.openArtifact?.id === artifactId ? state.openArtifact : null,
    versions: artifactId === state.openArtifactId ? state.versions : [],
    compareVersion: null,
  })),
  on(openInitiativeArtifactSuccess, (state, { artifact, versions }) =>
    artifact.id !== state.openArtifactId
      ? state
      : { ...applyArtifact(state, artifact), openArtifact: artifact, versions },
  ),
  on(loadInitiativeArtifactVersionSuccess, (state, { version }) => ({ ...state, compareVersion: version })),
  on(openInitiativeRun, (state, { runId }) => ({
    ...state,
    openRunId: runId,
    openRun: runId && state.openRun?.id === runId ? state.openRun : null,
  })),
  on(openInitiativeRunSuccess, (state, { run }) =>
    run.id !== state.openRunId ? state : { ...applyRun(state, run), openRun: run },
  ),
  on(runInitiativeCommand, (state, { command }) => ({
    ...state,
    pending: state.pending + 1,
    lastCommand: command.type,
    error: null,
    conflict: false,
  })),
  on(runInitiativeCommandSuccess, (state, { command, result }) => {
    const base = {
      ...state,
      pending: Math.max(0, state.pending - 1),
      createdId:
        command.type === 'createInitiative' && result.kind === 'initiative' ? result.initiative.id : state.createdId,
    };

    switch (result.kind) {
      case 'initiative':
        return applyInitiative(base, result.initiative);
      case 'initiativeRemoved':
        return {
          ...base,
          list: base.list.filter((row) => row.id !== result.id),
          total: Math.max(0, base.total - 1),
          ...(base.selectedId === result.id ? { selectedId: null, overview: null } : {}),
        };
      case 'artifact':
        return applyArtifact(base, result.artifact);
      case 'artifactRemoved':
        return {
          ...base,
          artifacts: base.artifacts.filter((row) => row.id !== result.id),
          ...(base.openArtifactId === result.id ? { openArtifactId: null, openArtifact: null } : {}),
        };
      case 'workItems':
        return applyWorkItems(base, result.initiativeId, result.workItems);
      case 'build':
        return {
          ...base,
          lastBuildResult: result.result,
          // Per item and only when not older: a live tree that arrived meanwhile must not be rolled back.
          workItems: base.workItems ? mergeWorkItems(base.workItems, result.result.workItems) : base.workItems,
        };
      case 'run':
        return {
          ...applyRun(base, result.run),
          ...(result.run.turns ? { openRunId: result.run.id, openRun: result.run } : {}),
        };
      case 'proposal':
        return forSelected(base, 'proposals', result.proposal);
      case 'finding':
        return forSelected(base, 'findings', result.finding);
      case 'decision':
        return forSelected(base, 'decisions', result.decision);
      default:
        return base;
    }
  }),
  on(runInitiativeCommandFailure, (state, { error, conflict }) => ({
    ...state,
    pending: Math.max(0, state.pending - 1),
    error,
    conflict,
  })),
  on(clearInitiativeError, (state) => ({ ...state, error: null, conflict: false })),
  on(initiativeLiveUpsert, (state, { initiative }) => applyInitiative(state, initiative)),
  on(initiativeLiveRemoved, (state, { id }) => ({
    ...state,
    list: state.list.filter((row) => row.id !== id),
    ...(state.selectedId === id ? { selectedId: null, overview: null } : {}),
  })),
  on(initiativeArtifactLiveUpsert, (state, { artifact }) => applyArtifact(state, artifact)),
  on(initiativeArtifactLiveRemoved, (state, { id }) => ({
    ...state,
    artifacts: state.artifacts.filter((row) => row.id !== id),
    ...(state.openArtifactId === id ? { openArtifactId: null, openArtifact: null } : {}),
  })),
  on(initiativeWorkItemsLiveChanged, (state, { initiativeId, workItems }) =>
    applyWorkItems(state, initiativeId, workItems),
  ),
  on(initiativeRunLiveUpsert, (state, { run }) => applyRun(state, run)),
  on(initiativeRunTurnLiveAppended, (state, { initiativeId, turn }) => {
    if (initiativeId !== state.selectedId || state.openRun?.id !== turn.runId) {
      return state;
    }

    const turns = state.openRun.turns ?? [];

    return turns.some((existing) => existing.id === turn.id)
      ? state
      : { ...state, openRun: { ...state.openRun, turns: [...turns, turn].sort((a, b) => a.seq - b.seq) } };
  }),
  on(initiativeProposalLiveUpsert, (state, { proposal }) => forSelected(state, 'proposals', proposal)),
  on(initiativeFindingLiveUpsert, (state, { finding }) => forSelected(state, 'findings', finding)),
  on(initiativeDecisionLiveUpsert, (state, { decision }) => forSelected(state, 'decisions', decision)),
  on(initiativeActivityLiveCreated, (state, { activity }) =>
    activity.initiativeId !== state.selectedId || state.activity.some((row) => row.id === activity.id)
      ? state
      : { ...state, activity: [activity, ...state.activity].slice(0, ACTIVITY_MAX) },
  ),
);
