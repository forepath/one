import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { LogFilter } from '../../types/logs.types';
import { clearLogsTail, nextLogsPage, previousLogsPage, searchLogs, startLogsTail, stopLogsTail } from './logs.actions';
import {
  selectLogLines,
  selectLogsError,
  selectLogsFilter,
  selectLogsHasNext,
  selectLogsHasPrevious,
  selectLogsLoading,
  selectLogsPage,
  selectLogsTail,
  selectLogsTailConnected,
  selectLogsTailError,
  selectLogsTailing,
} from './logs.selectors';

@Injectable()
export class ConsoleLogsFacade {
  private readonly store = inject(Store);

  readonly filter$ = this.store.select(selectLogsFilter);
  readonly lines$ = this.store.select(selectLogLines);
  readonly page$ = this.store.select(selectLogsPage);
  readonly hasNext$ = this.store.select(selectLogsHasNext);
  readonly hasPrevious$ = this.store.select(selectLogsHasPrevious);
  readonly loading$ = this.store.select(selectLogsLoading);
  readonly error$ = this.store.select(selectLogsError);
  readonly tailing$ = this.store.select(selectLogsTailing);
  readonly tailConnected$ = this.store.select(selectLogsTailConnected);
  readonly tailError$ = this.store.select(selectLogsTailError);
  readonly tail$ = this.store.select(selectLogsTail);

  /** Newest first; give `from` / `to` so paging stays on the same range. */
  search(filter: LogFilter, limit = 100): void {
    this.store.dispatch(searchLogs({ filter, limit }));
  }

  /** Older lines. */
  next(): void {
    this.store.dispatch(nextLogsPage());
  }

  previous(): void {
    this.store.dispatch(previousLogsPage());
  }

  startTail(filter: LogFilter): void {
    this.store.dispatch(startLogsTail({ filter }));
  }

  stopTail(): void {
    this.store.dispatch(stopLogsTail());
  }

  clearTail(): void {
    this.store.dispatch(clearLogsTail());
  }
}
