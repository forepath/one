import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { StatusPagesService } from '../../services/status-pages.service';
import type { Incident } from '../../types/status-pages.types';
import {
  createIncident,
  createIncidentSuccess,
  loadIncidents,
  loadIncidentsSuccess,
  loadStatusPages,
  loadStatusPagesSuccess,
  updateIncident,
  updateIncidentFailure,
  updateIncidentSuccess,
} from './status-pages.actions';
import { createIncident$, loadIncidents$, loadStatusPages$, updateIncident$ } from './status-pages.effects';
import { consoleStatusPagesReducer, initialConsoleStatusPagesState } from './status-pages.reducer';
import { selectOpenIncidentCount } from './status-pages.selectors';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    project: 'shop',
    title: 'Slow checkout',
    status: 'investigating',
    updates: [{ at: '2026-10-18T08:20:00.000Z', status: 'investigating', message: 'Slow.', by: 'u1' }],
    createdAt: '2026-10-18T08:20:00.000Z',
    updatedAt: '2026-10-18T08:20:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('console status pages state', () => {
  it('ignores incidents of a project that is no longer shown', () => {
    const shop = consoleStatusPagesReducer(initialConsoleStatusPagesState, loadIncidents({ project: 'shop' }));
    const blog = consoleStatusPagesReducer(shop, loadIncidents({ project: 'blog' }));

    expect(
      consoleStatusPagesReducer(blog, loadIncidentsSuccess({ project: 'shop', incidents: [incident()] })).incidents,
    ).toEqual([]);
    expect(
      consoleStatusPagesReducer(shop, loadIncidentsSuccess({ project: 'shop', incidents: [incident()] })).incidents,
    ).toHaveLength(1);
  });

  it('prepends created incidents, replaces updated ones and counts the open ones', () => {
    let state = consoleStatusPagesReducer(initialConsoleStatusPagesState, loadIncidents({ project: 'shop' }));

    state = consoleStatusPagesReducer(state, loadIncidentsSuccess({ project: 'shop', incidents: [incident()] }));
    state = consoleStatusPagesReducer(
      state,
      createIncident({ project: 'shop', incident: { title: 't', status: 'identified', message: 'm' } }),
    );
    expect(state.creating).toBe(true);
    state = consoleStatusPagesReducer(state, createIncidentSuccess({ incident: incident({ id: 'i2' }) }));
    expect(state.incidents.map((i) => i.id)).toEqual(['i2', 'i1']);

    state = consoleStatusPagesReducer(
      state,
      updateIncident({ project: 'shop', id: 'i1', update: { status: 'resolved', message: 'ok' } }),
    );
    expect(state.updating).toBe('i1');
    state = consoleStatusPagesReducer(state, updateIncidentSuccess({ incident: incident({ status: 'resolved' }) }));
    expect(state.updating).toBeNull();
    expect(selectOpenIncidentCount({ consoleStatusPages: state })).toBe(1);

    state = consoleStatusPagesReducer(state, updateIncidentFailure({ id: 'i1', error: 'operator role required' }));
    expect(state.actionError).toBe('operator role required');
  });

  it('loads status pages and incidents', async () => {
    const page = {
      apiVersion: 'loadweaver.com/v1',
      kind: 'StatusPage',
      metadata: { name: 'public', project: 'shop' },
      spec: { host: 'status.example.com', title: 'Shop', services: [] },
    };
    const service = {
      pages: jest.fn().mockReturnValue(of([page])),
      incidents: jest.fn().mockReturnValue(of([incident()])),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadStatusPages()))],
    });
    expect(
      await firstValueFrom(loadStatusPages$(TestBed.inject(Actions), service as unknown as StatusPagesService)),
    ).toEqual(loadStatusPagesSuccess({ pages: [page] }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideMockActions(() => of(loadIncidents({ project: 'shop' })))] });
    expect(
      await firstValueFrom(loadIncidents$(TestBed.inject(Actions), service as unknown as StatusPagesService)),
    ).toEqual(loadIncidentsSuccess({ project: 'shop', incidents: [incident()] }));
    expect(service.incidents).toHaveBeenCalledWith('shop');
  });

  it('creates and updates incidents and reports forbidden updates', async () => {
    const service = {
      createIncident: jest.fn().mockReturnValue(of(incident())),
      updateIncident: jest
        .fn()
        .mockReturnValue(
          throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'operator role required' } })),
        ),
    };
    const body = { title: 'Slow checkout', status: 'investigating' as const, message: 'Slow.' };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(createIncident({ project: 'shop', incident: body })))],
    });
    expect(
      await firstValueFrom(createIncident$(TestBed.inject(Actions), service as unknown as StatusPagesService)),
    ).toEqual(createIncidentSuccess({ incident: incident() }));
    expect(service.createIncident).toHaveBeenCalledWith('shop', body);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(updateIncident({ project: 'shop', id: 'i1', update: { status: 'resolved', message: 'Fixed.' } })),
        ),
      ],
    });
    expect(
      await firstValueFrom(updateIncident$(TestBed.inject(Actions), service as unknown as StatusPagesService)),
    ).toEqual(updateIncidentFailure({ id: 'i1', error: 'operator role required' }));
    expect(service.updateIncident).toHaveBeenCalledWith('shop', 'i1', { status: 'resolved', message: 'Fixed.' });
  });
});
