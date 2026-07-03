import { createFeatureSelector, createSelector } from '@ngrx/store';

import { CONTACT_REQUEST_FEATURE_KEY } from '../../constants/contact-request.constants';

import type { ContactRequestState } from './contact-request.reducer';

export const selectContactRequestState = createFeatureSelector<ContactRequestState>(CONTACT_REQUEST_FEATURE_KEY);

export const selectContactRequestSubmitting = createSelector(selectContactRequestState, (state) => state.submitting);

export const selectContactRequestSubmitted = createSelector(selectContactRequestState, (state) => state.submitted);

export const selectContactRequestReferenceId = createSelector(selectContactRequestState, (state) => state.referenceId);

export const selectContactRequestError = createSelector(selectContactRequestState, (state) => state.error);
