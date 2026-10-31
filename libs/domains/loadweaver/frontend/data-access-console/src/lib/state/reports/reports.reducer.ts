import { createReducer, on } from '@ngrx/store';

import type { Report, ReportFileEntry, RunReport } from '../../types/reports.types';
import {
  clearReportRunResult,
  loadReports,
  loadReportsFailure,
  loadReportsSuccess,
  openReportFolder,
  openReportFolderFailure,
  openReportFolderSuccess,
  runReport,
  runReportFailure,
  runReportSuccess,
} from './reports.actions';

export interface ConsoleReportsState {
  reports: Report[];
  loading: boolean;
  error: string | null;
  /** A run being requested. */
  running: boolean;
  /** The last queued run. */
  queued: RunReport | null;
  runError: string | null;
  /** The open folder of the file tree. */
  path: string;
  entries: ReportFileEntry[];
  entriesLoading: boolean;
  entriesError: string | null;
}

export const initialConsoleReportsState: ConsoleReportsState = {
  reports: [],
  loading: false,
  error: null,
  running: false,
  queued: null,
  runError: null,
  path: '',
  entries: [],
  entriesLoading: false,
  entriesError: null,
};

export const consoleReportsReducer = createReducer(
  initialConsoleReportsState,
  on(loadReports, (state, { silent }) => ({ ...state, loading: !silent, error: null })),
  on(loadReportsSuccess, (state, { reports }) => ({ ...state, reports, loading: false })),
  on(loadReportsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(runReport, (state) => ({ ...state, running: true, queued: null, runError: null })),
  on(runReportSuccess, (state, { report }) => ({ ...state, running: false, queued: report })),
  on(runReportFailure, (state, { error }) => ({ ...state, running: false, runError: error })),
  on(clearReportRunResult, (state) => ({ ...state, queued: null, runError: null })),
  on(openReportFolder, (state, { path }) => ({
    ...state,
    path,
    entries: path === state.path ? state.entries : [],
    entriesLoading: true,
    entriesError: null,
  })),
  on(openReportFolderSuccess, (state, { path, entries }) =>
    path === state.path ? { ...state, entries, entriesLoading: false } : state,
  ),
  on(openReportFolderFailure, (state, { path, error }) =>
    path === state.path ? { ...state, entriesLoading: false, entriesError: error } : state,
  ),
);
