import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { RunReport } from '../../types/reports.types';
import { clearReportRunResult, loadReports, openReportFolder, runReport } from './reports.actions';
import {
  selectReportEntries,
  selectReportEntriesError,
  selectReportEntriesLoading,
  selectReportPath,
  selectReportQueued,
  selectReportRunError,
  selectReportRunning,
  selectReports,
  selectReportsError,
  selectReportsLoading,
} from './reports.selectors';

@Injectable()
export class ConsoleReportsFacade {
  private readonly store = inject(Store);

  readonly reports$ = this.store.select(selectReports);
  readonly loading$ = this.store.select(selectReportsLoading);
  readonly error$ = this.store.select(selectReportsError);
  readonly running$ = this.store.select(selectReportRunning);
  readonly queued$ = this.store.select(selectReportQueued);
  readonly runError$ = this.store.select(selectReportRunError);
  readonly path$ = this.store.select(selectReportPath);
  readonly entries$ = this.store.select(selectReportEntries);
  readonly entriesLoading$ = this.store.select(selectReportEntriesLoading);
  readonly entriesError$ = this.store.select(selectReportEntriesError);

  load(silent = false): void {
    this.store.dispatch(loadReports({ silent }));
  }

  run(report: RunReport): void {
    this.store.dispatch(runReport({ report }));
  }

  openFolder(path: string): void {
    this.store.dispatch(openReportFolder({ path }));
  }

  clearRunResult(): void {
    this.store.dispatch(clearReportRunResult());
  }
}
