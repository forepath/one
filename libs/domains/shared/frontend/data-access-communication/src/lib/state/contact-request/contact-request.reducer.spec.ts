import {
  resetContactRequest,
  submitContactRequest,
  submitContactRequestFailure,
  submitContactRequestSuccess,
} from './contact-request.actions';
import { contactRequestReducer, initialContactRequestState } from './contact-request.reducer';

describe('contactRequestReducer', () => {
  it('should return initial state', () => {
    expect(contactRequestReducer(undefined, { type: '@@init' } as never)).toEqual(initialContactRequestState);
  });

  it('should set submitting on submitContactRequest', () => {
    const state = contactRequestReducer(
      initialContactRequestState,
      submitContactRequest({
        payload: {
          name: 'Jane',
          email: 'jane@example.com',
          message: 'Hi',
          turnstileToken: 'token',
        },
      }),
    );

    expect(state.submitting).toBe(true);
    expect(state.submitted).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should set success state on submitContactRequestSuccess', () => {
    const state = contactRequestReducer(
      { ...initialContactRequestState, submitting: true },
      submitContactRequestSuccess({ referenceId: 'ref-1' }),
    );

    expect(state.submitting).toBe(false);
    expect(state.submitted).toBe(true);
    expect(state.referenceId).toBe('ref-1');
    expect(state.error).toBeNull();
  });

  it('should set error on submitContactRequestFailure', () => {
    const state = contactRequestReducer(
      { ...initialContactRequestState, submitting: true },
      submitContactRequestFailure({ error: 'Captcha failed' }),
    );

    expect(state.submitting).toBe(false);
    expect(state.submitted).toBe(false);
    expect(state.error).toBe('Captcha failed');
  });

  it('should reset to initial state on resetContactRequest', () => {
    const state = contactRequestReducer(
      {
        submitting: false,
        submitted: true,
        referenceId: 'ref-1',
        error: null,
      },
      resetContactRequest(),
    );

    expect(state).toEqual(initialContactRequestState);
  });
});
