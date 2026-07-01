import { createReducer, on } from '@ngrx/store';

import type {
  AdminProjectDetailResponse,
  AdminProjectListItem,
  ProjectListItem,
  ProjectResponse,
  ProjectSummaryResponse,
} from '../../types/projects.types';

import {
  billProjectTime,
  billProjectTimeFailure,
  billProjectTimeSuccess,
  clearProjectsError,
  createAdminProject,
  createAdminProjectFailure,
  createAdminProjectSuccess,
  deleteAdminProject,
  deleteAdminProjectFailure,
  deleteAdminProjectSuccess,
  loadAdminProjectDetail,
  loadAdminProjectDetailFailure,
  loadAdminProjectDetailSuccess,
  loadAdminProjects,
  loadAdminProjectsBatch,
  loadAdminProjectsFailure,
  loadAdminProjectsSuccess,
  loadProjectDetail,
  loadProjectDetailFailure,
  loadProjectDetailSuccess,
  loadProjects,
  loadProjectsBatch,
  loadProjectsFailure,
  loadProjectsSuccess,
  loadProjectSummary,
  loadProjectSummaryFailure,
  loadProjectSummarySuccess,
  projectSummaryChanged,
  updateAdminProject,
  updateAdminProjectFailure,
  updateAdminProjectSuccess,
} from './projects.actions';

export interface ProjectsState {
  projects: ProjectListItem[];
  adminProjects: AdminProjectListItem[];
  selectedProject: ProjectResponse | AdminProjectDetailResponse | null;
  summary: ProjectSummaryResponse | null;
  loading: boolean;
  loadingDetail: boolean;
  loadingSummary: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  billing: boolean;
  error: string | null;
}

export const initialProjectsState: ProjectsState = {
  projects: [],
  adminProjects: [],
  selectedProject: null,
  summary: null,
  loading: false,
  loadingDetail: false,
  loadingSummary: false,
  creating: false,
  updating: false,
  deleting: false,
  billing: false,
  error: null,
};

function mapToAdminListItem(project: ProjectResponse): AdminProjectListItem {
  return {
    ...project,
    unbilledMinutes: 'unbilledMinutes' in project ? Number(project.unbilledMinutes) : 0,
    openBillableAmountNet: 'openBillableAmountNet' in project ? Number(project.openBillableAmountNet) : 0,
  };
}

export const projectsReducer = createReducer(
  initialProjectsState,
  on(loadProjects, (state) => ({ ...state, projects: [], loading: true, error: null })),
  on(loadAdminProjects, (state) => ({ ...state, adminProjects: [], loading: true, error: null })),
  on(loadProjectsBatch, (state, { accumulatedProjects }) => ({
    ...state,
    projects: accumulatedProjects,
    loading: true,
  })),
  on(loadAdminProjectsBatch, (state, { accumulatedProjects }) => ({
    ...state,
    adminProjects: accumulatedProjects,
    loading: true,
  })),
  on(loadProjectsSuccess, (state, { projects }) => ({ ...state, projects, loading: false })),
  on(loadAdminProjectsSuccess, (state, { adminProjects }) => ({ ...state, adminProjects, loading: false })),
  on(loadProjectsFailure, loadAdminProjectsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(loadProjectDetail, loadAdminProjectDetail, (state) => ({
    ...state,
    loadingDetail: true,
    error: null,
  })),
  on(loadProjectDetailSuccess, (state, { project }) => ({
    ...state,
    selectedProject: project,
    loadingDetail: false,
  })),
  on(loadAdminProjectDetailSuccess, (state, { project }) => ({
    ...state,
    selectedProject: project,
    summary: project.summary ?? state.summary,
    loadingDetail: false,
  })),
  on(loadProjectDetailFailure, loadAdminProjectDetailFailure, (state, { error }) => ({
    ...state,
    loadingDetail: false,
    error,
  })),
  on(loadProjectSummary, (state) => ({ ...state, loadingSummary: true, error: null })),
  on(loadProjectSummarySuccess, projectSummaryChanged, (state, { summary }) => ({
    ...state,
    summary,
    loadingSummary: false,
  })),
  on(loadProjectSummaryFailure, (state, { error }) => ({ ...state, loadingSummary: false, error })),
  on(createAdminProject, (state) => ({ ...state, creating: true, error: null })),
  on(createAdminProjectSuccess, (state, { project }) => ({
    ...state,
    creating: false,
    adminProjects: [mapToAdminListItem(project), ...state.adminProjects],
  })),
  on(createAdminProjectFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateAdminProject, (state) => ({ ...state, updating: true, error: null })),
  on(updateAdminProjectSuccess, (state, { project }) => ({
    ...state,
    updating: false,
    adminProjects: state.adminProjects.map((item) => (item.id === project.id ? { ...item, ...project } : item)),
    selectedProject:
      state.selectedProject?.id === project.id ? { ...state.selectedProject, ...project } : state.selectedProject,
  })),
  on(updateAdminProjectFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(deleteAdminProject, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteAdminProjectSuccess, (state, { projectId }) => ({
    ...state,
    deleting: false,
    adminProjects: state.adminProjects.filter((p) => p.id !== projectId),
    selectedProject: state.selectedProject?.id === projectId ? null : state.selectedProject,
  })),
  on(deleteAdminProjectFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(billProjectTime, (state) => ({ ...state, billing: true, error: null })),
  on(billProjectTimeSuccess, (state) => ({ ...state, billing: false })),
  on(billProjectTimeFailure, (state, { error }) => ({ ...state, billing: false, error })),
  on(clearProjectsError, (state) => ({ ...state, error: null })),
);
