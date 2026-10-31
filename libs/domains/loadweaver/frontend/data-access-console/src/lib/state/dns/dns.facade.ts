import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { clearDnsActionError, confirmDnsFailback, loadDns } from './dns.actions';
import {
  selectDnsActionError,
  selectDnsConfirming,
  selectDnsErrors,
  selectDnsLoading,
  selectDnsOverview,
  selectDnsZoneRows,
} from './dns.selectors';

@Injectable()
export class ConsoleDnsFacade {
  private readonly store = inject(Store);

  readonly overview$ = this.store.select(selectDnsOverview);
  readonly zoneRows$ = this.store.select(selectDnsZoneRows);
  readonly loading$ = this.store.select(selectDnsLoading);
  readonly errors$ = this.store.select(selectDnsErrors);
  readonly confirming$ = this.store.select(selectDnsConfirming);
  readonly actionError$ = this.store.select(selectDnsActionError);

  /** `infrastructure`: the caller has a cluster role (zones, DNSSEC, failovers, providers). */
  load(infrastructure: boolean, silent = false): void {
    this.store.dispatch(loadDns({ infrastructure, silent }));
  }

  confirmFailback(name: string): void {
    this.store.dispatch(confirmDnsFailback({ name }));
  }

  clearActionError(): void {
    this.store.dispatch(clearDnsActionError());
  }
}
