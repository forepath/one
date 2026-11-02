import { createReducer, on } from '@ngrx/store';

import type {
  AccessExportTarget,
  AccessImportResult,
  ClusterMember,
  ProjectAccess,
} from '../../types/access-management.types';
import {
  acceptCrossProjectRequest,
  accessChangeFailure,
  accessChangeSuccess,
  clearAccessChangeError,
  clearAccessExport,
  clearAccessImport,
  exportAccess,
  exportAccessFailure,
  exportAccessSuccess,
  importAccess,
  importAccessFailure,
  importAccessSuccess,
  loadAccessProjectsSuccess,
  loadClusterMembers,
  loadClusterMembersFailure,
  loadClusterMembersSuccess,
  loadProjectAccess,
  loadProjectAccessFailure,
  loadProjectAccessSuccess,
  removeClusterMember,
  removeProjectMember,
  setClusterMember,
  setProjectMember,
  updateProjectSettings,
  updateProjectSettingsSuccess,
} from './access-management.actions';

export interface ConsoleAccessManagementState {
  /** Every project the caller may pick (sorted). */
  projects: string[];
  clusterMembers: ClusterMember[];
  clusterMembersLoading: boolean;
  clusterMembersError: string | null;
  /** The project shown. */
  project: string | null;
  projectAccess: ProjectAccess | null;
  projectLoading: boolean;
  projectError: string | null;
  /** A change in flight (membership, settings, acceptance). */
  changing: boolean;
  changeError: string | null;
  exporting: boolean;
  exported: { yaml: string; target: AccessExportTarget } | null;
  exportError: string | null;
  importing: boolean;
  importResult: AccessImportResult | null;
  importError: string | null;
}

export const initialConsoleAccessManagementState: ConsoleAccessManagementState = {
  projects: [],
  clusterMembers: [],
  clusterMembersLoading: false,
  clusterMembersError: null,
  project: null,
  projectAccess: null,
  projectLoading: false,
  projectError: null,
  changing: false,
  changeError: null,
  exporting: false,
  exported: null,
  exportError: null,
  importing: false,
  importResult: null,
  importError: null,
};

const startChange = (state: ConsoleAccessManagementState): ConsoleAccessManagementState => ({
  ...state,
  changing: true,
  changeError: null,
});

export const consoleAccessManagementReducer = createReducer(
  initialConsoleAccessManagementState,
  on(loadAccessProjectsSuccess, (state, { projects }) => ({ ...state, projects })),
  on(loadClusterMembers, (state) => ({ ...state, clusterMembersLoading: true, clusterMembersError: null })),
  on(loadClusterMembersSuccess, (state, { members }) => ({
    ...state,
    clusterMembers: members,
    clusterMembersLoading: false,
  })),
  on(loadClusterMembersFailure, (state, { error }) => ({
    ...state,
    clusterMembersLoading: false,
    clusterMembersError: error,
  })),
  on(loadProjectAccess, (state, { project, silent }) => ({
    ...state,
    project,
    projectAccess: state.projectAccess?.project === project ? state.projectAccess : null,
    projectLoading: !silent,
    projectError: null,
    changeError: state.project === project ? state.changeError : null,
  })),
  on(loadProjectAccessSuccess, (state, { access }) =>
    state.project === access.project ? { ...state, projectAccess: access, projectLoading: false } : state,
  ),
  on(loadProjectAccessFailure, (state, { project, error }) =>
    state.project === project ? { ...state, projectLoading: false, projectError: error } : state,
  ),
  on(
    setClusterMember,
    removeClusterMember,
    setProjectMember,
    removeProjectMember,
    updateProjectSettings,
    acceptCrossProjectRequest,
    startChange,
  ),
  on(accessChangeSuccess, (state) => ({ ...state, changing: false })),
  on(updateProjectSettingsSuccess, (state, { settings }) => ({
    ...state,
    changing: false,
    projectAccess:
      state.projectAccess?.project === settings.project ? { ...state.projectAccess, settings } : state.projectAccess,
  })),
  on(accessChangeFailure, (state, { error }) => ({ ...state, changing: false, changeError: error })),
  on(clearAccessChangeError, (state) => ({ ...state, changeError: null })),
  on(exportAccess, (state) => ({ ...state, exporting: true, exported: null, exportError: null })),
  on(exportAccessSuccess, (state, { yaml, target }) => ({ ...state, exporting: false, exported: { yaml, target } })),
  on(exportAccessFailure, (state, { error }) => ({ ...state, exporting: false, exportError: error })),
  on(clearAccessExport, (state) => ({ ...state, exported: null })),
  on(importAccess, (state) => ({ ...state, importing: true, importResult: null, importError: null })),
  on(importAccessSuccess, (state, { result }) => ({ ...state, importing: false, importResult: result })),
  on(importAccessFailure, (state, { error }) => ({ ...state, importing: false, importError: error })),
  on(clearAccessImport, (state) => ({ ...state, importResult: null, importError: null })),
);
