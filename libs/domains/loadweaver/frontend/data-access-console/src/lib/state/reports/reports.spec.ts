import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { ReportsService } from '../../services/reports.service';
import type { Report } from '../../types/reports.types';
import {
  loadReports,
  loadReportsSuccess,
  openReportFolder,
  openReportFolderFailure,
  openReportFolderSuccess,
  runReport,
  runReportFailure,
  runReportSuccess,
} from './reports.actions';
import { openReportFolder$, reloadReportsAfterRun$, runReport$ } from './reports.effects';
import { consoleReportsReducer, initialConsoleReportsState } from './reports.reducer';
import { selectReportEntries, selectReports } from './reports.selectors';

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r1',
    scope: 'cluster',
    year: 2026,
    month: 9,
    status: 'completed',
    files: [{ name: 'report.html', path: 'cluster/2026/09/report.html', bytes: 1200, sha256: 'abc' }],
    error: null,
    completedAt: '2026-10-01T03:01:00.000Z',
    ...overrides,
  };
}

describe('console reports state', () => {
  it('sorts runs newest first with the cluster first and folders before files', () => {
    let state = consoleReportsReducer(
      initialConsoleReportsState,
      loadReportsSuccess({
        reports: [
          report({ id: 'a', scope: 'shop', month: 9 }),
          report({ id: 'b', scope: 'cluster', month: 8 }),
          report({ id: 'c', scope: 'cluster', month: 9 }),
        ],
      }),
    );

    state = consoleReportsReducer(state, openReportFolder({ path: 'cluster/2026' }));
    state = consoleReportsReducer(
      state,
      openReportFolderSuccess({
        path: 'cluster/2026',
        entries: [
          { name: 'summary.json', path: 'cluster/2026/summary.json', type: 'file' },
          { name: '09', path: 'cluster/2026/09', type: 'folder' },
        ],
      }),
    );

    expect(selectReports({ consoleReports: state }).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(selectReportEntries({ consoleReports: state }).map((e) => e.name)).toEqual(['09', 'summary.json']);
  });

  it('ignores a folder answer for another path', () => {
    const opened = consoleReportsReducer(initialConsoleReportsState, openReportFolder({ path: 'projects' }));
    const stale = consoleReportsReducer(
      opened,
      openReportFolderSuccess({ path: '', entries: [{ name: 'cluster', path: 'cluster', type: 'folder' }] }),
    );

    expect(stale.entries).toEqual([]);
    expect(stale.entriesLoading).toBe(true);
  });

  it('tracks a run and its result', () => {
    const run = { scope: 'shop', year: 2026, month: 9 };
    const running = consoleReportsReducer(initialConsoleReportsState, runReport({ report: run }));

    expect(running.running).toBe(true);
    expect(consoleReportsReducer(running, runReportSuccess({ report: run })).queued).toEqual(run);
    expect(consoleReportsReducer(running, runReportFailure({ error: 'only finished months' })).runError).toBe(
      'only finished months',
    );
    expect(consoleReportsReducer(initialConsoleReportsState, loadReports({ silent: true })).loading).toBe(false);
  });

  it('runs a report and reloads the list', async () => {
    const run = { scope: 'cluster', year: 2026, month: 9 };
    const service = {
      run: jest
        .fn()
        .mockReturnValueOnce(of(undefined))
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'admin role required' } })),
        ),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(runReport({ report: run }), runReport({ report: run })))],
    });

    expect(
      await firstValueFrom(runReport$(TestBed.inject(Actions), service as unknown as ReportsService).pipe(toArray())),
    ).toEqual([runReportSuccess({ report: run }), runReportFailure({ error: 'admin role required' })]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(runReportSuccess({ report: run })))] });
    expect(await firstValueFrom(reloadReportsAfterRun$(TestBed.inject(Actions)))).toEqual(
      loadReports({ silent: true }),
    );
  });

  it('reads a folder', async () => {
    const service = {
      files: jest.fn((path: string) =>
        path === 'cluster'
          ? of([{ name: '2026', path: 'cluster/2026', type: 'folder' }])
          : throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'invalid path' } })),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(openReportFolder({ path: 'cluster' }), openReportFolder({ path: '..' }))),
      ],
    });

    expect(
      await firstValueFrom(
        openReportFolder$(TestBed.inject(Actions), service as unknown as ReportsService).pipe(toArray()),
      ),
    ).toEqual([
      openReportFolderSuccess({ path: 'cluster', entries: [{ name: '2026', path: 'cluster/2026', type: 'folder' }] }),
      openReportFolderFailure({ path: '..', error: 'invalid path' }),
    ]);
  });
});
