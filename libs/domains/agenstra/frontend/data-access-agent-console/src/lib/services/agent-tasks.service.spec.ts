import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import { AgentTasksService } from './agent-tasks.service';

describe('AgentTasksService', () => {
  const apiUrl = 'http://localhost:3100/api';
  const taskUrl = `${apiUrl}/clients/c1/agents/a1/tasks/t1`;
  let service: AgentTasksService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { console: { urls: { restApi: apiUrl } } } }],
    });
    service = TestBed.inject(AgentTasksService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists tasks of a workspace, optionally filtered by agent', () => {
    service.listTasks('c1').subscribe();
    service.listTasks('c1', 'a1').subscribe();

    const [all, filtered] = httpMock.match((r) => r.url === `${apiUrl}/clients/c1/agent-tasks`);

    expect(all.request.params.has('agentId')).toBe(false);
    expect(filtered.request.params.get('agentId')).toBe('a1');
    all.flush([]);
    filtered.flush([]);
  });

  it('creates, updates and deletes tasks', () => {
    const dto = { title: 'T', prompt: 'P', cronExpression: '0 9 * * *', model: 'openai/gpt-5' };

    service.createTask('c1', 'a1', dto).subscribe();
    service.updateTask('c1', 'a1', 't1', { enabled: false }).subscribe();
    service.deleteTask('c1', 'a1', 't1').subscribe();

    const create = httpMock.expectOne(`${apiUrl}/clients/c1/agents/a1/tasks`);

    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(dto);
    create.flush({});

    const update = httpMock.expectOne((r) => r.url === taskUrl && r.method === 'PATCH');

    expect(update.request.body).toEqual({ enabled: false });
    update.flush({});
    httpMock.expectOne((r) => r.url === taskUrl && r.method === 'DELETE').flush(null);
  });

  it('sends the allowed handoff agents with a full edit-form save', () => {
    const dto = {
      title: 'T',
      prompt: 'P',
      cronExpression: '0 9 * * *',
      model: 'openai/gpt-5',
      allowedHandoffAgentIds: ['a2'],
    };

    service.updateTask('c1', 'a1', 't1', dto).subscribe();

    const update = httpMock.expectOne((r) => r.url === taskUrl && r.method === 'PATCH');

    expect(update.request.body).toEqual(dto);
    update.flush({});
  });

  it('reads task details and runs', () => {
    service.getTask('c1', 'a1', 't1').subscribe();
    service.listRuns('c1', 'a1', 't1', { limit: 5 }).subscribe();

    httpMock.expectOne((r) => r.url === taskUrl && r.method === 'GET').flush({ task: {}, runs: [] });

    const runs = httpMock.expectOne((r) => r.url === `${taskUrl}/runs` && r.method === 'GET');

    expect(runs.request.params.get('limit')).toBe('5');
    expect(runs.request.params.has('includeTranscript')).toBe(false);
    runs.flush([]);
  });

  it('requests transcripts for the session history', () => {
    service.listRuns('c1', 'a1', 't1', { limit: 10, offset: 20, includeTranscript: true }).subscribe();

    const runs = httpMock.expectOne((r) => r.url === `${taskUrl}/runs`);

    expect(runs.request.params.get('includeTranscript')).toBe('true');
    expect(runs.request.params.get('limit')).toBe('10');
    expect(runs.request.params.get('offset')).toBe('20');
    runs.flush([]);
  });

  it('approves a task', (done) => {
    service.approve('c1', 'a1', 't1', '2026-10-21T09:00:00.000Z').subscribe((task) => {
      expect(task).toEqual({ id: 't1', approvalStatus: 'approved' });
      done();
    });

    const request = httpMock.expectOne((r) => r.url === `${taskUrl}/approval` && r.method === 'POST');

    expect(request.request.body).toEqual({ updatedAt: '2026-10-21T09:00:00.000Z' });
    request.flush({ id: 't1', approvalStatus: 'approved' });
  });

  it('queues a run', (done) => {
    service.runNow('c1', 'a1', 't1').subscribe((response) => {
      expect(response).toEqual({ taskId: 't1', queued: true });
      done();
    });

    httpMock.expectOne((r) => r.url === `${taskUrl}/runs` && r.method === 'POST').flush({ taskId: 't1', queued: true });
  });
});
