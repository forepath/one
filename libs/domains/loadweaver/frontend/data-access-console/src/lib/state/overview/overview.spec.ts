import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of } from 'rxjs';

import { OverviewService } from '../../services/overview.service';
import type { Overview } from '../../types/console.types';
import { loadOverview, loadOverviewSuccess } from './overview.actions';
import { loadOverview$ } from './overview.effects';
import { consoleOverviewReducer, initialConsoleOverviewState } from './overview.reducer';
import { selectCriticalInboxCount } from './overview.selectors';

const overview: Overview = {
  headline: { state: 'at-risk', message: 'one member down', key: 'cluster' },
  inbox: [
    { kind: 'rollback-failed', severity: 'critical', title: 'Rollback failed', link: '/plans/1' },
    { kind: 'drift', severity: 'warning', title: 'Drift', link: '/drift' },
  ],
  summary: {
    sites: 2,
    nodes: { total: 3, up: 2 },
    deployments: 4,
    capacity: null,
    requestsPerSecond: null,
    deniedPackets5m: 0,
    alertsFiring: 1,
    slos: { total: 0, ok: 0, burning: 0, exhausted: 0 },
  },
  activity: [],
};

describe('console overview state', () => {
  it('keeps the numbers on a silent refresh of the same scope, drops them for another scope', () => {
    const loaded = consoleOverviewReducer(initialConsoleOverviewState, loadOverviewSuccess({ overview }));
    const refreshed = consoleOverviewReducer(loaded, loadOverview({ silent: true }));
    const otherScope = consoleOverviewReducer(loaded, loadOverview({ project: 'shop' }));

    expect(refreshed).toMatchObject({ overview, loading: false });
    expect(otherScope).toMatchObject({ overview: null, project: 'shop', loading: true });
  });

  it('counts critical inbox items', () => {
    expect(selectCriticalInboxCount({ consoleOverview: { ...initialConsoleOverviewState, overview } })).toBe(1);
  });

  it('loads the overview for a project', async () => {
    const service = { overview: jest.fn().mockReturnValue(of(overview)) };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadOverview({ project: 'shop' }))),
        { provide: OverviewService, useValue: service },
      ],
    });

    expect(await firstValueFrom(loadOverview$(TestBed.inject(Actions), service as unknown as OverviewService))).toEqual(
      loadOverviewSuccess({ overview }),
    );
    expect(service.overview).toHaveBeenCalledWith('shop');
  });
});
