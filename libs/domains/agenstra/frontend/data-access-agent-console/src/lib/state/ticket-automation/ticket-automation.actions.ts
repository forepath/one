import { createAction, props } from '@ngrx/store';

import type {
  TicketAutomationResponseDto,
  TicketAutomationRunResponseDto,
  TicketAutomationRunStepResponseDto,
  UpdateTicketAutomationDto,
} from './ticket-automation.types';

export const loadTicketAutomation = createAction('[Ticket Automation] Load Config', props<{ ticketId: string }>());

export const loadTicketAutomationSuccess = createAction(
  '[Ticket Automation] Load Config Success',
  props<{ config: TicketAutomationResponseDto }>(),
);

export const loadTicketAutomationFailure = createAction(
  '[Ticket Automation] Load Config Failure',
  props<{ error: string }>(),
);

export const patchTicketAutomation = createAction(
  '[Ticket Automation] Patch Config',
  props<{ ticketId: string; dto: UpdateTicketAutomationDto }>(),
);

export const patchTicketAutomationSuccess = createAction(
  '[Ticket Automation] Patch Config Success',
  props<{ config: TicketAutomationResponseDto }>(),
);

export const patchTicketAutomationFailure = createAction(
  '[Ticket Automation] Patch Config Failure',
  props<{ error: string }>(),
);

export const approveTicketAutomation = createAction('[Ticket Automation] Approve', props<{ ticketId: string }>());

export const approveTicketAutomationSuccess = createAction(
  '[Ticket Automation] Approve Success',
  props<{ config: TicketAutomationResponseDto }>(),
);

export const approveTicketAutomationFailure = createAction(
  '[Ticket Automation] Approve Failure',
  props<{ error: string }>(),
);

export const unapproveTicketAutomation = createAction('[Ticket Automation] Unapprove', props<{ ticketId: string }>());

export const unapproveTicketAutomationSuccess = createAction(
  '[Ticket Automation] Unapprove Success',
  props<{ config: TicketAutomationResponseDto }>(),
);

export const unapproveTicketAutomationFailure = createAction(
  '[Ticket Automation] Unapprove Failure',
  props<{ error: string }>(),
);

export const loadTicketAutomationRuns = createAction('[Ticket Automation] Load Runs', props<{ ticketId: string }>());

export const loadTicketAutomationRunsSuccess = createAction(
  '[Ticket Automation] Load Runs Success',
  props<{ runs: TicketAutomationRunResponseDto[] }>(),
);

export const loadTicketAutomationRunsFailure = createAction(
  '[Ticket Automation] Load Runs Failure',
  props<{ error: string }>(),
);

export const loadTicketAutomationRunDetail = createAction(
  '[Ticket Automation] Load Run Detail',
  props<{ ticketId: string; runId: string }>(),
);

export const loadTicketAutomationRunDetailSuccess = createAction(
  '[Ticket Automation] Load Run Detail Success',
  props<{ run: TicketAutomationRunResponseDto }>(),
);

export const loadTicketAutomationRunDetailFailure = createAction(
  '[Ticket Automation] Load Run Detail Failure',
  props<{ error: string }>(),
);

export const cancelTicketAutomationRun = createAction(
  '[Ticket Automation] Cancel Run',
  props<{ ticketId: string; runId: string }>(),
);

export const cancelTicketAutomationRunSuccess = createAction(
  '[Ticket Automation] Cancel Run Success',
  props<{ run: TicketAutomationRunResponseDto }>(),
);

export const cancelTicketAutomationRunFailure = createAction(
  '[Ticket Automation] Cancel Run Failure',
  props<{ error: string }>(),
);

export const clearTicketAutomationError = createAction('[Ticket Automation] Clear Error');

export const clearTicketAutomation = createAction('[Ticket Automation] Clear State');

export const ticketBoardAutomationUpsert = createAction(
  '[Ticket Automation] Board Socket Config Upsert',
  props<{ config: TicketAutomationResponseDto }>(),
);

export const ticketBoardAutomationRunUpsert = createAction(
  '[Ticket Automation] Board Socket Run Upsert',
  props<{ run: TicketAutomationRunResponseDto }>(),
);

export const ticketBoardAutomationRunStepAppended = createAction(
  '[Ticket Automation] Board Socket Run Step Appended',
  props<{ runId: string; step: TicketAutomationRunStepResponseDto }>(),
);
