import type { PublicWithdrawalAddressee } from '../../types/public-withdrawal.types';

import {
  clearPublicWithdrawalError,
  clearPublicWithdrawalSuccessMessage,
  confirmPublicWithdrawal,
  confirmPublicWithdrawalFailure,
  confirmPublicWithdrawalSuccess,
  loadPublicWithdrawalAddressee,
  loadPublicWithdrawalAddresseeFailure,
  loadPublicWithdrawalAddresseeSuccess,
  requestPublicWithdrawal,
  requestPublicWithdrawalFailure,
  requestPublicWithdrawalSuccess,
  resetPublicWithdrawal,
  verifyPublicWithdrawalCode,
  verifyPublicWithdrawalCodeFailure,
  verifyPublicWithdrawalCodeSuccess,
} from './public-withdrawal.actions';
import { initialPublicWithdrawalState, publicWithdrawalReducer } from './public-withdrawal.reducer';

describe('publicWithdrawalReducer', () => {
  const mockAddressee: PublicWithdrawalAddressee = {
    name: 'Acme GmbH',
    lines: ['Example Street 1', '10115 Berlin'],
    vatId: 'DE123456789',
    email: 'billing@example.com',
  };

  it('should return initial state for unknown action', () => {
    expect(publicWithdrawalReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(initialPublicWithdrawalState);
  });

  it('should set addressee loading on loadPublicWithdrawalAddressee', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, addresseeError: 'Previous error' },
      loadPublicWithdrawalAddressee(),
    );

    expect(state.addresseeLoading).toBe(true);
    expect(state.addresseeError).toBeNull();
  });

  it('should store addressee on loadPublicWithdrawalAddresseeSuccess', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, addresseeLoading: true },
      loadPublicWithdrawalAddresseeSuccess({ addressee: mockAddressee }),
    );

    expect(state.addressee).toEqual(mockAddressee);
    expect(state.addresseeLoading).toBe(false);
    expect(state.addresseeError).toBeNull();
  });

  it('should store addressee error on loadPublicWithdrawalAddresseeFailure', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, addresseeLoading: true },
      loadPublicWithdrawalAddresseeFailure({ error: 'Unavailable' }),
    );

    expect(state.addresseeLoading).toBe(false);
    expect(state.addresseeError).toBe('Unavailable');
  });

  it('should set loading on requestPublicWithdrawal', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, error: 'old', successMessage: 'old' },
      requestPublicWithdrawal({
        dto: {
          subscriptionNumber: 'SUB-000001',
          customerName: 'Jane Doe',
          email: 'jane@example.com',
          orderedOn: '2024-01-01',
        },
      }),
    );

    expect(state.loading).toBe(true);
    expect(state.error).toBeNull();
    expect(state.successMessage).toBeNull();
  });

  it('should advance to code step on new request success', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, loading: true },
      requestPublicWithdrawalSuccess({
        response: {
          requestId: 'req-1',
          resumed: false,
          resumeStep: 'code',
          message: 'Check your email',
        },
      }),
    );

    expect(state.loading).toBe(false);
    expect(state.requestId).toBe('req-1');
    expect(state.resumed).toBe(false);
    expect(state.step).toBe('code');
    expect(state.successMessage).toBe('Check your email');
  });

  it('should resume directly to acknowledge step on request success', () => {
    const state = publicWithdrawalReducer(
      initialPublicWithdrawalState,
      requestPublicWithdrawalSuccess({
        response: {
          requestId: 'req-2',
          resumed: true,
          resumeStep: 'acknowledge',
          message: 'Continue where you left off',
        },
      }),
    );

    expect(state.step).toBe('acknowledge');
    expect(state.resumed).toBe(true);
  });

  it('should store request error on requestPublicWithdrawalFailure', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, loading: true },
      requestPublicWithdrawalFailure({ error: 'No match' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('No match');
  });

  it('should set verifying on verifyPublicWithdrawalCode', () => {
    const state = publicWithdrawalReducer(
      initialPublicWithdrawalState,
      verifyPublicWithdrawalCode({ dto: { requestId: 'req-1', code: 'ABC123' } }),
    );

    expect(state.verifying).toBe(true);
    expect(state.error).toBeNull();
  });

  it('should advance to acknowledge on verifyPublicWithdrawalCodeSuccess', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, verifying: true, step: 'code' },
      verifyPublicWithdrawalCodeSuccess({ message: 'Code verified' }),
    );

    expect(state.verifying).toBe(false);
    expect(state.step).toBe('acknowledge');
    expect(state.successMessage).toBe('Code verified');
  });

  it('should store verify error on verifyPublicWithdrawalCodeFailure', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, verifying: true },
      verifyPublicWithdrawalCodeFailure({ error: 'Invalid code' }),
    );

    expect(state.verifying).toBe(false);
    expect(state.error).toBe('Invalid code');
  });

  it('should set confirming on confirmPublicWithdrawal', () => {
    const state = publicWithdrawalReducer(
      initialPublicWithdrawalState,
      confirmPublicWithdrawal({ dto: { requestId: 'req-1', acknowledgeWithdrawal: true } }),
    );

    expect(state.confirming).toBe(true);
    expect(state.error).toBeNull();
  });

  it('should advance to done on confirmPublicWithdrawalSuccess', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, confirming: true, step: 'acknowledge' },
      confirmPublicWithdrawalSuccess({ response: { message: 'Withdrawal submitted' } }),
    );

    expect(state.confirming).toBe(false);
    expect(state.step).toBe('done');
    expect(state.successMessage).toBe('Withdrawal submitted');
  });

  it('should store confirm error on confirmPublicWithdrawalFailure', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, confirming: true },
      confirmPublicWithdrawalFailure({ error: 'Policy blocked' }),
    );

    expect(state.confirming).toBe(false);
    expect(state.error).toBe('Policy blocked');
  });

  it('should clear error on clearPublicWithdrawalError', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, error: 'Error' },
      clearPublicWithdrawalError(),
    );

    expect(state.error).toBeNull();
  });

  it('should clear success message on clearPublicWithdrawalSuccessMessage', () => {
    const state = publicWithdrawalReducer(
      { ...initialPublicWithdrawalState, successMessage: 'Done' },
      clearPublicWithdrawalSuccessMessage(),
    );

    expect(state.successMessage).toBeNull();
  });

  it('should reset to initial state on resetPublicWithdrawal', () => {
    const dirtyState = {
      ...initialPublicWithdrawalState,
      step: 'done' as const,
      requestId: 'req-1',
      resumed: true,
      addressee: mockAddressee,
    };

    expect(publicWithdrawalReducer(dirtyState, resetPublicWithdrawal())).toEqual(initialPublicWithdrawalState);
  });
});
