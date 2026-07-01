import { createAction, props } from '@ngrx/store';

import type {
  CreateProjectTimeEntryDto,
  ProjectTimeEntryResponse,
  UpdateProjectTimeEntryDto,
} from '../../types/projects.types';

export const loadProjectTimeEntries = createAction('[ProjectTimeEntries] Load', props<{ projectId: string }>());
export const loadProjectTimeEntriesBatch = createAction(
  '[ProjectTimeEntries] Load Batch',
  props<{ projectId: string; offset: number; accumulatedEntries: ProjectTimeEntryResponse[] }>(),
);
export const loadProjectTimeEntriesSuccess = createAction(
  '[ProjectTimeEntries] Load Success',
  props<{ entries: ProjectTimeEntryResponse[] }>(),
);
export const loadProjectTimeEntriesFailure = createAction(
  '[ProjectTimeEntries] Load Failure',
  props<{ error: string }>(),
);

export const createProjectTimeEntry = createAction(
  '[ProjectTimeEntries] Create',
  props<{ projectId: string; dto: CreateProjectTimeEntryDto }>(),
);
export const createProjectTimeEntrySuccess = createAction(
  '[ProjectTimeEntries] Create Success',
  props<{ entry: ProjectTimeEntryResponse }>(),
);
export const createProjectTimeEntryFailure = createAction(
  '[ProjectTimeEntries] Create Failure',
  props<{ error: string }>(),
);

export const updateProjectTimeEntry = createAction(
  '[ProjectTimeEntries] Update',
  props<{ projectId: string; id: string; dto: UpdateProjectTimeEntryDto }>(),
);
export const updateProjectTimeEntrySuccess = createAction(
  '[ProjectTimeEntries] Update Success',
  props<{ entry: ProjectTimeEntryResponse }>(),
);
export const updateProjectTimeEntryFailure = createAction(
  '[ProjectTimeEntries] Update Failure',
  props<{ error: string }>(),
);

export const deleteProjectTimeEntry = createAction(
  '[ProjectTimeEntries] Delete',
  props<{ projectId: string; id: string }>(),
);
export const deleteProjectTimeEntrySuccess = createAction(
  '[ProjectTimeEntries] Delete Success',
  props<{ id: string; projectId: string }>(),
);
export const deleteProjectTimeEntryFailure = createAction(
  '[ProjectTimeEntries] Delete Failure',
  props<{ error: string }>(),
);

export const projectBoardTimeEntryUpsert = createAction(
  '[ProjectTimeEntries] Board Socket Upsert',
  props<{ entry: ProjectTimeEntryResponse }>(),
);
export const projectBoardTimeEntryRemoved = createAction(
  '[ProjectTimeEntries] Board Socket Removed',
  props<{ id: string; projectId: string }>(),
);

export const loadProjectTicketTimeEntries = createAction(
  '[ProjectTimeEntries] Load Ticket',
  props<{ projectId: string; ticketId: string }>(),
);
export const loadProjectTicketTimeEntriesBatch = createAction(
  '[ProjectTimeEntries] Load Ticket Batch',
  props<{
    projectId: string;
    ticketId: string;
    offset: number;
    accumulatedEntries: ProjectTimeEntryResponse[];
  }>(),
);
export const loadProjectTicketTimeEntriesSuccess = createAction(
  '[ProjectTimeEntries] Load Ticket Success',
  props<{ entries: ProjectTimeEntryResponse[] }>(),
);
export const loadProjectTicketTimeEntriesFailure = createAction(
  '[ProjectTimeEntries] Load Ticket Failure',
  props<{ error: string }>(),
);
export const clearProjectTicketTimeEntries = createAction('[ProjectTimeEntries] Clear Ticket Scope');
