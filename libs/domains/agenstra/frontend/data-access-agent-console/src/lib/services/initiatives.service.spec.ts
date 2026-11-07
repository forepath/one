import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import type { InitiativeCommandResult } from '../state/initiatives/initiatives.types';

import { InitiativesService } from './initiatives.service';

describe('InitiativesService', () => {
  let service: InitiativesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { console: { urls: { restApi: apiUrl } } } }],
    });
    service = TestBed.inject(InitiativesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists initiatives of a workspace with trimmed filters only', () => {
    service.list('c1', { search: '  checkout ', limit: 20 }).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/initiatives`);

    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('clientId')).toBe('c1');
    expect(req.request.params.get('search')).toBe('checkout');
    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.has('state')).toBe(false);
    req.flush({ items: [], total: 0 });
  });

  it('loads the initiative link of a ticket', () => {
    service.ticketLink('t1').subscribe((response) => expect(response.link).toBeNull());

    const req = httpMock.expectOne(`${apiUrl}/tickets/t1/initiative-link`);

    expect(req.request.method).toBe('GET');
    req.flush({ link: null });
  });

  it('sends conditional writes with the expected version', () => {
    let result: InitiativeCommandResult | undefined;

    service.execute({ type: 'acceptArtifact', artifactId: 'a1', expectedVersion: 4 }).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${apiUrl}/initiative-artifacts/a1/accept`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ expectedVersion: 4 });
    req.flush({ id: 'a1', version: 5 });
    expect(result).toEqual({ kind: 'artifact', artifact: { id: 'a1', version: 5 } });
  });

  it('maps run decisions to their route', () => {
    service.execute({ type: 'discardRun', runId: 'r1', expectedVersion: 2 }).subscribe();
    service.execute({ type: 'cancelRun', runId: 'r2', expectedVersion: 3 }).subscribe();

    httpMock.expectOne(`${apiUrl}/initiative-runs/r1/discard`).flush({ id: 'r1' });
    httpMock.expectOne(`${apiUrl}/initiative-runs/r2/cancel`).flush({ id: 'r2' });
  });

  it('takes the initiative of a work item tree from the response, also when the tree is empty', () => {
    let result: InitiativeCommandResult | undefined;

    service.execute({ type: 'deleteWorkItem', itemId: 'w1' }).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${apiUrl}/initiative-work-items/w1`);

    expect(req.request.method).toBe('DELETE');
    req.flush({ initiativeId: 'ini-1', items: [], initiativeVersion: 3, unknowns: [] });
    expect(result).toEqual(expect.objectContaining({ kind: 'workItems', initiativeId: 'ini-1' }));
  });

  it('only sends the close-tickets flag of a proposal when it was confirmed', () => {
    service.execute({ type: 'acceptProposal', proposalId: 'p1' }).subscribe();
    service.execute({ type: 'acceptProposal', proposalId: 'p2', closeDroppedTickets: true, note: 'ok' }).subscribe();

    expect(httpMock.expectOne(`${apiUrl}/initiative-proposals/p1/accept`).request.body).toEqual({});
    expect(httpMock.expectOne(`${apiUrl}/initiative-proposals/p2/accept`).request.body).toEqual({
      note: 'ok',
      closeDroppedTickets: true,
    });
  });
});
