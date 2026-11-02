import { createReducer, on } from '@ngrx/store';

import type { LiveFileEntry, LiveFileTarget } from '../../types/live.types';
import {
  dismissFilesMessages,
  fileOperationFailure,
  fileOperationSuccess,
  openFilesDirectory,
  openFilesDirectoryFailure,
  openFilesDirectorySuccess,
  runFileOperation,
  setFilesWarning,
} from './files.actions';

export interface ConsoleFilesState {
  target: LiveFileTarget | null;
  path: string;
  entries: LiveFileEntry[];
  loading: boolean;
  error: string | null;
  /** A create / delete / move / copy is running. */
  busy: boolean;
  operationError: string | null;
  /** The last write's `X-Loadweaver-Warning`. */
  warning: string | null;
}

export const initialConsoleFilesState: ConsoleFilesState = {
  target: null,
  path: '/',
  entries: [],
  loading: false,
  error: null,
  busy: false,
  operationError: null,
  warning: null,
};

/** Folders first, then by name (the API sorts the same way; kept stable here). */
function sortEntries(entries: LiveFileEntry[]): LiveFileEntry[] {
  return [...entries].sort(
    (a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name),
  );
}

export const consoleFilesReducer = createReducer(
  initialConsoleFilesState,
  on(openFilesDirectory, (state, { target, path }) => ({
    ...state,
    target,
    path,
    // Another target starts empty; the same one keeps its listing until the new one arrives.
    entries: target === state.target ? state.entries : [],
    warning: target === state.target ? state.warning : null,
    loading: true,
    error: null,
  })),
  on(openFilesDirectorySuccess, (state, { target, path, entries }) =>
    target === state.target && path === state.path
      ? { ...state, entries: sortEntries(entries), loading: false }
      : state,
  ),
  on(openFilesDirectoryFailure, (state, { target, path, error }) =>
    target === state.target && path === state.path ? { ...state, entries: [], loading: false, error } : state,
  ),
  on(runFileOperation, (state) => ({ ...state, busy: true, operationError: null })),
  on(fileOperationSuccess, (state, { warning }) => ({ ...state, busy: false, warning: warning ?? state.warning })),
  on(fileOperationFailure, (state, { error }) => ({ ...state, busy: false, operationError: error })),
  on(setFilesWarning, (state, { warning }) => ({ ...state, warning: warning ?? state.warning })),
  on(dismissFilesMessages, (state) => ({ ...state, warning: null, operationError: null })),
);
