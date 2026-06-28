import { createReducer, on } from '@ngrx/store';

import type { ProjectTimeEntryResponse } from '../../types/projects.types';

import {
  createProjectTimeEntry,
  createProjectTimeEntryFailure,
  createProjectTimeEntrySuccess,
  deleteProjectTimeEntry,
  deleteProjectTimeEntryFailure,
  deleteProjectTimeEntrySuccess,
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

export interface ProjectTimeEntriesState {
  projectId: string | null;
  entries: ProjectTimeEntryResponse[];
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export const initialProjectTimeEntriesState: ProjectTimeEntriesState = {
  projectId: null,
  entries: [],
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
  on(createProjectTimeEntry, updateProjectTimeEntry, deleteProjectTimeEntry, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(createProjectTimeEntrySuccess, (state, { entry }) => ({
    ...state,
    saving: false,
    entries: [entry, ...state.entries],
  })),
  on(updateProjectTimeEntrySuccess, (state, { entry }) => ({
    ...state,
    saving: false,
    entries: state.entries.map((e) => (e.id === entry.id ? entry : e)),
  })),
  on(deleteProjectTimeEntrySuccess, (state, { id }) => ({
    ...state,
    saving: false,
    entries: state.entries.filter((e) => e.id !== id),
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
    };
  }),
  on(projectBoardTimeEntryRemoved, (state, { id, projectId }) => ({
    ...state,
    entries: state.entries.filter((e) => !(e.id === id && e.projectId === projectId)),
  })),
);
