import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ProjectMilestonesState } from './project-milestones.reducer';

export const selectProjectMilestonesState = createFeatureSelector<ProjectMilestonesState>('projectMilestones');

export const selectProjectMilestones = createSelector(selectProjectMilestonesState, (s) => s.milestones);
export const selectProjectMilestonesLoading = createSelector(selectProjectMilestonesState, (s) => s.loading);
export const selectProjectMilestonesSaving = createSelector(selectProjectMilestonesState, (s) => s.saving);
export const selectProjectMilestonesError = createSelector(selectProjectMilestonesState, (s) => s.error);
