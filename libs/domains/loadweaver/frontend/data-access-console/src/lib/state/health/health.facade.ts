import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { loadHealthEntity, loadHealthHistory, loadHealthTree } from './health.actions';
import {
  selectHealthDetailChildren,
  selectHealthDetailEntity,
  selectHealthDetailError,
  selectHealthDetailLoading,
  selectHealthError,
  selectHealthHistory,
  selectHealthHistoryError,
  selectHealthHistoryLoading,
  selectHealthLoading,
  selectHealthProject,
  selectHealthTree,
} from './health.selectors';

@Injectable()
export class ConsoleHealthFacade {
  private readonly store = inject(Store);

  readonly tree$ = this.store.select(selectHealthTree);
  readonly loading$ = this.store.select(selectHealthLoading);
  readonly error$ = this.store.select(selectHealthError);
  readonly project$ = this.store.select(selectHealthProject);
  readonly entity$ = this.store.select(selectHealthDetailEntity);
  readonly children$ = this.store.select(selectHealthDetailChildren);
  readonly entityLoading$ = this.store.select(selectHealthDetailLoading);
  readonly entityError$ = this.store.select(selectHealthDetailError);
  readonly history$ = this.store.select(selectHealthHistory);
  readonly historyLoading$ = this.store.select(selectHealthHistoryLoading);
  readonly historyError$ = this.store.select(selectHealthHistoryError);

  /** `silent`: refresh without the loading state (periodic refresh). */
  loadTree(project?: string, silent = false): void {
    this.store.dispatch(loadHealthTree({ project, silent }));
  }

  loadEntity(key: string, silent = false): void {
    this.store.dispatch(loadHealthEntity({ key, silent }));
  }

  /** Default range: the last 30 days. */
  loadHistory(key: string, from?: string, to?: string): void {
    this.store.dispatch(loadHealthHistory({ key, from, to }));
  }
}
