import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { MetricsService } from '../../services/metrics.service';
import type { MetricQuery } from '../../types/metrics.types';
import {
  loadMetricEventsSuccess,
  loadMetricNames,
  loadMetricNamesSuccess,
  queryMetrics,
  queryMetricsSuccess,
} from './metrics.actions';
import { loadMetricEvents$, loadMetricNames$, queryMetrics$ } from './metrics.effects';
import { consoleMetricsReducer, initialConsoleMetricsState } from './metrics.reducer';

const query: MetricQuery = {
  metric: 'replica.memory_bytes',
  from: '2026-10-18T08:00:00.000Z',
  to: '2026-10-18T09:00:00.000Z',
  groupBy: 'entity',
};
const result = { step: '10 seconds', series: [{ key: 'shop/web/api/0', points: [['2026-10-18T08:00:00.000Z', 1]] }] };

describe('console metrics state', () => {
  it('keeps the shown series while the same metric reloads and ignores stale answers', () => {
    const shown = consoleMetricsReducer(
      consoleMetricsReducer(initialConsoleMetricsState, queryMetrics({ query })),
      queryMetricsSuccess({ query, result: result as never }),
    );
    const reloading = consoleMetricsReducer(shown, queryMetrics({ query: { ...query, groupBy: 'node' } }));

    expect(reloading).toMatchObject({ loading: true, result });
    expect(consoleMetricsReducer(reloading, queryMetricsSuccess({ query, result: result as never }))).toBe(reloading);
    expect(consoleMetricsReducer(shown, queryMetrics({ query: { metric: 'node.cpu_cores' } })).result).toBeNull();
  });

  it('loads names, series and the event markers of the range', async () => {
    const service = {
      names: jest.fn().mockReturnValue(of(['node.cpu_cores'])),
      query: jest.fn().mockReturnValue(of(result)),
      events: jest.fn().mockReturnValue(throwError(() => new Error('no events'))),
    };

    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadMetricNames()))] });
    expect(
      await firstValueFrom(loadMetricNames$(TestBed.inject(Actions), service as unknown as MetricsService)),
    ).toEqual(loadMetricNamesSuccess({ names: ['node.cpu_cores'] }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(queryMetrics({ query })))] });
    expect(await firstValueFrom(queryMetrics$(TestBed.inject(Actions), service as unknown as MetricsService))).toEqual(
      queryMetricsSuccess({ query, result: result as never }),
    );
    expect(
      await firstValueFrom(loadMetricEvents$(TestBed.inject(Actions), service as unknown as MetricsService)),
    ).toEqual(loadMetricEventsSuccess({ events: [] }));
    expect(service.events).toHaveBeenCalledWith({ from: query.from, to: query.to, project: undefined, limit: 200 });
  });
});
