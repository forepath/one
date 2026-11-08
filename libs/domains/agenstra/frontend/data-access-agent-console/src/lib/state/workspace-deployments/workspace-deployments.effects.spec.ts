import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of, throwError } from 'rxjs';
import { take, toArray } from 'rxjs/operators';

import { WorkspaceDeploymentsService } from '../../services/workspace-deployments.service';
import { forwardedEventReceived } from '../container-socket/container-socket.actions';
import { routeForwardedEvents$ } from '../container-socket/container-socket.effects';

import {
  approveDeploymentWorkflow,
  approveDeploymentWorkflowFailure,
  approveDeploymentWorkflowSuccess,
  cancelDeploymentRun,
  cancelDeploymentRunFailure,
  deleteDeploymentWorkflowSuccess,
  deploymentRunUpsertReceived,
  deploymentWorkflowRemovedReceived,
  deploymentWorkflowUpsertReceived,
  loadDeploymentRuns,
  loadDeploymentRunsSuccess,
  loadDeploymentWorkflow,
  loadDeploymentWorkflows,
  loadDeploymentWorkflowsSuccess,
  syncDeploymentWorkflowSuccess,
  triggerDeploymentWorkflow,
  triggerDeploymentWorkflowFailure,
  triggerDeploymentWorkflowSuccess,
} from './workspace-deployments.actions';
import {
  approveDeploymentWorkflow$,
  cancelDeploymentRun$,
  loadDeploymentRuns$,
  loadDeploymentWorkflows$,
  reloadDeploymentRunsAfterSync$,
  reloadDeploymentWorkflowAfterApprovalConflict$,
  reloadDeploymentWorkflowsAfterDelete$,
  triggerDeploymentWorkflow$,
} from './workspace-deployments.effects';
import { initialWorkspaceDeploymentsState } from './workspace-deployments.reducer';

describe('workspace deployments effects', () => {
  let actions$: Observable<Action>;
  let service: jest.Mocked<
    Pick<
      WorkspaceDeploymentsService,
      'listWorkflows' | 'listRuns' | 'triggerWorkflow' | 'cancelRun' | 'approveWorkflow'
    >
  >;

  beforeEach(() => {
    service = {
      listWorkflows: jest.fn(),
      listRuns: jest.fn(),
      triggerWorkflow: jest.fn(),
      cancelRun: jest.fn(),
      approveWorkflow: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            workspaceDeployments: {
              ...initialWorkspaceDeploymentsState,
              clientId: 'c1',
              workflowsQuery: { search: 'x' },
              runsQuery: { workflowId: 'w1', limit: 25 },
              selectedWorkflow: { id: 'w1', clientId: 'c1' } as never,
            },
          },
        }),
        { provide: WorkspaceDeploymentsService, useValue: service },
      ],
    });
  });

  const first = (effect: () => Observable<Action>): Promise<Action> =>
    new Promise((resolve) => TestBed.runInInjectionContext(() => effect().pipe(take(1)).subscribe(resolve)));

  it('loads workflows with the default page size', async () => {
    service.listWorkflows.mockReturnValue(of([]));
    actions$ = of(loadDeploymentWorkflows({ clientId: 'c1', query: { agentId: 'a1' } }));

    await expect(first(loadDeploymentWorkflows$)).resolves.toEqual(
      loadDeploymentWorkflowsSuccess({ clientId: 'c1', workflows: [], hasNext: false }),
    );
    expect(service.listWorkflows).toHaveBeenCalledWith('c1', { agentId: 'a1', limit: 25 });
  });

  it('loads a runs page with its total', async () => {
    service.listRuns.mockReturnValue(of({ items: [], total: 7 }));
    actions$ = of(loadDeploymentRuns({ clientId: 'c1', query: { workflowId: 'w1' } }));

    await expect(first(loadDeploymentRuns$)).resolves.toEqual(
      loadDeploymentRunsSuccess({ clientId: 'c1', runs: [], total: 7 }),
    );
    expect(service.listRuns).toHaveBeenCalledWith('c1', { workflowId: 'w1', limit: 25 });
  });

  it('triggers a run and surfaces the 409 of a disabled workflow', async () => {
    service.triggerWorkflow.mockReturnValueOnce(of({ id: 'r1' } as never));
    actions$ = of(triggerDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1', dto: { ref: 'main' } }));
    await expect(first(triggerDeploymentWorkflow$)).resolves.toEqual(
      triggerDeploymentWorkflowSuccess({ run: { id: 'r1' } as never }),
    );

    service.triggerWorkflow.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Workflow is disabled' } })),
    );
    await expect(first(triggerDeploymentWorkflow$)).resolves.toEqual(
      triggerDeploymentWorkflowFailure({ error: 'Workflow is disabled' }),
    );
  });

  it('approves a workflow and flags a 409 (changed since reviewed) as conflict', async () => {
    service.approveWorkflow.mockReturnValueOnce(of({ id: 'w1' } as never));
    actions$ = of(approveDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1', updatedAt: 't1' }));
    await expect(first(approveDeploymentWorkflow$)).resolves.toEqual(
      approveDeploymentWorkflowSuccess({ workflow: { id: 'w1' } as never }),
    );
    expect(service.approveWorkflow).toHaveBeenCalledWith('c1', 'w1', 't1');

    service.approveWorkflow.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'The workflow changed' } })),
    );
    await expect(first(approveDeploymentWorkflow$)).resolves.toEqual(
      approveDeploymentWorkflowFailure({
        clientId: 'c1',
        workflowId: 'w1',
        error: 'The workflow changed',
        conflict: true,
      }),
    );

    service.approveWorkflow.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Forbidden' } })),
    );
    await expect(first(approveDeploymentWorkflow$)).resolves.toEqual(
      approveDeploymentWorkflowFailure({ clientId: 'c1', workflowId: 'w1', error: 'Forbidden', conflict: false }),
    );
  });

  it('reloads the listed page and the opened workflow after an approval conflict only', async () => {
    actions$ = of(
      approveDeploymentWorkflowFailure({ clientId: 'c1', workflowId: 'w1', error: 'Forbidden', conflict: false }),
      approveDeploymentWorkflowFailure({ clientId: 'c1', workflowId: 'w1', error: 'Changed', conflict: true }),
    );

    const reloads = await new Promise<Action[]>((resolve) =>
      TestBed.runInInjectionContext(() =>
        reloadDeploymentWorkflowAfterApprovalConflict$().pipe(take(2), toArray()).subscribe(resolve),
      ),
    );

    expect(reloads).toEqual([
      loadDeploymentWorkflows({ clientId: 'c1', query: { search: 'x' } }),
      loadDeploymentWorkflow({ clientId: 'c1', workflowId: 'w1' }),
    ]);
  });

  it('cancels a run', async () => {
    service.cancelRun.mockReturnValue(throwError(() => new Error('nope')));
    actions$ = of(cancelDeploymentRun({ clientId: 'c1', runId: 'r1' }));

    await expect(first(cancelDeploymentRun$)).resolves.toEqual(
      cancelDeploymentRunFailure({ runId: 'r1', error: 'nope' }),
    );
  });

  it('reloads listed pages after delete / sync', async () => {
    actions$ = of(deleteDeploymentWorkflowSuccess({ workflowId: 'w1' }));
    await expect(first(reloadDeploymentWorkflowsAfterDelete$)).resolves.toEqual(
      loadDeploymentWorkflows({ clientId: 'c1', query: { search: 'x' } }),
    );

    actions$ = of(syncDeploymentWorkflowSuccess({ workflowId: 'w1', synced: 3 }));
    await expect(first(reloadDeploymentRunsAfterSync$)).resolves.toEqual(
      loadDeploymentRuns({ clientId: 'c1', query: { workflowId: 'w1', limit: 25 } }),
    );
  });

  it('routes deployment socket events into the store', async () => {
    const workflow = { id: 'w1', clientId: 'c1' };
    const run = { id: 'r1', clientId: 'c1' };

    actions$ = of(
      forwardedEventReceived({ event: 'deploymentWorkflowUpsert', payload: workflow as never }),
      forwardedEventReceived({
        event: 'deploymentWorkflowRemoved',
        payload: { clientId: 'c1', workflowId: 'w1' } as never,
      }),
      forwardedEventReceived({ event: 'deploymentRunUpsert', payload: run as never }),
    );

    const routed = await new Promise<Action[]>((resolve) =>
      TestBed.runInInjectionContext(() => routeForwardedEvents$().pipe(take(3), toArray()).subscribe(resolve)),
    );

    expect(routed).toEqual([
      deploymentWorkflowUpsertReceived({ workflow: workflow as never }),
      deploymentWorkflowRemovedReceived({ event: { clientId: 'c1', workflowId: 'w1' } }),
      deploymentRunUpsertReceived({ run: run as never }),
    ]);
  });
});
