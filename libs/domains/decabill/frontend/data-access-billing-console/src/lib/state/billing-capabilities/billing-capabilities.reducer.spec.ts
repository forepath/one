import {
  loadBillingCapabilities,
  loadBillingCapabilitiesFailure,
  loadBillingCapabilitiesSuccess,
} from './billing-capabilities.actions';
import { billingCapabilitiesReducer, initialBillingCapabilitiesState } from './billing-capabilities.reducer';

describe('billingCapabilitiesReducer', () => {
  it('stores capabilities on success', () => {
    const state = billingCapabilitiesReducer(
      { ...initialBillingCapabilitiesState, loading: true },
      loadBillingCapabilitiesSuccess({
        capabilities: { datevExportEnabled: true, unifiedExportAllowed: false },
      }),
    );

    expect(state.capabilities?.datevExportEnabled).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('stores error on failure', () => {
    const state = billingCapabilitiesReducer(
      initialBillingCapabilitiesState,
      loadBillingCapabilitiesFailure({ error: 'failed' }),
    );

    expect(state.error).toBe('failed');
    expect(state.loading).toBe(false);
  });

  it('sets loading on load', () => {
    const state = billingCapabilitiesReducer(initialBillingCapabilitiesState, loadBillingCapabilities());

    expect(state.loading).toBe(true);
  });
});
