import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Actions } from '@ngrx/effects';
import { firstValueFrom, of, Subject, take, throwError, toArray } from 'rxjs';

import { LogsService, logParams } from '../../services/logs.service';
import { ConsoleSocketService } from '../../sockets/console-socket';
import type { LogLine } from '../../types/logs.types';
import {
  loadLogsPage,
  loadLogsPageFailure,
  loadLogsPageSuccess,
  logsTailConnected,
  logsTailReceived,
  nextLogsPage,
  previousLogsPage,
  searchLogs,
  startLogsTail,
  stopLogsTail,
} from './logs.actions';
import { loadLogsPage$, logsPageNavigation$, logsTail$, tailFilter } from './logs.effects';
import { consoleLogsReducer, initialConsoleLogsState, type ConsoleLogsState } from './logs.reducer';

// The real socket service pulls in the identity lib (Keycloak, ES modules only); the effect gets a stub.
jest.mock('../../sockets/console-socket', () => ({ ConsoleSocketService: class {} }));

function line(id: string, overrides: Partial<LogLine> = {}): LogLine {
  return {
    id,
    at: '2026-10-18T08:41:07.512Z',
    source: 'container',
    level: 'warn',
    message: `line ${id}`,
    node: 'n2',
    site: 'fra',
    labels: { project: 'shop', deployment: 'web', service: 'api' },
    fields: {},
    ...overrides,
  };
}

const filter = { from: '2026-10-18T08:00:00.000Z', to: '2026-10-18T09:00:00.000Z', project: 'shop' };

describe('console logs state', () => {
  it('pages by cursor and remembers the cursors to go back', () => {
    let state = consoleLogsReducer(initialConsoleLogsState, searchLogs({ filter, limit: 2 }));

    state = consoleLogsReducer(state, loadLogsPage({ page: 0, cursor: null }));
    state = consoleLogsReducer(
      state,
      loadLogsPageSuccess({ page: 0, result: { lines: [line('1'), line('2')], cursor: 'c1', after: 'a1' } }),
    );
    state = consoleLogsReducer(state, loadLogsPage({ page: 1, cursor: 'c1' }));
    state = consoleLogsReducer(
      state,
      loadLogsPageSuccess({ page: 1, result: { lines: [line('3')], cursor: null, after: 'a2' } }),
    );

    expect(state).toMatchObject({ page: 1, cursors: [null, 'c1'], nextCursor: null, loading: false });
    expect(state.lines.map((l) => l.id)).toEqual(['3']);
    // A late answer of another page doesn't overwrite the shown one.
    expect(consoleLogsReducer(state, loadLogsPageFailure({ page: 0, error: 'x' }))).toBe(state);
  });

  it('keeps tail lines newest first, capped, and only while tailing', () => {
    const idle = consoleLogsReducer(initialConsoleLogsState, logsTailReceived({ lines: [line('1')] }));
    const tailing = consoleLogsReducer(
      consoleLogsReducer(initialConsoleLogsState, startLogsTail({ filter: {} })),
      logsTailReceived({ lines: [line('1'), line('2')] }),
    );

    expect(idle.tail).toEqual([]);
    expect(tailing.tail.map((l) => l.id)).toEqual(['2', '1']);
    expect(consoleLogsReducer(tailing, stopLogsTail())).toMatchObject({ tailing: false });
  });

  it('builds query parameters and the tail body without range or paging', () => {
    expect(logParams({ levels: ['warn', 'error'], project: 'shop', text: '', sources: [] }).toString()).toBe(
      'levels=warn,error&project=shop',
    );
    expect(tailFilter({ ...filter, levels: ['error'], text: '' })).toEqual({ project: 'shop', levels: ['error'] });
  });

  it('loads a page of the current search newest first', async () => {
    const state: ConsoleLogsState = { ...initialConsoleLogsState, filter, limit: 50 };
    const service = {
      query: jest
        .fn()
        .mockReturnValueOnce(of({ lines: [line('1')], cursor: 'c1', after: 'a1' }))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'nope' } }))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadLogsPage({ page: 1, cursor: 'c0' }), loadLogsPage({ page: 0, cursor: null }))),
        provideMockStore({ initialState: { consoleLogs: state } }),
        { provide: LogsService, useValue: service },
      ],
    });

    const actions = await firstValueFrom(TestBed.runInInjectionContext(() => loadLogsPage$()).pipe(toArray()));

    expect(actions).toEqual([
      loadLogsPageSuccess({ page: 1, result: { lines: [line('1')], cursor: 'c1', after: 'a1' } }),
      loadLogsPageFailure({ page: 0, error: 'nope' }),
    ]);
    expect(service.query).toHaveBeenNthCalledWith(1, { ...filter, limit: 50, order: 'desc', cursor: 'c0' });
  });

  it('navigates to the next and the previous page', async () => {
    const state: ConsoleLogsState = {
      ...initialConsoleLogsState,
      filter,
      page: 1,
      cursors: [null, 'c1'],
      nextCursor: 'c2',
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(nextLogsPage(), previousLogsPage())),
        provideMockStore({ initialState: { consoleLogs: state } }),
      ],
    });

    const actions = await firstValueFrom(TestBed.runInInjectionContext(() => logsPageNavigation$()).pipe(toArray()));

    expect(actions).toEqual([loadLogsPage({ page: 2, cursor: 'c2' }), loadLogsPage({ page: 0, cursor: null })]);
  });

  it('tails over socket/logs with the filter', async () => {
    const handlers: Record<string, (payload?: unknown) => void> = {};
    const socket = {
      connected: true,
      on: jest.fn((event: string, handler: (payload?: unknown) => void) => (handlers[event] = handler)),
      emit: jest.fn(),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(),
    };
    const sockets = { open: jest.fn().mockResolvedValue(socket) };
    const actions$ = new Subject<ReturnType<typeof startLogsTail>>();

    TestBed.configureTestingModule({ providers: [provideMockActions(() => actions$)] });

    const result = firstValueFrom(
      logsTail$(TestBed.inject(Actions), sockets as unknown as ConsoleSocketService).pipe(take(2), toArray()),
    );

    actions$.next(startLogsTail({ filter: { ...filter, levels: ['error'] } }));
    await new Promise((resolve) => setTimeout(resolve));
    handlers['connect']();
    handlers['logLines']({ lines: [line('1')] });

    expect(await result).toEqual([logsTailConnected({ connected: true }), logsTailReceived({ lines: [line('1')] })]);
    expect(sockets.open).toHaveBeenCalledWith('logs');
    expect(socket.emit).toHaveBeenNthCalledWith(1, 'subscribe', { project: 'shop', levels: ['error'] });
    expect(socket.emit).toHaveBeenLastCalledWith('unsubscribe');
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
