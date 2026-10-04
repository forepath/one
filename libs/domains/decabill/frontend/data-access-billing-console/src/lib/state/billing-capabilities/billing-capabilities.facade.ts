import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { loadBillingCapabilities } from './billing-capabilities.actions';
import {
  selectBillingCapabilities,
  selectBillingCapabilitiesLoading,
  selectDatevExportEnabled,
  selectFileSigningEnabled,
  selectGlobalViewsAllowed,
  selectUnifiedExportAllowed,
  selectViewableTenants,
} from './billing-capabilities.selectors';

@Injectable()
export class BillingCapabilitiesFacade {
  private readonly store = inject(Store);

  readonly capabilities$ = this.store.select(selectBillingCapabilities);
  readonly datevExportEnabled$ = this.store.select(selectDatevExportEnabled);
  readonly unifiedExportAllowed$ = this.store.select(selectUnifiedExportAllowed);
  readonly globalViewsAllowed$ = this.store.select(selectGlobalViewsAllowed);
  readonly viewableTenants$ = this.store.select(selectViewableTenants);
  readonly fileSigningEnabled$ = this.store.select(selectFileSigningEnabled);
  readonly loading$ = this.store.select(selectBillingCapabilitiesLoading);

  loadCapabilities(): void {
    this.store.dispatch(loadBillingCapabilities());
  }
}
