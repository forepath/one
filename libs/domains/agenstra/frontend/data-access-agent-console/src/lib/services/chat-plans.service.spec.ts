import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import { ChatPlansService } from './chat-plans.service';

describe('ChatPlansService', () => {
  const apiUrl = 'http://localhost:3100/api';
  const agentUrl = `${apiUrl}/clients/c1/agents/a1`;
  let service: ChatPlansService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { console: { urls: { restApi: apiUrl } } } }],
    });
    service = TestBed.inject(ChatPlansService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists plans of an agent with search, state and paging', () => {
    service.listPlans('c1', 'a1', { search: ' login ', state: 'editable', limit: 25, offset: 50 }).subscribe();
    service.listPlans('c1', 'a1', { search: '  ', state: null, limit: 10, offset: 0 }).subscribe();

    const [filtered, plain] = httpMock.match((r) => r.url === `${agentUrl}/plans`);

    expect(filtered.request.params.get('search')).toBe('login');
    expect(filtered.request.params.get('state')).toBe('editable');
    expect(filtered.request.params.get('limit')).toBe('25');
    expect(filtered.request.params.get('offset')).toBe('50');
    expect(plain.request.params.has('search')).toBe(false);
    expect(plain.request.params.has('state')).toBe(false);
    filtered.flush({ items: [], total: 0 });
    plain.flush({ items: [], total: 0 });
  });

  it('gets and updates a plan', () => {
    const dto = { planMarkdown: '# P', summary: 'T', expectedUpdatedAt: '2026-11-01T10:00:00.000Z' };

    service.getPlan('c1', 'a1', 'p1').subscribe();
    service.updatePlan('c1', 'a1', 'p1', dto).subscribe();

    httpMock.expectOne({ method: 'GET', url: `${agentUrl}/plans/p1` }).flush({});

    const update = httpMock.expectOne({ method: 'PATCH', url: `${agentUrl}/plans/p1` });

    expect(update.request.body).toEqual(dto);
    update.flush({});
  });

  it('lists the activity of a plan', () => {
    service.listActivity('c1', 'a1', 'p1', { limit: 200 }).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${agentUrl}/plans/p1/activity`);

    expect(req.request.params.get('limit')).toBe('200');
    expect(req.request.params.has('offset')).toBe(false);
    req.flush([]);
  });
});
