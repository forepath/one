import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { EMPTY_TICKET_TASKS, type TicketResponseDto } from '../state/tickets/tickets.types';

import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
  let service: TicketsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const mockTicket: TicketResponseDto = {
    id: 'ticket-1',
    clientId: 'client-1',
    title: 'Example',
    priority: 'medium',
    status: 'draft',
    automationEligible: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tasks: EMPTY_TICKET_TASKS,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            controller: { restApiUrl: apiUrl },
          },
        },
      ],
    });
    service = TestBed.inject(TicketsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listTickets', () => {
    it('should GET /tickets with clientId and parentId null', (done) => {
      service.listTickets({ clientId: 'c1', parentId: null }).subscribe((tickets) => {
        expect(tickets).toEqual([mockTicket]);
        done();
      });
      const req = httpMock.expectOne((r) => r.url === `${apiUrl}/tickets`);

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('clientId')).toBe('c1');
      expect(req.request.params.get('parentId')).toBe('null');
      req.flush([mockTicket]);
    });

    it('should omit params when undefined', (done) => {
      service.listTickets().subscribe((tickets) => {
        expect(tickets).toEqual([]);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets`);

      expect(req.request.params.keys().length).toBe(0);
      req.flush([]);
    });

    it('should GET all tickets for client when parentId is omitted (flat list for board tree)', (done) => {
      service.listTickets({ clientId: 'c1' }).subscribe((tickets) => {
        expect(tickets).toEqual([mockTicket]);
        done();
      });
      const req = httpMock.expectOne((r) => r.url === `${apiUrl}/tickets`);

      expect(req.request.params.get('clientId')).toBe('c1');
      expect(req.request.params.get('parentId')).toBeNull();
      req.flush([mockTicket]);
    });
  });

  describe('createTicket', () => {
    it('should POST body to /tickets', (done) => {
      const dto = { clientId: 'c1', title: 'New', status: 'todo' as const, priority: 'high' as const };

      service.createTicket(dto).subscribe((t) => {
        expect(t).toEqual(mockTicket);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(dto);
      req.flush(mockTicket);
    });

    it('should accept CreateTicketResultDto with createdChildTickets', (done) => {
      const dto = { clientId: 'c1', title: 'Epic', creationTemplate: 'specification' as const };
      const child = { ...mockTicket, id: 'child-1', parentId: mockTicket.id, title: 'Proposal' };
      const res = { ...mockTicket, createdChildTickets: [child] };

      service.createTicket(dto).subscribe((t) => {
        expect(t.createdChildTickets).toEqual([child]);
        expect(t.id).toBe(mockTicket.id);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets`);

      expect(req.request.body).toEqual(dto);
      req.flush(res);
    });
  });

  describe('updateTicket', () => {
    it('should PATCH /tickets/:id', (done) => {
      const patch = { status: 'done' as const };

      service.updateTicket('ticket-1', patch).subscribe((t) => {
        expect(t).toEqual(mockTicket);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1`);

      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(patch);
      req.flush(mockTicket);
    });
  });

  describe('ticket automation', () => {
    const mockAutomation = {
      ticketId: 'ticket-1',
      eligible: true,
      allowedAgentIds: ['agent-1'],
      includeWorkspaceContext: true,
      contextEnvironmentIds: [],
      autoEnrichmentEnabled: true,
      verifierProfile: null,
      requiresApproval: false,
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
    const mockRun = {
      id: 'run-1',
      ticketId: 'ticket-1',
      clientId: 'client-1',
      agentId: 'agent-1',
      status: 'running' as const,
      phase: 'agent_loop' as const,
      ticketStatusBefore: 'todo',
      branchName: 'automation/x',
      baseBranch: 'main',
      baseSha: null,
      startedAt: '2024-01-01T00:00:00Z',
      finishedAt: null,
      updatedAt: '2024-01-01T00:00:00Z',
      iterationCount: 0,
      completionMarkerSeen: false,
      verificationPassed: null,
      failureCode: null,
      summary: null,
      cancelRequestedAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
    };

    it('getTicketAutomation GETs /tickets/:id/automation', (done) => {
      service.getTicketAutomation('ticket-1').subscribe((row) => {
        expect(row).toEqual(mockAutomation);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1/automation`);

      expect(req.request.method).toBe('GET');
      req.flush(mockAutomation);
    });

    it('patchTicketAutomation PATCHes body', (done) => {
      const dto = { eligible: false };

      service.patchTicketAutomation('ticket-1', dto).subscribe((row) => {
        expect(row).toEqual(mockAutomation);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1/automation`);

      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(dto);
      req.flush(mockAutomation);
    });

    it('approveTicketAutomation POSTs approve', (done) => {
      service.approveTicketAutomation('ticket-1').subscribe((row) => {
        expect(row).toEqual(mockAutomation);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1/automation/approve`);

      expect(req.request.method).toBe('POST');
      req.flush(mockAutomation);
    });

    it('unapproveTicketAutomation POSTs unapprove', (done) => {
      service.unapproveTicketAutomation('ticket-1').subscribe((row) => {
        expect(row).toEqual(mockAutomation);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1/automation/unapprove`);

      expect(req.request.method).toBe('POST');
      req.flush(mockAutomation);
    });

    it('listTicketAutomationRuns GETs runs', (done) => {
      service.listTicketAutomationRuns('ticket-1').subscribe((runs) => {
        expect(runs).toEqual([mockRun]);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1/automation/runs`);

      expect(req.request.method).toBe('GET');
      req.flush([mockRun]);
    });

    it('getTicketAutomationRun GETs run detail', (done) => {
      service.getTicketAutomationRun('ticket-1', 'run-1').subscribe((run) => {
        expect(run).toEqual(mockRun);
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1/automation/runs/run-1`);

      expect(req.request.method).toBe('GET');
      req.flush(mockRun);
    });

    it('cancelTicketAutomationRun POSTs cancel', (done) => {
      service.cancelTicketAutomationRun('ticket-1', 'run-1').subscribe((run) => {
        expect(run).toEqual({ ...mockRun, status: 'cancelled' });
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1/automation/runs/run-1/cancel`);

      expect(req.request.method).toBe('POST');
      req.flush({ ...mockRun, status: 'cancelled' });
    });
  });

  describe('migrateTicket', () => {
    it('POSTs /tickets/:id/migrate with body', (done) => {
      const body = { targetClientId: 'client-2' };

      service.migrateTicket('ticket-1', body).subscribe((res) => {
        expect(res).toEqual({ ticket: { ...mockTicket, clientId: 'client-2' } });
        done();
      });
      const req = httpMock.expectOne(`${apiUrl}/tickets/ticket-1/migrate`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(body);
      req.flush({ ticket: { ...mockTicket, clientId: 'client-2' } });
    });
  });
});
