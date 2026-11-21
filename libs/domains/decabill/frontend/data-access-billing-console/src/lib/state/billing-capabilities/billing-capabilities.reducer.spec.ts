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
        capabilities: {
          datevExportEnabled: true,
          unifiedExportAllowed: false,
          globalViewsAllowed: false,
          viewableTenants: ['default'],
          fileSigningEnabled: true,
          accountingEnabled: true,
          accountingGlobalAccess: false,
          accountingCountry: 'DE',
          accountingMissingPrerequisites: [],
          einvoiceFormats: [{ format: 'factur-x-en16931', label: 'Factur-X / ZUGFeRD EN 16931' }],
          einvoiceDefaultFormat: 'factur-x-en16931',
        },
      }),
    );

    expect(state.capabilities?.datevExportEnabled).toBe(true);
    expect(state.capabilities?.fileSigningEnabled).toBe(true);
    expect(state.capabilities?.accountingEnabled).toBe(true);
    expect(state.capabilities?.einvoiceDefaultFormat).toBe('factur-x-en16931');
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
