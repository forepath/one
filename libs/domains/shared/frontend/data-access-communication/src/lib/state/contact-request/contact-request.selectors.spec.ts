import { initialContactRequestState, type ContactRequestState } from './contact-request.reducer';
import {
  selectContactRequestError,
  selectContactRequestReferenceId,
  selectContactRequestState,
  selectContactRequestSubmitted,
  selectContactRequestSubmitting,
} from './contact-request.selectors';

describe('contactRequestSelectors', () => {
  const state: ContactRequestState = {
    submitting: true,
    submitted: false,
    referenceId: 'ref-1',
    error: 'failed',
  };

  it('selectContactRequestState should return feature slice', () => {
    expect(selectContactRequestState.projector(state)).toEqual(state);
  });

  it('selectContactRequestSubmitting should return submitting flag', () => {
    expect(selectContactRequestSubmitting.projector(state)).toBe(true);
  });

  it('selectContactRequestSubmitted should return submitted flag', () => {
    expect(selectContactRequestSubmitted.projector(state)).toBe(false);
  });

  it('selectContactRequestReferenceId should return reference id', () => {
    expect(selectContactRequestReferenceId.projector(state)).toBe('ref-1');
  });

  it('selectContactRequestError should return error', () => {
    expect(selectContactRequestError.projector(state)).toBe('failed');
  });

  it('selectContactRequestState should match initial state defaults', () => {
    expect(selectContactRequestSubmitting.projector(initialContactRequestState)).toBe(false);
    expect(selectContactRequestSubmitted.projector(initialContactRequestState)).toBe(false);
    expect(selectContactRequestReferenceId.projector(initialContactRequestState)).toBeNull();
    expect(selectContactRequestError.projector(initialContactRequestState)).toBeNull();
  });
});
