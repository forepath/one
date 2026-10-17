import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { KioskRequestError, WallboardsService } from '../../services/wallboards.service';
import type { CreatedWallboardToken, KioskView } from '../../types/wallboards.types';
import {
  createWallboard,
  createWallboardSuccess,
  clearCreatedWallboard,
  loadKiosk,
  loadKioskFailure,
  loadKioskSuccess,
  revokeWallboardSuccess,
} from './wallboards.actions';
import { createWallboard$, loadKiosk$ } from './wallboards.effects';
import { consoleWallboardsReducer, initialConsoleWallboardsState } from './wallboards.reducer';

const created: CreatedWallboardToken = {
  id: 'w1',
  name: 'Office',
  projects: null,
  createdBy: 'u1',
  createdAt: '2026-10-01T10:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
  token: 'lw_wb_secret',
};

const view: KioskView = {
  name: 'Office',
  sections: [
    {
      scope: 'cluster',
      headline: { state: 'healthy', message: 'All good', key: null },
      inbox: [],
      summary: {
        sites: 1,
        nodes: { total: 3, up: 3 },
        deployments: 4,
        capacity: null,
        requestsPerSecond: null,
        deniedPackets5m: null,
        alertsFiring: 0,
        slos: { total: 0, ok: 0, burning: 0, exhausted: 0 },
      },
    },
  ],
};

describe('console wallboards state', () => {
  it('shows a created token once and keeps the plaintext out of the list', () => {
    const creating = consoleWallboardsReducer(
      initialConsoleWallboardsState,
      createWallboard({ request: { name: 'x' } }),
    );
    const done = consoleWallboardsReducer(creating, createWallboardSuccess({ token: created }));

    expect(creating.creating).toBe(true);
    expect(done.created?.token).toBe('lw_wb_secret');
    expect(done.tokens[0]).not.toHaveProperty('token');
    expect(consoleWallboardsReducer(done, clearCreatedWallboard()).created).toBeNull();
    expect(consoleWallboardsReducer(done, revokeWallboardSuccess({ id: 'w1' })).tokens).toEqual([]);
  });

  it('keeps the last kiosk view on a network error but drops it for an invalid token', () => {
    const shown = consoleWallboardsReducer(
      initialConsoleWallboardsState,
      loadKioskSuccess({ view, at: '2026-10-01T10:00:00.000Z' }),
    );
    const offline = consoleWallboardsReducer(shown, loadKioskFailure({ error: 'offline', unauthorized: false }));
    const invalid = consoleWallboardsReducer(shown, loadKioskFailure({ error: 'expired', unauthorized: true }));

    expect(shown.kioskUpdatedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(offline).toMatchObject({ kiosk: view, kioskError: 'offline', kioskUnauthorized: false });
    expect(invalid).toMatchObject({ kiosk: null, kioskUnauthorized: true });
    expect(consoleWallboardsReducer(invalid, loadKiosk({ token: 't', silent: true })).kioskLoading).toBe(false);
  });

  it('creates tokens and loads the kiosk, telling invalid tokens apart', async () => {
    const service = {
      create: jest.fn().mockReturnValue(of(created)),
      kiosk: jest
        .fn()
        .mockReturnValueOnce(of(view))
        .mockReturnValueOnce(throwError(() => new KioskRequestError(401, 'wallboard token required')))
        .mockReturnValueOnce(throwError(() => new TypeError('Failed to fetch'))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            createWallboard({ request: { name: 'Office' } }),
            loadKiosk({ token: 'a' }),
            loadKiosk({ token: 'b' }),
            loadKiosk({ token: 'c' }),
          ),
        ),
      ],
    });

    const actions = TestBed.inject(Actions);
    const api = service as unknown as WallboardsService;

    expect(await firstValueFrom(createWallboard$(actions, api))).toEqual(createWallboardSuccess({ token: created }));

    const kiosk = await firstValueFrom(loadKiosk$(actions, api).pipe(toArray()));

    expect(kiosk[0]).toMatchObject({ type: loadKioskSuccess.type, view });
    expect(kiosk[1]).toEqual(loadKioskFailure({ error: 'wallboard token required', unauthorized: true }));
    expect(kiosk[2]).toEqual(loadKioskFailure({ error: 'Failed to fetch', unauthorized: false }));
  });
});
