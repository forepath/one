import { createAction, props } from '@ngrx/store';

import type { Report, ReportFileEntry, RunReport } from '../../types/reports.types';

export const loadReports = createAction('[ConsoleReports] Load', props<{ silent?: boolean }>());
export const loadReportsSuccess = createAction('[ConsoleReports] Load Success', props<{ reports: Report[] }>());
export const loadReportsFailure = createAction('[ConsoleReports] Load Failure', props<{ error: string }>());

export const runReport = createAction('[ConsoleReports] Run', props<{ report: RunReport }>());
export const runReportSuccess = createAction('[ConsoleReports] Run Success', props<{ report: RunReport }>());
export const runReportFailure = createAction('[ConsoleReports] Run Failure', props<{ error: string }>());

/** Opens a folder of the file tree (`''` = the root). */
export const openReportFolder = createAction('[ConsoleReports] Open Folder', props<{ path: string }>());
export const openReportFolderSuccess = createAction(
  '[ConsoleReports] Open Folder Success',
  props<{ path: string; entries: ReportFileEntry[] }>(),
);
export const openReportFolderFailure = createAction(
  '[ConsoleReports] Open Folder Failure',
  props<{ path: string; error: string }>(),
);

export const clearReportRunResult = createAction('[ConsoleReports] Clear Run Result');
