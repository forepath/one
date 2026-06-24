import { initialBillingCapabilitiesState, type BillingCapabilitiesState } from './billing-capabilities.reducer';
import {
  selectBillingCapabilities,
  selectBillingCapabilitiesLoading,
  selectBillingCapabilitiesState,
  selectDatevExportEnabled,
  selectUnifiedExportAllowed,
} from './billing-capabilities.selectors';

describe('BillingCapabilities Selectors', () => {
  const createState = (overrides?: Partial<BillingCapabilitiesState>): BillingCapabilitiesState => ({
    ...initialBillingCapabilitiesState,
    ...overrides,
  });

  it('selects feature state and capabilities', () => {
    const state = createState({
      capabilities: { datevExportEnabled: true, unifiedExportAllowed: true },
    });
    const rootState = { billingCapabilities: state };

    expect(selectBillingCapabilitiesState(rootState as never)).toEqual(state);
    expect(selectBillingCapabilities(rootState as never)).toEqual({
      datevExportEnabled: true,
      unifiedExportAllowed: true,
    });
  });

  it('defaults capability flags when capabilities are missing', () => {
    const rootState = { billingCapabilities: createState() };

    expect(selectDatevExportEnabled(rootState as never)).toBe(false);
    expect(selectUnifiedExportAllowed(rootState as never)).toBe(false);
  });

  it('selects loading state', () => {
    const rootState = { billingCapabilities: createState({ loading: true }) };

    expect(selectBillingCapabilitiesLoading(rootState as never)).toBe(true);
  });
});
