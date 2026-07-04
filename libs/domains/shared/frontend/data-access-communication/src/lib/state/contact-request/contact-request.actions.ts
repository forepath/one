import { createAction, props } from '@ngrx/store';

import type { SubmitContactRequestPayload } from '../../types/contact-request.types';

export const submitContactRequest = createAction(
  '[Contact Request] Submit',
  props<{ payload: SubmitContactRequestPayload }>(),
);

export const submitContactRequestSuccess = createAction(
  '[Contact Request] Submit Success',
  props<{ referenceId: string }>(),
);

export const submitContactRequestFailure = createAction('[Contact Request] Submit Failure', props<{ error: string }>());

export const resetContactRequest = createAction('[Contact Request] Reset');
