import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { ConsoleUsageService, usageParams } from '../../services/usage.service';
import type { UsageQuery, UsageReport } from '../../types/usage.types';
import { loadUsage, loadUsageFailure, loadUsageSuccess } from './usage.actions';
import { loadUsage$ } from './usage.effects';
import { consoleUsageReducer, initialConsoleUsageState } from './usage.reducer';

const report: UsageReport = {
  cluster: 'lab',
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-20T12:00:00.000Z',
  granularity: 'day',
  meters: [{ key: 'cpu_core_hours', unit: 'core-hours', description: 'CPU' }],
  rows: [{ project: 'shop', bucket: '2026-10-01T00:00:00.000Z', meter: 'cpu_core_hours', value: 2, final: true }],
  totals: [{ project: 'shop', meter: 'cpu_core_hours', value: 2 }],
  truncated: false,
};

describe('console usage state (3.24)', () => {
  it('keeps the answer of the current query only', () => {
    const first: UsageQuery = { project: 'shop', granularity: 'day' };
    const second: UsageQuery = { project: 'blog', granularity: 'day' };
    let state = consoleUsageReducer(initialConsoleUsageState, loadUsage({ query: first }));

    state = consoleUsageReducer(state, loadUsage({ query: second }));
    expect(consoleUsageReducer(state, loadUsageSuccess({ query: first, report }))).toBe(state);

    state = consoleUsageReducer(state, loadUsageSuccess({ query: second, report }));
    expect(state).toMatchObject({ report, loading: false, error: null });
    expect(consoleUsageReducer(state, loadUsage({ query: first }))).toMatchObject({ loading: true, report });
  });

  it('builds query parameters without the project', () => {
    expect(usageParams({ project: 'shop', granularity: 'hour', from: '2026-10-20T00:00:00.000Z' }).toString()).toBe(
      'granularity=hour&from=2026-10-20T00:00:00.000Z',
    );
  });

  it('loads usage and reports errors', async () => {
    const query: UsageQuery = { project: null, granularity: 'day' };
    const service = {
      report: jest
        .fn()
        .mockReturnValueOnce(of(report))
        .mockReturnValueOnce(
          throwError(
            () => new HttpErrorResponse({ status: 403, error: { message: 'cluster-wide usage needs a cluster role' } }),
          ),
        ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadUsage({ query }), loadUsage({ query }))),
        { provide: ConsoleUsageService, useValue: service },
      ],
    });

    expect(await firstValueFrom(TestBed.runInInjectionContext(() => loadUsage$()).pipe(toArray()))).toEqual([
      loadUsageSuccess({ query, report }),
      loadUsageFailure({ query, error: 'cluster-wide usage needs a cluster role' }),
    ]);
  });
});
