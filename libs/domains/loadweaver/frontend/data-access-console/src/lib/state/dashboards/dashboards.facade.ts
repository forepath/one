import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { DashboardFilter } from '../../types/metrics.types';
import { loadDashboards, runDashboard } from './dashboards.actions';
import {
  selectDashboardFilter,
  selectDashboards,
  selectDashboardsError,
  selectDashboardsLoading,
  selectDashboardWidgets,
  selectSelectedDashboard,
  selectSelectedDashboardKey,
} from './dashboards.selectors';

@Injectable()
export class ConsoleDashboardsFacade {
  private readonly store = inject(Store);

  readonly dashboards$ = this.store.select(selectDashboards);
  readonly loading$ = this.store.select(selectDashboardsLoading);
  readonly error$ = this.store.select(selectDashboardsError);
  readonly selectedKey$ = this.store.select(selectSelectedDashboardKey);
  readonly selected$ = this.store.select(selectSelectedDashboard);
  readonly filter$ = this.store.select(selectDashboardFilter);
  readonly widgets$ = this.store.select(selectDashboardWidgets);

  load(): void {
    this.store.dispatch(loadDashboards());
  }

  run(key: string, filter: DashboardFilter): void {
    this.store.dispatch(runDashboard({ key, filter }));
  }
}
