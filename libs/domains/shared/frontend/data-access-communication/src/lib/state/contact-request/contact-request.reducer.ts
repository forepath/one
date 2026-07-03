import { createReducer, on } from '@ngrx/store';

import {
  resetContactRequest,
  submitContactRequest,
  submitContactRequestFailure,
  submitContactRequestSuccess,
} from './contact-request.actions';

export interface ContactRequestState {
  submitting: boolean;
  submitted: boolean;
  referenceId: string | null;
  error: string | null;
}

export const initialContactRequestState: ContactRequestState = {
  submitting: false,
  submitted: false,
  referenceId: null,
  error: null,
};

export const contactRequestReducer = createReducer(
  initialContactRequestState,
  on(submitContactRequest, (state) => ({
    ...state,
    submitting: true,
    submitted: false,
    referenceId: null,
    error: null,
  })),
  on(submitContactRequestSuccess, (state, { referenceId }) => ({
    ...state,
    submitting: false,
    submitted: true,
    referenceId,
    error: null,
  })),
  on(submitContactRequestFailure, (state, { error }) => ({
    ...state,
    submitting: false,
    submitted: false,
    referenceId: null,
    error,
  })),
  on(resetContactRequest, () => initialContactRequestState),
);
