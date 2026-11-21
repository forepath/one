import { initialBillingCapabilitiesState, type BillingCapabilitiesState } from './billing-capabilities.reducer';
import {
  selectAccountingEnabled,
  selectAccountingGlobalAccess,
  selectBillingCapabilities,
  selectBillingCapabilitiesLoading,
  selectBillingCapabilitiesState,
  selectDatevExportEnabled,
  selectEinvoiceDefaultFormat,
  selectEinvoiceFormats,
  selectGlobalViewsAllowed,
  selectUnifiedExportAllowed,
  selectViewableTenants,
} from './billing-capabilities.selectors';

describe('BillingCapabilities Selectors', () => {
  const createState = (overrides?: Partial<BillingCapabilitiesState>): BillingCapabilitiesState => ({
    ...initialBillingCapabilitiesState,
    ...overrides,
  });

  it('selects feature state and capabilities', () => {
    const state = createState({
      capabilities: {
        datevExportEnabled: true,
        unifiedExportAllowed: true,
        globalViewsAllowed: true,
        viewableTenants: ['default', 'acme'],
      },
    });
    const rootState = { billingCapabilities: state };

    expect(selectBillingCapabilitiesState(rootState as never)).toEqual(state);
    expect(selectBillingCapabilities(rootState as never)).toEqual({
      datevExportEnabled: true,
      unifiedExportAllowed: true,
      globalViewsAllowed: true,
      viewableTenants: ['default', 'acme'],
    });
  });

  it('defaults capability flags when capabilities are missing', () => {
    const rootState = { billingCapabilities: createState() };

    expect(selectDatevExportEnabled(rootState as never)).toBe(false);
    expect(selectUnifiedExportAllowed(rootState as never)).toBe(false);
    expect(selectGlobalViewsAllowed(rootState as never)).toBe(false);
    expect(selectViewableTenants(rootState as never)).toEqual([]);
    expect(selectAccountingEnabled(rootState as never)).toBe(false);
    expect(selectAccountingGlobalAccess(rootState as never)).toBe(false);
    expect(selectEinvoiceFormats(rootState as never)).toEqual([]);
    expect(selectEinvoiceDefaultFormat(rootState as never)).toBeNull();
  });

  it('selects accounting and e-invoice capabilities', () => {
    const rootState = {
      billingCapabilities: createState({
        capabilities: {
          datevExportEnabled: false,
          unifiedExportAllowed: false,
          globalViewsAllowed: false,
          viewableTenants: ['default'],
          fileSigningEnabled: false,
          accountingEnabled: true,
          accountingGlobalAccess: false,
          accountingCountry: 'DE',
          accountingMissingPrerequisites: [],
          einvoiceFormats: [{ format: 'peppol-bis-3', label: 'Peppol BIS Billing 3.0 (UBL)' }],
          einvoiceDefaultFormat: 'factur-x-en16931',
        },
      }),
    };

    expect(selectAccountingEnabled(rootState as never)).toBe(true);
    expect(selectAccountingGlobalAccess(rootState as never)).toBe(false);
    expect(selectEinvoiceFormats(rootState as never)).toEqual([
      { format: 'peppol-bis-3', label: 'Peppol BIS Billing 3.0 (UBL)' },
    ]);
    expect(selectEinvoiceDefaultFormat(rootState as never)).toBe('factur-x-en16931');
  });

  it('selects loading state', () => {
    const rootState = { billingCapabilities: createState({ loading: true }) };

    expect(selectBillingCapabilitiesLoading(rootState as never)).toBe(true);
  });
});
