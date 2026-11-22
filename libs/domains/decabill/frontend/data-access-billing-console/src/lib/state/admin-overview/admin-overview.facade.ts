import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { AdminOverviewParams } from '../../types/admin-overview.types';

import { loadAdminOverview } from './admin-overview.actions';
import {
  selectAdminOverview,
  selectAdminOverviewError,
  selectAdminOverviewLoading,
  selectAdminOverviewParams,
} from './admin-overview.selectors';

@Injectable()
export class AdminOverviewFacade {
  private readonly store = inject(Store);

  readonly overview$ = this.store.select(selectAdminOverview);
  readonly params$ = this.store.select(selectAdminOverviewParams);
  readonly loading$ = this.store.select(selectAdminOverviewLoading);
  readonly error$ = this.store.select(selectAdminOverviewError);

  load(params: AdminOverviewParams): void {
    this.store.dispatch(loadAdminOverview({ params }));
  }
}
