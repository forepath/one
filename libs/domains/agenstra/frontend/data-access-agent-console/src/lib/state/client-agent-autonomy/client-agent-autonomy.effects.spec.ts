import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { Observable, of, throwError } from 'rxjs';
import { take } from 'rxjs/operators';

import { ClientsService } from '../../services/clients.service';

import {
  loadClientAgentAutonomy,
  loadClientAgentAutonomyFailure,
  loadClientAgentAutonomySuccess,
  upsertClientAgentAutonomy,
  upsertClientAgentAutonomyFailure,
  upsertClientAgentAutonomySuccess,
} from './client-agent-autonomy.actions';
import { loadClientAgentAutonomy$, upsertClientAgentAutonomy$ } from './client-agent-autonomy.effects';
import type { ClientAgentAutonomyResponseDto } from './client-agent-autonomy.types';

describe('ClientAgentAutonomyEffects', () => {
  let actions$: Observable<Action>;
  let clientsService: jest.Mocked<Pick<ClientsService, 'getClientAgentAutonomy' | 'upsertClientAgentAutonomy'>>;
  const mockAutonomy: ClientAgentAutonomyResponseDto = {
    clientId: 'c1',
    agentId: 'a1',
    enabled: true,
    preImproveTicket: false,
    maxRuntimeMs: 3_600_000,
    maxIterations: 20,
    tokenBudgetLimit: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    clientsService = {
      getClientAgentAutonomy: jest.fn(),
      upsertClientAgentAutonomy: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: ClientsService, useValue: clientsService }],
    });
  });

  it('loadClientAgentAutonomy$ success', (done) => {
    clientsService.getClientAgentAutonomy!.mockReturnValue(of(mockAutonomy));
    actions$ = of(loadClientAgentAutonomy({ clientId: 'c1', agentId: 'a1' }));
    TestBed.runInInjectionContext(() => {
      loadClientAgentAutonomy$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(loadClientAgentAutonomySuccess({ autonomy: mockAutonomy }));
          expect(clientsService.getClientAgentAutonomy).toHaveBeenCalledWith('c1', 'a1');
          done();
        });
    });
  });

  it('loadClientAgentAutonomy$ failure', (done) => {
    clientsService.getClientAgentAutonomy!.mockReturnValue(throwError(() => new Error('nope')));
    actions$ = of(loadClientAgentAutonomy({ clientId: 'c1', agentId: 'a1' }));
    TestBed.runInInjectionContext(() => {
      loadClientAgentAutonomy$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(loadClientAgentAutonomyFailure({ error: 'nope' }));
          done();
        });
    });
  });

  it('loadClientAgentAutonomy$ maps 404 to success with defaults', (done) => {
    clientsService.getClientAgentAutonomy!.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
    );
    actions$ = of(loadClientAgentAutonomy({ clientId: 'c1', agentId: 'a1' }));
    TestBed.runInInjectionContext(() => {
      loadClientAgentAutonomy$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(
            loadClientAgentAutonomySuccess({
              autonomy: expect.objectContaining({
                clientId: 'c1',
                agentId: 'a1',
                enabled: false,
                preImproveTicket: false,
                maxRuntimeMs: 3_600_000,
                maxIterations: 25,
                tokenBudgetLimit: null,
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
              }),
            }),
          );
          done();
        });
    });
  });

  it('upsertClientAgentAutonomy$ success', (done) => {
    const dto = {
      enabled: false,
      preImproveTicket: true,
      maxRuntimeMs: 60_000,
      maxIterations: 5,
    };

    clientsService.upsertClientAgentAutonomy!.mockReturnValue(of(mockAutonomy));
    actions$ = of(upsertClientAgentAutonomy({ clientId: 'c1', agentId: 'a1', dto }));
    TestBed.runInInjectionContext(() => {
      upsertClientAgentAutonomy$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(upsertClientAgentAutonomySuccess({ autonomy: mockAutonomy }));
          done();
        });
    });
  });

  it('upsertClientAgentAutonomy$ failure', (done) => {
    clientsService.upsertClientAgentAutonomy!.mockReturnValue(throwError(() => new Error('bad')));
    actions$ = of(
      upsertClientAgentAutonomy({
        clientId: 'c1',
        agentId: 'a1',
        dto: {
          enabled: true,
          preImproveTicket: false,
          maxRuntimeMs: 3_600_000,
          maxIterations: 20,
        },
      }),
    );
    TestBed.runInInjectionContext(() => {
      upsertClientAgentAutonomy$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(upsertClientAgentAutonomyFailure({ error: 'bad' }));
          done();
        });
    });
  });
});
