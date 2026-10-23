import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { SlosService } from '../../services/slos.service';
import type { Slo } from '../../types/slos.types';
import { loadSlos, loadSlosFailure, loadSlosSuccess } from './slos.actions';
import { loadSlos$ } from './slos.effects';
import { consoleSlosReducer, initialConsoleSlosState } from './slos.reducer';
import { selectSloCounts } from './slos.selectors';

function slo(overrides: Partial<Slo> = {}): Slo {
  return {
    project: 'shop',
    deployment: 'web',
    service: 'api',
    hosts: ['api.example.com'],
    window: '30d',
    availability: { target: 99.9, sli: 99.97, budget: 0.1, consumed: 0.3, burnRate1h: 0.2, state: 'ok' },
    monthlyUptime: 99.98,
    state: 'ok',
    ...overrides,
  };
}

describe('console SLO state', () => {
  it('keeps the list on a silent refresh of the same project and drops it for another', () => {
    const loaded = consoleSlosReducer(
      consoleSlosReducer(initialConsoleSlosState, loadSlos({ project: null })),
      loadSlosSuccess({ slos: [slo()] }),
    );

    const refreshed = consoleSlosReducer(loaded, loadSlos({ project: null, silent: true }));

    expect(refreshed.slos).toHaveLength(1);
    expect(refreshed.loading).toBe(false);
    expect(consoleSlosReducer(loaded, loadSlos({ project: 'blog' })).slos).toEqual([]);
    expect(consoleSlosReducer(loaded, loadSlosFailure({ error: 'x' })).error).toBe('x');
  });

  it('counts per state', () => {
    const state = consoleSlosReducer(
      initialConsoleSlosState,
      loadSlosSuccess({
        slos: [slo(), slo({ service: 'b', state: 'burning' }), slo({ service: 'c', state: 'no-data' })],
      }),
    );

    expect(selectSloCounts({ consoleSlos: state })).toEqual({ total: 3, ok: 1, burning: 1, exhausted: 0, noData: 1 });
  });

  it('loads with the project filter and reports errors', () => {
    const service = {
      list: jest.fn((project?: string) =>
        project === 'shop'
          ? of([slo()])
          : throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'project not found' } })),
      ),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadSlos({ project: 'shop' }), loadSlos({ project: 'nope' })))],
    });

    const results: unknown[] = [];

    loadSlos$(TestBed.inject(Actions), service as unknown as SlosService).subscribe((a) => results.push(a));

    expect(results).toEqual([loadSlosSuccess({ slos: [slo()] }), loadSlosFailure({ error: 'project not found' })]);
    expect(service.list).toHaveBeenCalledWith('shop');
  });
});
