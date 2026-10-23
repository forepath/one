import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ProjectMember } from '../../types/access-management.types';
import type { ConsoleAccessManagementState } from './access-management.reducer';

export const selectConsoleAccessManagementState =
  createFeatureSelector<ConsoleAccessManagementState>('consoleAccessManagement');

export const selectAccessProjects = createSelector(selectConsoleAccessManagementState, (state) => state.projects);
export const selectClusterMembers = createSelector(selectConsoleAccessManagementState, (state) => state.clusterMembers);
export const selectClusterMembersLoading = createSelector(
  selectConsoleAccessManagementState,
  (state) => state.clusterMembersLoading,
);
export const selectClusterMembersError = createSelector(
  selectConsoleAccessManagementState,
  (state) => state.clusterMembersError,
);
export const selectAccessProject = createSelector(selectConsoleAccessManagementState, (state) => state.project);
export const selectProjectAccess = createSelector(selectConsoleAccessManagementState, (state) => state.projectAccess);
export const selectProjectAccessLoading = createSelector(
  selectConsoleAccessManagementState,
  (state) => state.projectLoading,
);
export const selectProjectAccessError = createSelector(
  selectConsoleAccessManagementState,
  (state) => state.projectError,
);
export const selectAccessChanging = createSelector(selectConsoleAccessManagementState, (state) => state.changing);
export const selectAccessChangeError = createSelector(selectConsoleAccessManagementState, (state) => state.changeError);
export const selectAccessExporting = createSelector(selectConsoleAccessManagementState, (state) => state.exporting);
export const selectAccessExported = createSelector(selectConsoleAccessManagementState, (state) => state.exported);
export const selectAccessExportError = createSelector(selectConsoleAccessManagementState, (state) => state.exportError);
export const selectAccessImporting = createSelector(selectConsoleAccessManagementState, (state) => state.importing);
export const selectAccessImportResult = createSelector(
  selectConsoleAccessManagementState,
  (state) => state.importResult,
);
export const selectAccessImportError = createSelector(selectConsoleAccessManagementState, (state) => state.importError);

const ROLE_RANK: Record<ProjectMember['role'], number> = { admin: 0, operator: 1, developer: 2, viewer: 3 };

/** The project's members, admins first, then by user id. */
export const selectProjectMembers = createSelector(selectProjectAccess, (access) =>
  [...(access?.members ?? [])].sort(
    (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.userId.localeCompare(b.userId),
  ),
);

/** Cross-project requests, open ones first. */
export const selectCrossProjectRequests = createSelector(selectProjectAccess, (access) =>
  [...(access?.requests ?? [])].sort(
    (a, b) =>
      Number(a.accepted) - Number(b.accepted) || a.project.localeCompare(b.project) || a.policy.localeCompare(b.policy),
  ),
);

export const selectOpenCrossProjectRequestCount = createSelector(
  selectCrossProjectRequests,
  (requests) => requests.filter((r) => !r.accepted).length,
);
