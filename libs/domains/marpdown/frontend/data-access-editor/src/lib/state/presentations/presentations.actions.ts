import { createAction, props } from '@ngrx/store';

import type {
  CreatePresentationDto,
  ImportPresentationDto,
  ListPresentationsParams,
  PresentationResponseDto,
  PresentationSummaryDto,
  UpdatePresentationDto,
} from '../../types/presentation.types';

export const loadPresentations = createAction(
  '[Presentations] Load Presentations',
  props<{ params?: ListPresentationsParams }>(),
);

export const loadPresentationsBatch = createAction(
  '[Presentations] Load Presentations Batch',
  props<{ offset: number; accumulatedPresentations: PresentationSummaryDto[]; total: number }>(),
);

export const loadPresentationsSuccess = createAction(
  '[Presentations] Load Presentations Success',
  props<{ presentations: PresentationSummaryDto[]; total: number }>(),
);

export const loadPresentationsFailure = createAction('[Presentations] Load Presentations Failure', props<{ error: string }>());

export const loadPresentation = createAction('[Presentations] Load Presentation', props<{ id: string }>());

export const loadPresentationSuccess = createAction(
  '[Presentations] Load Presentation Success',
  props<{ presentation: PresentationResponseDto }>(),
);

export const loadPresentationFailure = createAction('[Presentations] Load Presentation Failure', props<{ error: string }>());

export const createPresentation = createAction('[Presentations] Create Presentation', props<{ dto: CreatePresentationDto }>());

export const createPresentationSuccess = createAction(
  '[Presentations] Create Presentation Success',
  props<{ presentation: PresentationResponseDto }>(),
);

export const createPresentationFailure = createAction(
  '[Presentations] Create Presentation Failure',
  props<{ error: string }>(),
);

export const updatePresentation = createAction(
  '[Presentations] Update Presentation',
  props<{ id: string; dto: UpdatePresentationDto }>(),
);

export const updatePresentationSuccess = createAction(
  '[Presentations] Update Presentation Success',
  props<{ presentation: PresentationResponseDto }>(),
);

export const updatePresentationFailure = createAction(
  '[Presentations] Update Presentation Failure',
  props<{ error: string }>(),
);

export const importPresentationMarkdown = createAction(
  '[Presentations] Import Markdown',
  props<{ id: string; dto: ImportPresentationDto }>(),
);

export const importPresentationMarkdownSuccess = createAction(
  '[Presentations] Import Markdown Success',
  props<{ presentation: PresentationResponseDto }>(),
);

export const importPresentationMarkdownFailure = createAction(
  '[Presentations] Import Markdown Failure',
  props<{ error: string }>(),
);

export const deletePresentation = createAction('[Presentations] Delete Presentation', props<{ id: string }>());

export const deletePresentationSuccess = createAction('[Presentations] Delete Presentation Success', props<{ id: string }>());

export const deletePresentationFailure = createAction(
  '[Presentations] Delete Presentation Failure',
  props<{ error: string }>(),
);

export const setActivePresentation = createAction('[Presentations] Set Active Presentation', props<{ id: string }>());

export const clearActivePresentation = createAction('[Presentations] Clear Active Presentation');
