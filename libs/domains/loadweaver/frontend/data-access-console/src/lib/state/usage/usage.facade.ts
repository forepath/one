import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { UsageQuery } from '../../types/usage.types';
import { loadUsage } from './usage.actions';
import { selectUsageError, selectUsageLoading, selectUsageQuery, selectUsageReport } from './usage.selectors';

@Injectable()
export class ConsoleUsageFacade {
  private readonly store = inject(Store);

  readonly query$ = this.store.select(selectUsageQuery);
  readonly report$ = this.store.select(selectUsageReport);
  readonly loading$ = this.store.select(selectUsageLoading);
  readonly error$ = this.store.select(selectUsageError);

  load(query: UsageQuery): void {
    this.store.dispatch(loadUsage({ query }));
  }
}
