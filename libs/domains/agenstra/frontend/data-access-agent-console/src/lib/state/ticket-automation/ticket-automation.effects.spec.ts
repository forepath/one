import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { Observable, of, throwError } from 'rxjs';
import { take } from 'rxjs/operators';

import { TicketsService } from '../../services/tickets.service';
import { replaceTicketDetailActivity } from '../tickets/tickets.actions';

import {
  approveTicketAutomation,
  approveTicketAutomationFailure,
  approveTicketAutomationSuccess,
  unapproveTicketAutomation,
  unapproveTicketAutomationFailure,
  unapproveTicketAutomationSuccess,
  loadTicketAutomation,
  loadTicketAutomationFailure,
  loadTicketAutomationSuccess,
  patchTicketAutomation,
  patchTicketAutomationFailure,
  patchTicketAutomationSuccess,
} from './ticket-automation.actions';
import {
  approveTicketAutomation$,
  loadTicketAutomation$,
  patchTicketAutomation$,
  refreshTicketDetailActivityAfterAutomation$,
  unapproveTicketAutomation$,
} from './ticket-automation.effects';
import type { TicketAutomationResponseDto } from './ticket-automation.types';

describe('TicketAutomationEffects', () => {
  let actions$: Observable<Action>;
  let ticketsService: jest.Mocked<
    Pick<
      TicketsService,
      | 'getTicketAutomation'
      | 'patchTicketAutomation'
      | 'approveTicketAutomation'
      | 'unapproveTicketAutomation'
      | 'listActivity'
    >
  >;
  const mockConfig: TicketAutomationResponseDto = {
    ticketId: 't1',
    eligible: false,
    allowedAgentIds: [],
    includeWorkspaceContext: true,
    contextEnvironmentIds: [],
    autoEnrichmentEnabled: true,
    verifierProfile: null,
    requiresApproval: true,
    approvedAt: null,
    approvedByUserId: null,
    approvalBaselineTicketUpdatedAt: null,
    defaultBranchOverride: null,
    automationBranchStrategy: 'reuse_per_ticket',
    forceNewAutomationBranchNextRun: false,
    nextRetryAt: null,
    consecutiveFailureCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    ticketsService = {
      getTicketAutomation: jest.fn(),
      patchTicketAutomation: jest.fn(),
      approveTicketAutomation: jest.fn(),
      unapproveTicketAutomation: jest.fn(),
      listActivity: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: TicketsService, useValue: ticketsService }],
    });
  });

  it('loadTicketAutomation$ maps to success', (done) => {
    ticketsService.getTicketAutomation!.mockReturnValue(of(mockConfig));
    actions$ = of(loadTicketAutomation({ ticketId: 't1' }));
    TestBed.runInInjectionContext(() => {
      loadTicketAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(loadTicketAutomationSuccess({ config: mockConfig }));
          expect(ticketsService.getTicketAutomation).toHaveBeenCalledWith('t1');
          done();
        });
    });
  });

  it('loadTicketAutomation$ maps to failure', (done) => {
    ticketsService.getTicketAutomation!.mockReturnValue(throwError(() => new Error('network')));
    actions$ = of(loadTicketAutomation({ ticketId: 't1' }));
    TestBed.runInInjectionContext(() => {
      loadTicketAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(loadTicketAutomationFailure({ error: 'network' }));
          done();
        });
    });
  });

  it('patchTicketAutomation$ maps to success', (done) => {
    ticketsService.patchTicketAutomation!.mockReturnValue(of(mockConfig));
    actions$ = of(patchTicketAutomation({ ticketId: 't1', dto: { eligible: true } }));
    TestBed.runInInjectionContext(() => {
      patchTicketAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(patchTicketAutomationSuccess({ config: mockConfig }));
          done();
        });
    });
  });

  it('patchTicketAutomation$ maps HttpErrorResponse message', (done) => {
    const err = new HttpErrorResponse({ error: { message: 'bad' }, status: 400, statusText: 'Bad' });

    ticketsService.patchTicketAutomation!.mockReturnValue(throwError(() => err));
    actions$ = of(patchTicketAutomation({ ticketId: 't1', dto: {} }));
    TestBed.runInInjectionContext(() => {
      patchTicketAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(patchTicketAutomationFailure({ error: 'bad' }));
          done();
        });
    });
  });

  it('approveTicketAutomation$ maps to success', (done) => {
    ticketsService.approveTicketAutomation!.mockReturnValue(of(mockConfig));
    actions$ = of(approveTicketAutomation({ ticketId: 't1' }));
    TestBed.runInInjectionContext(() => {
      approveTicketAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(approveTicketAutomationSuccess({ config: mockConfig }));
          done();
        });
    });
  });

  it('approveTicketAutomation$ maps to failure', (done) => {
    ticketsService.approveTicketAutomation!.mockReturnValue(throwError(() => new Error('x')));
    actions$ = of(approveTicketAutomation({ ticketId: 't1' }));
    TestBed.runInInjectionContext(() => {
      approveTicketAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(approveTicketAutomationFailure({ error: 'x' }));
          done();
        });
    });
  });

  it('unapproveTicketAutomation$ maps to success', (done) => {
    ticketsService.unapproveTicketAutomation!.mockReturnValue(of(mockConfig));
    actions$ = of(unapproveTicketAutomation({ ticketId: 't1' }));
    TestBed.runInInjectionContext(() => {
      unapproveTicketAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(unapproveTicketAutomationSuccess({ config: mockConfig }));
          done();
        });
    });
  });

  it('unapproveTicketAutomation$ maps to failure', (done) => {
    ticketsService.unapproveTicketAutomation!.mockReturnValue(throwError(() => new Error('u')));
    actions$ = of(unapproveTicketAutomation({ ticketId: 't1' }));
    TestBed.runInInjectionContext(() => {
      unapproveTicketAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(unapproveTicketAutomationFailure({ error: 'u' }));
          done();
        });
    });
  });

  it('refreshTicketDetailActivityAfterAutomation$ loads activity after patch success', (done) => {
    const activity = [
      {
        id: 'a1',
        ticketId: 't1',
        occurredAt: '2024-01-01T00:00:00Z',
        actorType: 'human' as const,
        actionType: 'AUTOMATION_APPROVAL_INVALIDATED',
        payload: {},
      },
    ];

    ticketsService.listActivity!.mockReturnValue(of(activity));
    actions$ = of(patchTicketAutomationSuccess({ config: mockConfig }));
    TestBed.runInInjectionContext(() => {
      refreshTicketDetailActivityAfterAutomation$()
        .pipe(take(1))
        .subscribe((action) => {
          expect(action).toEqual(replaceTicketDetailActivity({ ticketId: 't1', activity }));
          expect(ticketsService.listActivity).toHaveBeenCalledWith('t1', 100, 0);
          done();
        });
    });
  });
});
