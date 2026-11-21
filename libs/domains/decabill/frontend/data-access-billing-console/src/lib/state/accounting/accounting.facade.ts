import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import type { Observable } from 'rxjs';

import {
  type AccountingMutation,
  type AccountingRequest,
  type AccountingResourceKey,
  type AccountingResourceMap,
  clearAccountingMutation,
  clearAccountingResource,
  loadAccountingResource,
  runAccountingMutation,
  setAccountingViewTenant,
} from './accounting.actions';
import type { AccountingResource } from './accounting.reducer';
import {
  selectAccountingAccountIndex,
  selectAccountingCurrentFiscalYear,
  selectAccountingLastMutation,
  selectAccountingMutating,
  selectAccountingMutationError,
  selectAccountingMutationKind,
  selectAccountingResource,
  selectAccountingViewTenantId,
} from './accounting.selectors';

/**
 * Accounting state: one resource slice per read request kind (`load({ key, ... })` → `resource$(key)`), one
 * mutation pipeline (`mutate({ kind, ... })`, then the affected loaded resources reload) and the viewed tenant.
 */
@Injectable()
export class AccountingFacade {
  private readonly store = inject(Store);

  readonly viewTenantId$ = this.store.select(selectAccountingViewTenantId);
  readonly mutating$ = this.store.select(selectAccountingMutating);
  readonly mutationKind$ = this.store.select(selectAccountingMutationKind);
  readonly mutationError$ = this.store.select(selectAccountingMutationError);
  readonly lastMutation$ = this.store.select(selectAccountingLastMutation);
  readonly accountIndex$ = this.store.select(selectAccountingAccountIndex);
  readonly currentFiscalYear$ = this.store.select(selectAccountingCurrentFiscalYear);

  readonly overview$ = this.resource$('overview');
  readonly templates$ = this.resource$('templates');
  readonly charts$ = this.resource$('charts');
  readonly accounts$ = this.resource$('accounts');
  readonly accountDirectory$ = this.resource$('accountDirectory');
  readonly taxCodes$ = this.resource$('taxCodes');
  readonly fiscalYears$ = this.resource$('fiscalYears');
  readonly closePreview$ = this.resource$('closePreview');
  readonly fxRates$ = this.resource$('fxRates');
  readonly postingIssues$ = this.resource$('postingIssues');
  readonly journal$ = this.resource$('journal');
  readonly journalStatistics$ = this.resource$('journalStatistics');
  readonly entry$ = this.resource$('entry');
  readonly byLink$ = this.resource$('byLink');
  readonly trialBalance$ = this.resource$('trialBalance');
  readonly ledger$ = this.resource$('ledger');
  readonly openItems$ = this.resource$('openItems');
  readonly statement$ = this.resource$('statement');
  readonly vatDefinitions$ = this.resource$('vatDefinitions');
  readonly vatReturns$ = this.resource$('vatReturns');
  readonly vatStatistics$ = this.resource$('vatStatistics');
  readonly vatReturn$ = this.resource$('vatReturn');
  readonly financialAccounts$ = this.resource$('financialAccounts');
  readonly imports$ = this.resource$('imports');
  readonly importDetail$ = this.resource$('importDetail');
  readonly transactions$ = this.resource$('transactions');
  readonly bankStatistics$ = this.resource$('bankStatistics');
  readonly suggestions$ = this.resource$('suggestions');
  readonly csvPresets$ = this.resource$('csvPresets');
  readonly csvMappings$ = this.resource$('csvMappings');
  readonly matchRules$ = this.resource$('matchRules');
  readonly assets$ = this.resource$('assets');
  readonly asset$ = this.resource$('asset');
  readonly assetSchedule$ = this.resource$('assetSchedule');

  resource$<K extends AccountingResourceKey>(key: K): Observable<AccountingResource<AccountingResourceMap[K]>> {
    return this.store.select(selectAccountingResource(key));
  }

  /** Loads (replaces) one resource. */
  load(request: AccountingRequest): void {
    this.store.dispatch(loadAccountingResource({ request }));
  }

  /** Drops a resource and its request (closed detail, left page). */
  clear(key: AccountingResourceKey): void {
    this.store.dispatch(clearAccountingResource({ key }));
  }

  mutate(mutation: AccountingMutation): void {
    this.store.dispatch(runAccountingMutation({ mutation }));
  }

  clearMutation(): void {
    this.store.dispatch(clearAccountingMutation());
  }

  /** `null` = own tenant; another tenant id or `all` (global views only). Reloads tenant-scoped resources. */
  setViewTenant(viewTenantId: string | null): void {
    this.store.dispatch(setAccountingViewTenant({ viewTenantId }));
  }
}
