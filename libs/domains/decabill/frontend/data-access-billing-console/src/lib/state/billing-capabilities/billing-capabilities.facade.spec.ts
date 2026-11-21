import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom } from 'rxjs';

import { loadBillingCapabilities } from './billing-capabilities.actions';
import { BillingCapabilitiesFacade } from './billing-capabilities.facade';
import { initialBillingCapabilitiesState } from './billing-capabilities.reducer';

describe('BillingCapabilitiesFacade', () => {
  let facade: BillingCapabilitiesFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BillingCapabilitiesFacade,
        provideMockStore({
          initialState: {
            billingCapabilities: {
              ...initialBillingCapabilitiesState,
              capabilities: {
                datevExportEnabled: false,
                unifiedExportAllowed: false,
                globalViewsAllowed: true,
                viewableTenants: ['default'],
                fileSigningEnabled: false,
                accountingEnabled: true,
                accountingGlobalAccess: true,
                accountingCountry: 'DE',
                accountingMissingPrerequisites: [],
                einvoiceFormats: [{ format: 'xrechnung-cii', label: 'XRechnung 3.0 (CII)' }],
                einvoiceDefaultFormat: 'factur-x-en16931',
              },
            },
          },
        }),
      ],
    });
    facade = TestBed.inject(BillingCapabilitiesFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('loadCapabilities dispatches loadBillingCapabilities', () => {
    facade.loadCapabilities();

    expect(store.dispatch).toHaveBeenCalledWith(loadBillingCapabilities());
  });

  it('exposes accounting and e-invoice capabilities', async () => {
    expect(await firstValueFrom(facade.accountingEnabled$)).toBe(true);
    expect(await firstValueFrom(facade.accountingGlobalAccess$)).toBe(true);
    expect(await firstValueFrom(facade.einvoiceFormats$)).toEqual([
      { format: 'xrechnung-cii', label: 'XRechnung 3.0 (CII)' },
    ]);
    expect(await firstValueFrom(facade.einvoiceDefaultFormat$)).toBe('factur-x-en16931');
  });
});
