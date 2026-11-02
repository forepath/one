import { createReducer, on } from '@ngrx/store';
import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

import type {
  AdminProjectDetailResponse,
  AdminProjectListItem,
  ProjectListItem,
  ProjectResponse,
  ProjectSummaryResponse,
  ProjectsCatalogSummaryResponse,
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
  loadAdminProjectsFailure,
  loadAdminProjectsSuccess,
  loadProjectDetail,
  loadProjectDetailFailure,
  loadProjectDetailSuccess,
  loadProjects,
  loadProjectsCatalogSummary,
  loadProjectsCatalogSummaryFailure,
  loadProjectsCatalogSummarySuccess,
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
  catalogSummary: ProjectsCatalogSummaryResponse | null;
  catalogSummaryLoading: boolean;
  loading: boolean;
  loadingDetail: boolean;
  loadingSummary: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  billing: boolean;
  error: string | null;
  /** Replace-page paging of the customer list: server total, 1-based page and its size. */
  total: number;
  page: number;
  pageSize: number;
  /** Replace-page paging of the admin list. */
  adminTotal: number;
  adminPage: number;
  adminPageSize: number;
  adminSearch: string | null;
  adminUserId: string | null;
  customerSearch: string | null;
}

export const initialProjectsState: ProjectsState = {
  projects: [],
  adminProjects: [],
  selectedProject: null,
  summary: null,
  catalogSummary: null,
  catalogSummaryLoading: false,
  loading: false,
  loadingDetail: false,
  loadingSummary: false,
  creating: false,
  updating: false,
  deleting: false,
  billing: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: BILLING_LIST_PAGE_SIZE,
  adminTotal: 0,
  adminPage: 1,
  adminPageSize: BILLING_LIST_PAGE_SIZE,
  adminSearch: null,
  adminUserId: null,
  customerSearch: null,
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
  on(loadProjectsCatalogSummary, (state) => ({
    ...state,
    catalogSummaryLoading: true,
  })),
  on(loadProjectsCatalogSummarySuccess, (state, { summary }) => ({
    ...state,
    catalogSummary: summary,
    catalogSummaryLoading: false,
  })),
  on(loadProjectsCatalogSummaryFailure, (state, { error }) => ({
    ...state,
    catalogSummaryLoading: false,
    error,
  })),
  on(loadProjects, (state, { search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.pageSize);

    return {
      ...state,
      loading: true,
      error: null,
      page: window.page,
      pageSize: window.pageSize,
      customerSearch: search?.trim() ? search.trim() : null,
    };
  }),
  on(loadAdminProjects, (state, { search, userId, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.adminPageSize);

    return {
      ...state,
      loading: true,
      error: null,
      adminPage: window.page,
      adminPageSize: window.pageSize,
      adminSearch: search?.trim() ? search.trim() : null,
      adminUserId: userId ?? null,
    };
  }),
  on(loadProjectsSuccess, (state, { projects, total }) => ({
    ...state,
    projects,
    total,
    loading: false,
  })),
  on(loadAdminProjectsSuccess, (state, { adminProjects, total }) => ({
    ...state,
    adminProjects,
    adminTotal: total,
    loading: false,
  })),
  on(loadProjectsFailure, (state, { error }) => ({
    ...state,
    projects: [],
    total: 0,
    loading: false,
    error,
  })),
  on(loadAdminProjectsFailure, (state, { error }) => ({
    ...state,
    adminProjects: [],
    adminTotal: 0,
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
