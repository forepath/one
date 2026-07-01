import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ProjectsState } from './projects.reducer';

export const selectProjectsState = createFeatureSelector<ProjectsState>('projects');

export const selectCustomerProjects = createSelector(selectProjectsState, (s) => s.projects);
export const selectAdminProjects = createSelector(selectProjectsState, (s) => s.adminProjects);
export const selectSelectedProject = createSelector(selectProjectsState, (s) => s.selectedProject);
export const selectProjectSummary = createSelector(selectProjectsState, (s) => s.summary);
export const selectProjectsLoading = createSelector(selectProjectsState, (s) => s.loading);
export const selectProjectsLoadingDetail = createSelector(selectProjectsState, (s) => s.loadingDetail);
export const selectProjectsLoadingSummary = createSelector(selectProjectsState, (s) => s.loadingSummary);
export const selectProjectsCreating = createSelector(selectProjectsState, (s) => s.creating);
export const selectProjectsUpdating = createSelector(selectProjectsState, (s) => s.updating);
export const selectProjectsDeleting = createSelector(selectProjectsState, (s) => s.deleting);
export const selectProjectsBilling = createSelector(selectProjectsState, (s) => s.billing);
export const selectProjectsError = createSelector(selectProjectsState, (s) => s.error);
