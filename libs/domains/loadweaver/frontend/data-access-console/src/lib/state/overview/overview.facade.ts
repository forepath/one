import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { loadOverview } from './overview.actions';
import {
  selectCriticalInboxCount,
  selectInbox,
  selectOverview,
  selectOverviewError,
  selectOverviewLoading,
  selectOverviewProject,
} from './overview.selectors';

@Injectable()
export class ConsoleOverviewFacade {
  private readonly store = inject(Store);

  readonly overview$ = this.store.select(selectOverview);
  readonly loading$ = this.store.select(selectOverviewLoading);
  readonly error$ = this.store.select(selectOverviewError);
  readonly project$ = this.store.select(selectOverviewProject);
  readonly inbox$ = this.store.select(selectInbox);
  readonly criticalInboxCount$ = this.store.select(selectCriticalInboxCount);

  /** `silent`: refresh without the loading state (periodic refresh). */
  load(project?: string, silent = false): void {
    this.store.dispatch(loadOverview({ project, silent }));
  }
}
