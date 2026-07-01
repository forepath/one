import { createReducer, on } from '@ngrx/store';

import type { ProjectMilestoneResponse } from '../../types/projects.types';

import {
  createProjectMilestone,
  createProjectMilestoneFailure,
  createProjectMilestoneSuccess,
  deleteProjectMilestone,
  deleteProjectMilestoneFailure,
  deleteProjectMilestoneSuccess,
  loadProjectMilestones,
  loadProjectMilestonesFailure,
  loadProjectMilestonesSuccess,
  lockProjectMilestone,
  lockProjectMilestoneFailure,
  lockProjectMilestoneSuccess,
  projectBoardMilestoneRemoved,
  projectBoardMilestoneUpsert,
  updateProjectMilestone,
  updateProjectMilestoneFailure,
  updateProjectMilestoneSuccess,
} from './project-milestones.actions';
import { upsertProjectMilestone } from './project-milestones.utils';

export interface ProjectMilestonesState {
  projectId: string | null;
  milestones: ProjectMilestoneResponse[];
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export const initialProjectMilestonesState: ProjectMilestonesState = {
  projectId: null,
  milestones: [],
  loading: false,
  saving: false,
  error: null,
};

export const projectMilestonesReducer = createReducer(
  initialProjectMilestonesState,
  on(loadProjectMilestones, (state, { projectId }) => ({
    ...state,
    projectId,
    loading: true,
    error: null,
  })),
  on(loadProjectMilestonesSuccess, (state, { milestones }) => ({
    ...state,
    milestones,
    loading: false,
  })),
  on(loadProjectMilestonesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(createProjectMilestone, updateProjectMilestone, lockProjectMilestone, deleteProjectMilestone, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(createProjectMilestoneSuccess, (state, { milestone }) => ({
    ...state,
    saving: false,
    milestones: upsertProjectMilestone(state.milestones, milestone),
  })),
  on(updateProjectMilestoneSuccess, lockProjectMilestoneSuccess, (state, { milestone }) => ({
    ...state,
    saving: false,
    milestones: state.milestones
      .map((m) => (m.id === milestone.id ? milestone : m))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  })),
  on(deleteProjectMilestoneSuccess, (state, { id }) => ({
    ...state,
    saving: false,
    milestones: state.milestones.filter((m) => m.id !== id),
  })),
  on(
    createProjectMilestoneFailure,
    updateProjectMilestoneFailure,
    lockProjectMilestoneFailure,
    deleteProjectMilestoneFailure,
    (state, { error }) => ({ ...state, saving: false, error }),
  ),
  on(projectBoardMilestoneUpsert, (state, { milestone }) => ({
    ...state,
    milestones: upsertProjectMilestone(state.milestones, milestone),
  })),
  on(projectBoardMilestoneRemoved, (state, { id, projectId }) => ({
    ...state,
    milestones: state.milestones.filter((m) => !(m.id === id && m.projectId === projectId)),
  })),
);
