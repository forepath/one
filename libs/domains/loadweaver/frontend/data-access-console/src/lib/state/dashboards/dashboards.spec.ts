import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { DashboardsService } from '../../services/dashboards.service';
import type { DashboardResource } from '../../types/metrics.types';
import {
  dashboardWidgetFailure,
  dashboardWidgetSuccess,
  loadDashboardsSuccess,
  runDashboard,
} from './dashboards.actions';
import { runDashboard$ } from './dashboards.effects';
import { consoleDashboardsReducer, dashboardKey, initialConsoleDashboardsState } from './dashboards.reducer';
import { selectDashboards, selectSelectedDashboard } from './dashboards.selectors';

function dashboard(name: string, project: string | null, title = name): DashboardResource {
  return {
    apiVersion: 'loadweaver.com/v1',
    kind: 'Dashboard',
    metadata: { name, project },
    spec: {
      title,
      range: '24h',
      widgets: [
        { title: 'Memory', type: 'line', query: { metrics: { metric: 'replica.memory_bytes' } } },
        { title: 'Denied', type: 'table', query: { flows: { decision: 'denied' } } },
      ],
    },
  };
}

const filter = { from: '2026-10-18T00:00:00.000Z', to: '2026-10-18T06:00:00.000Z', project: 'shop' };

describe('console dashboards state', () => {
  it('runs a dashboard: widgets loading, results by index, stale results dropped', () => {
    const listed = consoleDashboardsReducer(
      initialConsoleDashboardsState,
      loadDashboardsSuccess({ dashboards: [dashboard('b', null, 'Zeta'), dashboard('a', 'shop', 'Alpha')] }),
    );
    const running = consoleDashboardsReducer(listed, runDashboard({ key: 'shop/a', filter }));
    const done = consoleDashboardsReducer(
      running,
      dashboardWidgetSuccess({ key: 'shop/a', index: 0, result: { kind: 'series', step: '1 minute', series: [] } }),
    );

    expect(selectDashboards({ consoleDashboards: listed }).map(dashboardKey)).toEqual(['shop/a', '/b']);
    expect(selectSelectedDashboard({ consoleDashboards: running })?.spec.title).toBe('Alpha');
    expect(running.widgets[1]).toEqual({ loading: true, result: null, error: null });
    expect(done.widgets[0]).toMatchObject({ loading: false, result: { kind: 'series' } });
    expect(consoleDashboardsReducer(done, dashboardWidgetFailure({ key: '/b', index: 0, error: 'x' }))).toBe(done);
  });

  it('queries every widget in the filter', async () => {
    const service = {
      query: jest
        .fn()
        .mockReturnValueOnce(of({ kind: 'series', step: '1 minute', series: [] }))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'no flows' } }))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(runDashboard({ key: 'shop/a', filter }))),
        provideMockStore({
          initialState: {
            consoleDashboards: { ...initialConsoleDashboardsState, dashboards: [dashboard('a', 'shop')] },
          },
        }),
        { provide: DashboardsService, useValue: service },
      ],
    });

    const actions = await firstValueFrom(TestBed.runInInjectionContext(() => runDashboard$()).pipe(toArray()));

    expect(actions).toEqual([
      dashboardWidgetSuccess({ key: 'shop/a', index: 0, result: { kind: 'series', step: '1 minute', series: [] } }),
      dashboardWidgetFailure({ key: 'shop/a', index: 1, error: 'no flows' }),
    ]);
    expect(service.query).toHaveBeenCalledWith({
      query: { metrics: { metric: 'replica.memory_bytes' } },
      from: filter.from,
      to: filter.to,
      project: 'shop',
    });
  });
});
