import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { Observable, of, throwError, toArray } from 'rxjs';

import { InitiativesService } from '../../services/initiatives.service';
import { resolveInitiativesBoardWebsocketUrl } from '../initiatives-board-socket/initiatives-board-socket.effects';

import { initiativesBoardSocketReconnected } from '../initiatives-board-socket/initiatives-board-socket.actions';

import {
  openInitiativeArtifact,
  openInitiativeRun,
  reloadInitiative,
  runInitiativeCommand,
  runInitiativeCommandFailure,
  runInitiativeCommandSuccess,
} from './initiatives.actions';
import {
  normalizeInitiativeError,
  reloadInitiative$,
  reloadInitiativeAfterReconnect$,
  runInitiativeCommand$,
} from './initiatives.effects';
import { initialInitiativesState } from './initiatives.reducer';

describe('initiatives effects', () => {
  let actions$: Observable<unknown>;
  let service: { execute: jest.Mock };

  beforeEach(() => {
    service = { execute: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: InitiativesService, useValue: service },
        { provide: Store, useValue: { select: jest.fn(() => of(initialInitiativesState)) } },
      ],
    });
  });

  const command = { type: 'acceptRun' as const, runId: 'run-1', expectedVersion: 3 };

  it('maps a command to its REST result', (done) => {
    service.execute.mockReturnValue(of({ kind: 'none' }));
    actions$ = of(runInitiativeCommand({ command }));

    TestBed.runInInjectionContext(() => runInitiativeCommand$()).subscribe((action) => {
      expect(action).toEqual(runInitiativeCommandSuccess({ command, result: { kind: 'none' } }));
      done();
    });
  });

  it('marks refused conditional writes as conflicts', (done) => {
    service.execute.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'The run changed meanwhile' } })),
    );
    actions$ = of(runInitiativeCommand({ command }));

    TestBed.runInInjectionContext(() => runInitiativeCommand$()).subscribe((action) => {
      expect(action).toEqual(
        runInitiativeCommandFailure({ command, error: 'The run changed meanwhile', conflict: true }),
      );
      done();
    });
  });

  it('reloads the selected initiative in place and refetches the open document and run', (done) => {
    const detail = jest.fn(() => of([]));
    const full = Object.assign(service, {
      overview: jest.fn(() => of({})),
      artifacts: detail,
      workItems: jest.fn(() => of({ initiativeId: 'ini-1', items: [], initiativeVersion: 1, unknowns: [] })),
      runs: detail,
      proposals: detail,
      findings: detail,
      decisions: detail,
      activity: detail,
    });
    const store = {
      select: jest.fn(() =>
        of({ ...initialInitiativesState, selectedId: 'ini-1', openArtifactId: 'art-1', openRunId: 'run-1' }),
      ),
    };

    TestBed.overrideProvider(InitiativesService, { useValue: full });
    TestBed.overrideProvider(Store, { useValue: store });
    actions$ = of(reloadInitiative({ id: 'ini-1' }));

    TestBed.runInInjectionContext(() => reloadInitiative$())
      .pipe(toArray())
      .subscribe((actions) => {
        expect(actions.map((action) => (action as { type: string }).type)).toEqual([
          '[Initiatives] Load Detail Success',
          openInitiativeArtifact.type,
          openInitiativeRun.type,
        ]);
        expect(actions[1]).toEqual(openInitiativeArtifact({ artifactId: 'art-1' }));
        done();
      });
  });

  it('reloads the open initiative after the board socket reconnected', (done) => {
    TestBed.overrideProvider(Store, {
      useValue: { select: jest.fn(() => of({ ...initialInitiativesState, selectedId: 'ini-1' })) },
    });
    actions$ = of(initiativesBoardSocketReconnected());

    TestBed.runInInjectionContext(() => reloadInitiativeAfterReconnect$()).subscribe((action) => {
      expect(action).toEqual(reloadInitiative({ id: 'ini-1' }));
      done();
    });
  });

  it('normalizes validation error lists', () => {
    expect(normalizeInitiativeError(new HttpErrorResponse({ status: 400, error: { message: ['a', 'b'] } }))).toBe(
      'a; b',
    );
  });
});

describe('resolveInitiativesBoardWebsocketUrl', () => {
  const environment = (websocket: string) => ({ console: { urls: { websocket } } }) as never;

  it('derives the initiatives namespace from the clients socket URL', () => {
    expect(resolveInitiativesBoardWebsocketUrl(environment('https://api.example.com/socket/clients'))).toBe(
      'https://api.example.com/socket/initiatives',
    );
  });
});
