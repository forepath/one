import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';

import { WorkspaceDeploymentsService } from './workspace-deployments.service';

describe('WorkspaceDeploymentsService', () => {
  const apiUrl = 'http://localhost:3100/api';
  const baseUrl = `${apiUrl}/clients/c1/deployments`;
  let service: WorkspaceDeploymentsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: ENVIRONMENT, useValue: { console: { urls: { restApi: apiUrl } } } }],
    });
    service = TestBed.inject(WorkspaceDeploymentsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('browses connections, repositories, branches and provider workflows', () => {
    service.listConnections('c1').subscribe();
    service.listRepositories('c1', 'k1', ' api ').subscribe();
    service.listBranches('c1', 'k1', 'org/api').subscribe();
    service.listProviderWorkflows('c1', 'k1', 'org/api').subscribe();

    httpMock.expectOne(`${baseUrl}/connections`).flush([]);

    const repositories = httpMock.expectOne((r) => r.url === `${baseUrl}/connections/k1/repositories`);

    expect(repositories.request.params.get('search')).toBe('api');
    repositories.flush([]);

    const branches = httpMock.expectOne((r) => r.url === `${baseUrl}/connections/k1/branches`);

    expect(branches.request.params.get('repository')).toBe('org/api');
    branches.flush([]);

    const workflows = httpMock.expectOne((r) => r.url === `${baseUrl}/connections/k1/workflows`);

    expect(workflows.request.params.get('repository')).toBe('org/api');
    workflows.flush([]);
  });

  it('lists workflows filtered by environment and manages them', () => {
    service
      .listWorkflows('c1', { agentId: 'a1', approvalStatus: 'pending', search: 'deploy', limit: 25, offset: 0 })
      .subscribe();
    service.getWorkflow('c1', 'w1').subscribe();
    service.createWorkflow('c1', { connectionId: 'k1', name: 'Deploy', repository: 'org/api' }).subscribe();
    service.updateWorkflow('c1', 'w1', { enabled: false }).subscribe();
    service.deleteWorkflow('c1', 'w1').subscribe();

    const list = httpMock.expectOne((r) => r.method === 'GET' && r.url === `${baseUrl}/workflows`);

    expect(list.request.params.get('agentId')).toBe('a1');
    expect(list.request.params.get('approvalStatus')).toBe('pending');
    expect(list.request.params.get('search')).toBe('deploy');
    expect(list.request.params.get('limit')).toBe('25');
    expect(list.request.params.has('offset')).toBe(false);
    list.flush([]);
    httpMock.expectOne({ method: 'GET', url: `${baseUrl}/workflows/w1` }).flush({});
    httpMock.expectOne({ method: 'POST', url: `${baseUrl}/workflows` }).flush({});

    const update = httpMock.expectOne({ method: 'PUT', url: `${baseUrl}/workflows/w1` });

    expect(update.request.body).toEqual({ enabled: false });
    update.flush({});
    httpMock.expectOne({ method: 'DELETE', url: `${baseUrl}/workflows/w1` }).flush(null);
  });

  it('approves a workflow bound to the reviewed version', () => {
    service.approveWorkflow('c1', 'w1', '2026-11-01T10:00:00.000Z').subscribe();

    const approval = httpMock.expectOne({ method: 'POST', url: `${baseUrl}/workflows/w1/approval` });

    expect(approval.request.body).toEqual({ updatedAt: '2026-11-01T10:00:00.000Z' });
    approval.flush({});
  });

  it('triggers, syncs and reads runs', () => {
    service.triggerWorkflow('c1', 'w1', { ref: 'main', inputs: { env: 'prod' }, agentId: 'a1' }).subscribe();
    service.syncWorkflow('c1', 'w1').subscribe();
    service.listRuns('c1', { workflowId: 'w1', status: 'completed', limit: 25, offset: 25 }).subscribe();
    service.getRun('c1', 'r1').subscribe();
    service.getRunLogs('c1', 'r1').subscribe();
    service.getRunLogs('c1', 'r1', 'j1').subscribe();
    service.cancelRun('c1', 'r1').subscribe();

    const trigger = httpMock.expectOne({ method: 'POST', url: `${baseUrl}/workflows/w1/trigger` });

    expect(trigger.request.body).toEqual({ ref: 'main', inputs: { env: 'prod' }, agentId: 'a1' });
    trigger.flush({});
    httpMock.expectOne({ method: 'POST', url: `${baseUrl}/workflows/w1/sync` }).flush({ synced: 2 });

    const runs = httpMock.expectOne((r) => r.url === `${baseUrl}/runs`);

    expect(runs.request.params.get('workflowId')).toBe('w1');
    expect(runs.request.params.get('status')).toBe('completed');
    expect(runs.request.params.get('offset')).toBe('25');
    runs.flush({ items: [], total: 0 });
    httpMock.expectOne(`${baseUrl}/runs/r1`).flush({ run: {}, jobs: [] });

    const logs = httpMock.match((r) => r.url === `${baseUrl}/runs/r1/logs`);

    expect(logs[0].request.params.has('jobId')).toBe(false);
    expect(logs[1].request.params.get('jobId')).toBe('j1');
    logs.forEach((request) => request.flush({ logs: '', truncated: false }));
    httpMock.expectOne({ method: 'POST', url: `${baseUrl}/runs/r1/cancel` }).flush({});
  });
});
