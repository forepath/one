import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { AlertsService } from '../../services/alerts.service';
import type { Alert } from '../../types/alerts.types';
import {
  acknowledgeAlertSuccess,
  createSilenceSuccess,
  endSilenceSuccess,
  loadAlert,
  loadAlertFailure,
  loadAlerts,
  loadAlertsSuccess,
  loadAlertSuccess,
  loadSilences,
} from './alerts.actions';
import { loadAlert$, loadAlerts$, reloadSilencesAfterEnd$ } from './alerts.effects';
import { consoleAlertsReducer, initialConsoleAlertsState } from './alerts.reducer';
import { selectAlertCounts } from './alerts.selectors';

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    rule: 'builtin:node-down',
    key: 'node/n1',
    project: null,
    severity: 'critical',
    state: 'firing',
    title: 'Node n1 down',
    message: 'no heartbeat',
    value: null,
    startedAt: '2026-10-01T10:00:00.000Z',
    firedAt: '2026-10-01T10:01:00.000Z',
    resolvedAt: null,
    silenced: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

describe('console alerts state', () => {
  it('counts per state and applies an acknowledgement to list and detail', () => {
    const listed = consoleAlertsReducer(
      initialConsoleAlertsState,
      loadAlertsSuccess({ alerts: [alert(), alert({ id: 'a2', state: 'pending' })] }),
    );
    const opened = consoleAlertsReducer(listed, loadAlert({ id: 'a1' }));
    const acknowledged = consoleAlertsReducer(
      opened,
      acknowledgeAlertSuccess({ alert: alert({ acknowledgedBy: 'u1' }) }),
    );

    expect(opened.selected?.id).toBe('a1');
    expect(acknowledged.selected?.acknowledgedBy).toBe('u1');
    expect(acknowledged.alerts[0].acknowledgedBy).toBe('u1');
    expect(selectAlertCounts({ consoleAlerts: listed })).toEqual({ firing: 1, pending: 1, resolved: 0 });
  });

  it('drops the list for another filter and prepends created silences', () => {
    const listed = consoleAlertsReducer(initialConsoleAlertsState, loadAlertsSuccess({ alerts: [alert()] }));
    const silence = {
      id: 's1',
      rule: null,
      project: 'shop',
      key: null,
      reason: 'maintenance',
      createdBy: 'u1',
      startsAt: '2026-10-01T10:00:00.000Z',
      endsAt: '2026-10-01T12:00:00.000Z',
    };

    expect(consoleAlertsReducer(listed, loadAlerts({ query: { state: 'resolved' } })).alerts).toEqual([]);
    expect(consoleAlertsReducer(listed, loadAlerts({ query: { state: 'open' }, silent: true })).alerts).toHaveLength(1);
    expect(consoleAlertsReducer(listed, createSilenceSuccess({ silence })).silences).toEqual([silence]);
  });

  it('loads alerts with the filter', async () => {
    const service = { list: jest.fn().mockReturnValue(of([alert()])) };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadAlerts({ query: { state: 'all', project: 'shop' } })))],
    });

    expect(await firstValueFrom(loadAlerts$(TestBed.inject(Actions), service as unknown as AlertsService))).toEqual(
      loadAlertsSuccess({ alerts: [alert()] }),
    );
    expect(service.list).toHaveBeenCalledWith({ state: 'all', project: 'shop' });
  });

  it('reads one alert by id and reports a missing one', async () => {
    const service = {
      get: jest.fn((id: string) =>
        id === 'a1'
          ? of(alert())
          : throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Alert not found' } })),
      ),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadAlert({ id: 'a1' }), loadAlert({ id: 'missing' })))],
    });

    const effect = loadAlert$(TestBed.inject(Actions), service as unknown as AlertsService);
    const results: unknown[] = [];

    effect.subscribe((a) => results.push(a));

    expect(results).toEqual([
      loadAlertSuccess({ alert: alert() }),
      loadAlertFailure({ id: 'missing', error: 'Alert not found' }),
    ]);
    expect(service.get).toHaveBeenCalledWith('a1');
  });

  it('re-reads silences after ending one', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(endSilenceSuccess({ id: 's1' }))),
        provideMockStore({ initialState: { consoleAlerts: { ...initialConsoleAlertsState, silencesExpired: true } } }),
      ],
    });

    expect(await firstValueFrom(TestBed.runInInjectionContext(() => reloadSilencesAfterEnd$()))).toEqual(
      loadSilences({ expired: true }),
    );
  });
});
