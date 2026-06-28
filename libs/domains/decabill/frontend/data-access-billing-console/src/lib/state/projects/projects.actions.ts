import { createAction, props } from '@ngrx/store';

import type {
  AdminProjectDetailResponse,
  AdminProjectListItem,
  BillProjectTimeResponse,
  CreateAdminProjectDto,
  ProjectListItem,
  ProjectResponse,
  ProjectSummaryResponse,
  UpdateAdminProjectDto,
} from '../../types/projects.types';

export const loadProjects = createAction('[Projects] Load Customer Projects');
export const loadProjectsBatch = createAction(
  '[Projects] Load Customer Projects Batch',
  props<{ offset: number; accumulatedProjects: ProjectListItem[] }>(),
);
export const loadProjectsSuccess = createAction(
  '[Projects] Load Customer Projects Success',
  props<{ projects: ProjectListItem[] }>(),
);
export const loadProjectsFailure = createAction(
  '[Projects] Load Customer Projects Failure',
  props<{ error: string }>(),
);

export const loadProjectDetail = createAction('[Projects] Load Project Detail', props<{ projectId: string }>());
export const loadProjectDetailSuccess = createAction(
  '[Projects] Load Project Detail Success',
  props<{ project: ProjectResponse }>(),
);
export const loadProjectDetailFailure = createAction(
  '[Projects] Load Project Detail Failure',
  props<{ error: string }>(),
);

export const loadProjectSummary = createAction('[Projects] Load Project Summary', props<{ projectId: string }>());
export const loadProjectSummarySuccess = createAction(
  '[Projects] Load Project Summary Success',
  props<{ summary: ProjectSummaryResponse }>(),
);
export const loadProjectSummaryFailure = createAction(
  '[Projects] Load Project Summary Failure',
  props<{ error: string }>(),
);

export const loadAdminProjects = createAction('[Projects] Load Admin Projects');
export const loadAdminProjectsBatch = createAction(
  '[Projects] Load Admin Projects Batch',
  props<{ offset: number; accumulatedProjects: AdminProjectListItem[] }>(),
);
export const loadAdminProjectsSuccess = createAction(
  '[Projects] Load Admin Projects Success',
  props<{ adminProjects: AdminProjectListItem[] }>(),
);
export const loadAdminProjectsFailure = createAction(
  '[Projects] Load Admin Projects Failure',
  props<{ error: string }>(),
);

export const loadAdminProjectDetail = createAction(
  '[Projects] Load Admin Project Detail',
  props<{ projectId: string }>(),
);
export const loadAdminProjectDetailSuccess = createAction(
  '[Projects] Load Admin Project Detail Success',
  props<{ project: AdminProjectDetailResponse }>(),
);
export const loadAdminProjectDetailFailure = createAction(
  '[Projects] Load Admin Project Detail Failure',
  props<{ error: string }>(),
);

export const createAdminProject = createAction(
  '[Projects] Create Admin Project',
  props<{ dto: CreateAdminProjectDto }>(),
);
export const createAdminProjectSuccess = createAction(
  '[Projects] Create Admin Project Success',
  props<{ project: ProjectResponse }>(),
);
export const createAdminProjectFailure = createAction(
  '[Projects] Create Admin Project Failure',
  props<{ error: string }>(),
);

export const updateAdminProject = createAction(
  '[Projects] Update Admin Project',
  props<{ projectId: string; dto: UpdateAdminProjectDto }>(),
);
export const updateAdminProjectSuccess = createAction(
  '[Projects] Update Admin Project Success',
  props<{ project: ProjectResponse }>(),
);
export const updateAdminProjectFailure = createAction(
  '[Projects] Update Admin Project Failure',
  props<{ error: string }>(),
);

export const deleteAdminProject = createAction('[Projects] Delete Admin Project', props<{ projectId: string }>());
export const deleteAdminProjectSuccess = createAction(
  '[Projects] Delete Admin Project Success',
  props<{ projectId: string }>(),
);
export const deleteAdminProjectFailure = createAction(
  '[Projects] Delete Admin Project Failure',
  props<{ error: string }>(),
);

export const billProjectTime = createAction(
  '[Projects] Bill Project Time',
  props<{ projectId: string; from: string; to: string }>(),
);
export const billProjectTimeSuccess = createAction(
  '[Projects] Bill Project Time Success',
  props<{ projectId: string; result: BillProjectTimeResponse }>(),
);
export const billProjectTimeFailure = createAction('[Projects] Bill Project Time Failure', props<{ error: string }>());

export const projectSummaryChanged = createAction(
  '[Projects] Project Summary Changed',
  props<{ summary: ProjectSummaryResponse }>(),
);

export const clearProjectsError = createAction('[Projects] Clear Error');
