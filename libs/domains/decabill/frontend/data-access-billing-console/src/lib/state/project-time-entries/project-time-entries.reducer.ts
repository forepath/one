import { createReducer, on } from '@ngrx/store';

import type { ProjectTimeEntryResponse } from '../../types/projects.types';
import { closeProjectTicketDetail } from '../project-tickets/project-tickets.actions';

import {
  clearProjectTicketTimeEntries,
  createProjectTimeEntry,
  createProjectTimeEntryFailure,
  createProjectTimeEntrySuccess,
  deleteProjectTimeEntry,
  deleteProjectTimeEntryFailure,
  deleteProjectTimeEntrySuccess,
  loadProjectTicketTimeEntries,
  loadProjectTicketTimeEntriesBatch,
  loadProjectTicketTimeEntriesFailure,
  loadProjectTicketTimeEntriesSuccess,
  loadProjectTimeEntries,
  loadProjectTimeEntriesBatch,
  loadProjectTimeEntriesFailure,
  loadProjectTimeEntriesSuccess,
  projectBoardTimeEntryRemoved,
  projectBoardTimeEntryUpsert,
  updateProjectTimeEntry,
  updateProjectTimeEntryFailure,
  updateProjectTimeEntrySuccess,
} from './project-time-entries.actions';
import { removeProjectTimeEntry, syncTicketScopeOnUpsert, upsertProjectTimeEntry } from './project-time-entries.utils';

export interface ProjectTicketTimeEntriesScope {
  projectId: string | null;
  ticketId: string | null;
  entries: ProjectTimeEntryResponse[];
  loading: boolean;
  error: string | null;
}

export interface ProjectTimeEntriesState {
  projectId: string | null;
  entries: ProjectTimeEntryResponse[];
  ticketScope: ProjectTicketTimeEntriesScope;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const initialTicketScope: ProjectTicketTimeEntriesScope = {
  projectId: null,
  ticketId: null,
  entries: [],
  loading: false,
  error: null,
};

export const initialProjectTimeEntriesState: ProjectTimeEntriesState = {
  projectId: null,
  entries: [],
  ticketScope: initialTicketScope,
  loading: false,
  saving: false,
  error: null,
};

export const projectTimeEntriesReducer = createReducer(
  initialProjectTimeEntriesState,
  on(loadProjectTimeEntries, (state, { projectId }) => ({
    ...state,
    projectId,
    entries: [],
    loading: true,
    error: null,
  })),
  on(loadProjectTimeEntriesBatch, (state, { accumulatedEntries }) => ({
    ...state,
    entries: accumulatedEntries,
    loading: true,
  })),
  on(loadProjectTimeEntriesSuccess, (state, { entries }) => ({ ...state, entries, loading: false })),
  on(loadProjectTimeEntriesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadProjectTicketTimeEntries, (state, { projectId, ticketId }) => ({
    ...state,
    ticketScope: {
      projectId,
      ticketId,
      entries: [],
      loading: true,
      error: null,
    },
  })),
  on(loadProjectTicketTimeEntriesBatch, (state, { accumulatedEntries }) => ({
    ...state,
    ticketScope: {
      ...state.ticketScope,
      entries: accumulatedEntries,
      loading: true,
    },
  })),
  on(loadProjectTicketTimeEntriesSuccess, (state, { entries }) => ({
    ...state,
    ticketScope: {
      ...state.ticketScope,
      entries,
      loading: false,
    },
  })),
  on(loadProjectTicketTimeEntriesFailure, (state, { error }) => ({
    ...state,
    ticketScope: {
      ...state.ticketScope,
      loading: false,
      error,
    },
  })),
  on(clearProjectTicketTimeEntries, closeProjectTicketDetail, (state) => ({
    ...state,
    ticketScope: initialTicketScope,
  })),
  on(createProjectTimeEntry, updateProjectTimeEntry, deleteProjectTimeEntry, (state) => ({
    ...state,
    saving: true,
    error: null,
    ticketScope: state.ticketScope.error ? { ...state.ticketScope, error: null } : state.ticketScope,
  })),
  on(createProjectTimeEntrySuccess, (state, { entry }) => ({
    ...state,
    saving: false,
    entries: [entry, ...state.entries],
    ticketScope:
      state.ticketScope.ticketId === entry.ticketId && state.ticketScope.projectId === entry.projectId
        ? { ...state.ticketScope, entries: upsertProjectTimeEntry(state.ticketScope.entries, entry) }
        : state.ticketScope,
  })),
  on(updateProjectTimeEntrySuccess, (state, { entry }) => ({
    ...state,
    saving: false,
    entries: state.entries.map((e) => (e.id === entry.id ? entry : e)),
    ticketScope: syncTicketScopeOnUpsert(state.ticketScope, entry),
  })),
  on(deleteProjectTimeEntrySuccess, (state, { id, projectId }) => ({
    ...state,
    saving: false,
    entries: state.entries.filter((e) => !(e.id === id && e.projectId === projectId)),
    ticketScope:
      state.ticketScope.projectId === projectId
        ? { ...state.ticketScope, entries: removeProjectTimeEntry(state.ticketScope.entries, id) }
        : state.ticketScope,
  })),
  on(
    createProjectTimeEntryFailure,
    updateProjectTimeEntryFailure,
    deleteProjectTimeEntryFailure,
    (state, { error }) => ({ ...state, saving: false, error }),
  ),
  on(projectBoardTimeEntryUpsert, (state, { entry }) => {
    const idx = state.entries.findIndex((e) => e.id === entry.id);

    return {
      ...state,
      entries: idx < 0 ? [entry, ...state.entries] : state.entries.map((e) => (e.id === entry.id ? entry : e)),
      ticketScope: syncTicketScopeOnUpsert(state.ticketScope, entry),
    };
  }),
  on(projectBoardTimeEntryRemoved, (state, { id, projectId }) => ({
    ...state,
    entries: state.entries.filter((e) => !(e.id === id && e.projectId === projectId)),
    ticketScope:
      state.ticketScope.projectId === projectId
        ? { ...state.ticketScope, entries: removeProjectTimeEntry(state.ticketScope.entries, id) }
        : state.ticketScope,
  })),
);
