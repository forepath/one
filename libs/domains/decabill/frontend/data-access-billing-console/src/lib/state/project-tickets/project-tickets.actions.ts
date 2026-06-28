import { createAction, props } from '@ngrx/store';

import type {
  CreateProjectTicketDto,
  ListProjectTicketsParams,
  ProjectTicketActivityResponse,
  ProjectTicketCommentResponse,
  ProjectTicketResponse,
  UpdateProjectTicketDto,
} from '../../types/projects.types';

export const loadProjectTickets = createAction('[ProjectTickets] Load', props<{ params: ListProjectTicketsParams }>());
export const loadProjectTicketsSuccess = createAction(
  '[ProjectTickets] Load Success',
  props<{ tickets: ProjectTicketResponse[] }>(),
);
export const loadProjectTicketsFailure = createAction('[ProjectTickets] Load Failure', props<{ error: string }>());

export const openProjectTicketDetail = createAction('[ProjectTickets] Open Detail', props<{ id: string }>());
export const loadProjectTicketDetailBundleSuccess = createAction(
  '[ProjectTickets] Load Detail Bundle Success',
  props<{
    ticket: ProjectTicketResponse;
    comments: ProjectTicketCommentResponse[];
    activity: ProjectTicketActivityResponse[];
  }>(),
);
export const loadProjectTicketDetailFailure = createAction(
  '[ProjectTickets] Load Detail Failure',
  props<{ error: string }>(),
);
export const closeProjectTicketDetail = createAction('[ProjectTickets] Close Detail');

export const createProjectTicket = createAction(
  '[ProjectTickets] Create',
  props<{ projectId: string; dto: CreateProjectTicketDto }>(),
);
export const createProjectTicketSuccess = createAction(
  '[ProjectTickets] Create Success',
  props<{ ticket: ProjectTicketResponse }>(),
);
export const createProjectTicketFailure = createAction('[ProjectTickets] Create Failure', props<{ error: string }>());

export const updateProjectTicket = createAction(
  '[ProjectTickets] Update',
  props<{ projectId: string; id: string; dto: UpdateProjectTicketDto }>(),
);
export const updateProjectTicketSuccess = createAction(
  '[ProjectTickets] Update Success',
  props<{ ticket: ProjectTicketResponse; activity: ProjectTicketActivityResponse[] }>(),
);
export const updateProjectTicketFailure = createAction('[ProjectTickets] Update Failure', props<{ error: string }>());

export const deleteProjectTicket = createAction('[ProjectTickets] Delete', props<{ projectId: string; id: string }>());
export const deleteProjectTicketSuccess = createAction('[ProjectTickets] Delete Success', props<{ id: string }>());
export const deleteProjectTicketFailure = createAction('[ProjectTickets] Delete Failure', props<{ error: string }>());

export const addProjectTicketComment = createAction(
  '[ProjectTickets] Add Comment',
  props<{ projectId: string; ticketId: string; body: string }>(),
);
export const addProjectTicketCommentSuccess = createAction(
  '[ProjectTickets] Add Comment Success',
  props<{ comment: ProjectTicketCommentResponse; activity: ProjectTicketActivityResponse[] }>(),
);
export const addProjectTicketCommentFailure = createAction(
  '[ProjectTickets] Add Comment Failure',
  props<{ error: string }>(),
);

export const clearProjectTicketsError = createAction('[ProjectTickets] Clear Error');

export const projectBoardTicketUpsert = createAction(
  '[ProjectTickets] Board Socket Ticket Upsert',
  props<{ ticket: ProjectTicketResponse }>(),
);
export const projectBoardTicketRemoved = createAction(
  '[ProjectTickets] Board Socket Ticket Removed',
  props<{ id: string; projectId: string }>(),
);
export const projectBoardCommentCreated = createAction(
  '[ProjectTickets] Board Socket Comment Created',
  props<{ comment: ProjectTicketCommentResponse }>(),
);
export const projectBoardActivityCreated = createAction(
  '[ProjectTickets] Board Socket Activity Created',
  props<{ activity: ProjectTicketActivityResponse }>(),
);
