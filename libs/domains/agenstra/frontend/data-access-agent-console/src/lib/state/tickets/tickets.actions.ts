import { createAction, props } from '@ngrx/store';

import type {
  CreateTicketDto,
  ListTicketsParams,
  TicketActivityResponseDto,
  TicketCommentResponseDto,
  TicketResponseDto,
  UpdateTicketDto,
} from './tickets.types';

export const loadTickets = createAction('[Tickets] Load', props<{ params?: ListTicketsParams }>());

export const loadTicketsSuccess = createAction('[Tickets] Load Success', props<{ tickets: TicketResponseDto[] }>());

export const loadTicketsFailure = createAction('[Tickets] Load Failure', props<{ error: string }>());

export const openTicketDetail = createAction('[Tickets] Open Detail', props<{ id: string }>());

export const loadTicketDetailBundleSuccess = createAction(
  '[Tickets] Load Detail Bundle Success',
  props<{
    ticket: TicketResponseDto;
    comments: TicketCommentResponseDto[];
    activity: TicketActivityResponseDto[];
  }>(),
);

export const loadTicketDetailFailure = createAction('[Tickets] Load Detail Failure', props<{ error: string }>());

export const closeTicketDetail = createAction('[Tickets] Close Detail');

export const createTicket = createAction('[Tickets] Create', props<{ dto: CreateTicketDto }>());

export const createTicketSuccess = createAction(
  '[Tickets] Create Success',
  props<{ ticket: TicketResponseDto; createdChildTickets?: TicketResponseDto[] }>(),
);

export const createTicketFailure = createAction('[Tickets] Create Failure', props<{ error: string }>());

export const updateTicket = createAction('[Tickets] Update', props<{ id: string; dto: UpdateTicketDto }>());

export const updateTicketSuccess = createAction(
  '[Tickets] Update Success',
  props<{ ticket: TicketResponseDto; activity: TicketActivityResponseDto[] }>(),
);

export const updateTicketFailure = createAction('[Tickets] Update Failure', props<{ error: string }>());

export const migrateTicket = createAction('[Tickets] Migrate', props<{ id: string; targetClientId: string }>());

export const migrateTicketSuccess = createAction(
  '[Tickets] Migrate Success',
  props<{ rootTicket: TicketResponseDto; migratedTicketIds: string[]; requestedTicketId: string }>(),
);

export const migrateTicketFailure = createAction('[Tickets] Migrate Failure', props<{ error: string }>());

export const deleteTicket = createAction(
  '[Tickets] Delete',
  props<{ id: string; releaseExternalSyncMarker?: boolean }>(),
);

export const deleteTicketSuccess = createAction('[Tickets] Delete Success', props<{ id: string }>());

export const deleteTicketFailure = createAction('[Tickets] Delete Failure', props<{ error: string }>());

export const addTicketComment = createAction('[Tickets] Add Comment', props<{ ticketId: string; body: string }>());

export const addTicketCommentSuccess = createAction(
  '[Tickets] Add Comment Success',
  props<{ comment: TicketCommentResponseDto; activity: TicketActivityResponseDto[] }>(),
);

export const addTicketCommentFailure = createAction('[Tickets] Add Comment Failure', props<{ error: string }>());

export const clearTicketsError = createAction('[Tickets] Clear Error');

/** Prepends one activity row (e.g. body-generation session start) while detail is open; list order is newest-first. */
export const prependTicketDetailActivity = createAction(
  '[Tickets] Prepend Detail Activity',
  props<{ activity: TicketActivityResponseDto }>(),
);

/** Replaces activity list for an open ticket (e.g. after automation patch without reloading the whole bundle). */
export const replaceTicketDetailActivity = createAction(
  '[Tickets] Replace Detail Activity',
  props<{ ticketId: string; activity: TicketActivityResponseDto[] }>(),
);

/** Realtime: full ticket snapshot (merge list + open detail; does not replace activity/comments). */
export const ticketBoardTicketUpsert = createAction(
  '[Tickets] Board Socket Ticket Upsert',
  props<{ ticket: TicketResponseDto }>(),
);

export const ticketBoardTicketRemoved = createAction(
  '[Tickets] Board Socket Ticket Removed',
  props<{ id: string; clientId: string }>(),
);

export const ticketBoardCommentCreated = createAction(
  '[Tickets] Board Socket Comment Created',
  props<{ comment: TicketCommentResponseDto }>(),
);

export const ticketBoardActivityCreated = createAction(
  '[Tickets] Board Socket Activity Created',
  props<{ activity: TicketActivityResponseDto }>(),
);
