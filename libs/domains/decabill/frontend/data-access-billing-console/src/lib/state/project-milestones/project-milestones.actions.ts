import { createAction, props } from '@ngrx/store';

import type {
  CreateProjectMilestoneDto,
  ProjectMilestoneResponse,
  UpdateProjectMilestoneDto,
} from '../../types/projects.types';

export const loadProjectMilestones = createAction('[ProjectMilestones] Load', props<{ projectId: string }>());
export const loadProjectMilestonesSuccess = createAction(
  '[ProjectMilestones] Load Success',
  props<{ milestones: ProjectMilestoneResponse[] }>(),
);
export const loadProjectMilestonesFailure = createAction(
  '[ProjectMilestones] Load Failure',
  props<{ error: string }>(),
);

export const createProjectMilestone = createAction(
  '[ProjectMilestones] Create',
  props<{ projectId: string; dto: CreateProjectMilestoneDto }>(),
);
export const createProjectMilestoneSuccess = createAction(
  '[ProjectMilestones] Create Success',
  props<{ milestone: ProjectMilestoneResponse }>(),
);
export const createProjectMilestoneFailure = createAction(
  '[ProjectMilestones] Create Failure',
  props<{ error: string }>(),
);

export const updateProjectMilestone = createAction(
  '[ProjectMilestones] Update',
  props<{ projectId: string; id: string; dto: UpdateProjectMilestoneDto }>(),
);
export const updateProjectMilestoneSuccess = createAction(
  '[ProjectMilestones] Update Success',
  props<{ milestone: ProjectMilestoneResponse }>(),
);
export const updateProjectMilestoneFailure = createAction(
  '[ProjectMilestones] Update Failure',
  props<{ error: string }>(),
);

export const lockProjectMilestone = createAction(
  '[ProjectMilestones] Lock',
  props<{ projectId: string; id: string }>(),
);
export const lockProjectMilestoneSuccess = createAction(
  '[ProjectMilestones] Lock Success',
  props<{ milestone: ProjectMilestoneResponse }>(),
);
export const lockProjectMilestoneFailure = createAction('[ProjectMilestones] Lock Failure', props<{ error: string }>());

export const deleteProjectMilestone = createAction(
  '[ProjectMilestones] Delete',
  props<{ projectId: string; id: string }>(),
);
export const deleteProjectMilestoneSuccess = createAction(
  '[ProjectMilestones] Delete Success',
  props<{ id: string }>(),
);
export const deleteProjectMilestoneFailure = createAction(
  '[ProjectMilestones] Delete Failure',
  props<{ error: string }>(),
);

export const projectBoardMilestoneUpsert = createAction(
  '[ProjectMilestones] Board Socket Upsert',
  props<{ milestone: ProjectMilestoneResponse }>(),
);
export const projectBoardMilestoneRemoved = createAction(
  '[ProjectMilestones] Board Socket Removed',
  props<{ id: string; projectId: string }>(),
);
