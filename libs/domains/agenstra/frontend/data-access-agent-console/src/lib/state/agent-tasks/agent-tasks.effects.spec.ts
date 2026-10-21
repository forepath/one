import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import type { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Observable, of, throwError } from 'rxjs';
import { take } from 'rxjs/operators';

import { AgentTasksService } from '../../services/agent-tasks.service';

import {
  createAgentTask,
  createAgentTaskFailure,
  createAgentTaskSuccess,
  deleteAgentTask,
  deleteAgentTaskSuccess,
  loadAgentTaskRuns,
  loadAgentTaskRunsSuccess,
  loadMoreAgentTaskRuns,
  loadMoreAgentTaskRunsFailure,
  loadMoreAgentTaskRunsSuccess,
  loadAgentTasks,
  loadAgentTasksFailure,
  loadAgentTasksSuccess,
  approveAgentTask,
  runAgentTaskNow,
  runAgentTaskNowFailure,
  runAgentTaskNowSuccess,
  updateAgentTask,
  updateAgentTaskFailure,
  updateAgentTaskSuccess,
} from './agent-tasks.actions';
import {
  approveAgentTask$,
  createAgentTask$,
  deleteAgentTask$,
  AGENT_TASK_RUNS_PAGE_SIZE,
  loadAgentTaskRuns$,
  loadMoreAgentTaskRuns$,
  loadAgentTasks$,
  runAgentTaskNow$,
  updateAgentTask$,
} from './agent-tasks.effects';
import { initialAgentTasksState } from './agent-tasks.reducer';
import type { AgentTaskResponseDto, AgentTaskRunResponseDto } from './agent-tasks.types';

function agentTaskFixture(overrides: Partial<AgentTaskResponseDto> = {}): AgentTaskResponseDto {
  return {
    id: 't1',
    clientId: 'c1',
    agentId: 'a1',
    title: 'Daily report',
    prompt: 'Summarize',
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
    model: 'openai/gpt-5',
    enabled: true,
    nextRunAt: '2026-10-22T09:00:00.000Z',
    lastRunAt: null,
    lastRunStatus: null,
    approvalStatus: 'approved',
    allowedHandoffAgentIds: [],
    approvedAt: '2026-10-21T09:00:00.000Z',
    createdBy: 'user',
    updatedBy: 'user',
    createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  };
}

function agentTaskRunFixture(overrides: Partial<AgentTaskRunResponseDto> = {}): AgentTaskRunResponseDto {
  return {
    id: 'r1',
    taskId: 't1',
    clientId: 'c1',
    agentId: 'a1',
    trigger: 'schedule',
    status: 'running',
    scheduledFor: '2026-10-21T09:00:00.000Z',
    startedAt: '2026-10-21T09:00:01.000Z',
    finishedAt: null,
    outputExcerpt: null,
    failureMessage: null,
    ...overrides,
  };
}

describe('agent tasks effects', () => {
  let actions$: Observable<Action>;
  let service: jest.Mocked<
    Pick<
      AgentTasksService,
      'listTasks' | 'createTask' | 'updateTask' | 'deleteTask' | 'runNow' | 'listRuns' | 'approve'
    >
  >;
  let store: MockStore;
  const dto = { title: 'T', prompt: 'P', cronExpression: '0 9 * * *', model: 'openai/gpt-5' };

  beforeEach(() => {
    service = {
      listTasks: jest.fn(),
      createTask: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
      runNow: jest.fn(),
      approve: jest.fn(),
      listRuns: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({ initialState: { agentTasks: initialAgentTasksState } }),
        { provide: AgentTasksService, useValue: service },
      ],
    });
    store = TestBed.inject(MockStore);
  });

  const first = (effect: () => Observable<Action>): Promise<Action> =>
    new Promise((resolve) => TestBed.runInInjectionContext(() => effect().pipe(take(1)).subscribe(resolve)));

  it('loads tasks', async () => {
    service.listTasks.mockReturnValue(of([agentTaskFixture()]));
    actions$ = of(loadAgentTasks({ clientId: 'c1' }));

    await expect(first(loadAgentTasks$)).resolves.toEqual(
      loadAgentTasksSuccess({ clientId: 'c1', tasks: [agentTaskFixture()] }),
    );
    expect(service.listTasks).toHaveBeenCalledWith('c1');
  });

  it('maps validation errors (message arrays) to one string', async () => {
    service.listTasks.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: ['a', 'b'] } })),
    );
    actions$ = of(loadAgentTasks({ clientId: 'c1' }));

    await expect(first(loadAgentTasks$)).resolves.toEqual(loadAgentTasksFailure({ error: 'a; b' }));
  });

  it('creates and updates tasks', async () => {
    service.createTask.mockReturnValue(of(agentTaskFixture()));
    service.updateTask.mockReturnValue(of(agentTaskFixture({ enabled: false })));

    actions$ = of(createAgentTask({ clientId: 'c1', agentId: 'a1', dto }));
    await expect(first(createAgentTask$)).resolves.toEqual(createAgentTaskSuccess({ task: agentTaskFixture() }));

    actions$ = of(updateAgentTask({ clientId: 'c1', agentId: 'a1', taskId: 't1', dto: { enabled: false } }));
    await expect(first(updateAgentTask$)).resolves.toEqual(
      updateAgentTaskSuccess({ task: agentTaskFixture({ enabled: false }) }),
    );
    expect(service.updateTask).toHaveBeenCalledWith('c1', 'a1', 't1', { enabled: false });
  });

  it('reports create failures', async () => {
    service.createTask.mockReturnValue(throwError(() => new Error('nope')));
    actions$ = of(createAgentTask({ clientId: 'c1', agentId: 'a1', dto }));

    await expect(first(createAgentTask$)).resolves.toEqual(createAgentTaskFailure({ error: 'nope' }));
  });

  it('deletes tasks', async () => {
    service.deleteTask.mockReturnValue(of(undefined));
    actions$ = of(deleteAgentTask({ clientId: 'c1', agentId: 'a1', taskId: 't1' }));

    await expect(first(deleteAgentTask$)).resolves.toEqual(deleteAgentTaskSuccess({ taskId: 't1' }));
  });

  it('approves tasks through the update result actions', async () => {
    service.approve.mockReturnValueOnce(of(agentTaskFixture({ approvalStatus: 'approved' })));
    actions$ = of(approveAgentTask({ clientId: 'c1', agentId: 'a1', taskId: 't1', reviewedUpdatedAt: 'v1' }));
    await expect(first(approveAgentTask$)).resolves.toEqual(
      updateAgentTaskSuccess({ task: agentTaskFixture({ approvalStatus: 'approved' }) }),
    );
    expect(service.approve).toHaveBeenCalledWith('c1', 'a1', 't1', 'v1');

    service.approve.mockReturnValueOnce(throwError(() => new Error('forbidden')));
    actions$ = of(approveAgentTask({ clientId: 'c1', agentId: 'a1', taskId: 't1', reviewedUpdatedAt: 'v1' }));
    await expect(first(approveAgentTask$)).resolves.toEqual(updateAgentTaskFailure({ error: 'forbidden' }));
  });

  it('queues runs and reports failures per task', async () => {
    service.runNow.mockReturnValueOnce(of({ taskId: 't1', queued: true }));
    actions$ = of(runAgentTaskNow({ clientId: 'c1', agentId: 'a1', taskId: 't1' }));
    await expect(first(runAgentTaskNow$)).resolves.toEqual(runAgentTaskNowSuccess({ taskId: 't1', queued: true }));

    service.runNow.mockReturnValueOnce(throwError(() => new Error('down')));
    actions$ = of(runAgentTaskNow({ clientId: 'c1', agentId: 'a1', taskId: 't1' }));
    await expect(first(runAgentTaskNow$)).resolves.toEqual(runAgentTaskNowFailure({ taskId: 't1', error: 'down' }));
  });

  it('loads runs of a task', async () => {
    service.listRuns.mockReturnValue(of([agentTaskRunFixture()]));
    actions$ = of(loadAgentTaskRuns({ clientId: 'c1', agentId: 'a1', taskId: 't1' }));

    await expect(first(loadAgentTaskRuns$)).resolves.toEqual(
      loadAgentTaskRunsSuccess({ taskId: 't1', runs: [agentTaskRunFixture()], hasMore: false }),
    );
    expect(service.listRuns).toHaveBeenCalledWith('c1', 'a1', 't1', {
      limit: AGENT_TASK_RUNS_PAGE_SIZE,
      includeTranscript: true,
    });
  });

  it('reports more runs when a full page arrives and passes refresh through', async () => {
    const page = Array.from({ length: AGENT_TASK_RUNS_PAGE_SIZE }, (_, i) => agentTaskRunFixture({ id: `r${i}` }));

    service.listRuns.mockReturnValue(of(page));
    actions$ = of(loadAgentTaskRuns({ clientId: 'c1', agentId: 'a1', taskId: 't1', refresh: true }));

    await expect(first(loadAgentTaskRuns$)).resolves.toEqual(
      loadAgentTaskRunsSuccess({ taskId: 't1', runs: page, hasMore: true, refresh: true }),
    );
  });

  describe('loadMoreAgentTaskRuns$', () => {
    const stateWith = (overrides: Record<string, unknown>) => ({
      agentTasks: {
        ...initialAgentTasksState,
        runsByTaskId: { t1: [agentTaskRunFixture({ id: 'a' }), agentTaskRunFixture({ id: 'b' })] },
        runsHasMore: { t1: true },
        ...overrides,
      },
    });

    it('loads the next page at the loaded offset', async () => {
      store.setState(stateWith({}));
      service.listRuns.mockReturnValue(of([agentTaskRunFixture({ id: 'c' })]));
      actions$ = of(loadMoreAgentTaskRuns({ clientId: 'c1', agentId: 'a1', taskId: 't1' }));

      await expect(first(loadMoreAgentTaskRuns$)).resolves.toEqual(
        loadMoreAgentTaskRunsSuccess({ taskId: 't1', runs: [agentTaskRunFixture({ id: 'c' })], hasMore: false }),
      );
      expect(service.listRuns).toHaveBeenCalledWith('c1', 'a1', 't1', {
        limit: AGENT_TASK_RUNS_PAGE_SIZE,
        offset: 2,
        includeTranscript: true,
      });
    });

    it('reports failures per task', async () => {
      store.setState(stateWith({}));
      service.listRuns.mockReturnValue(throwError(() => new Error('down')));
      actions$ = of(loadMoreAgentTaskRuns({ clientId: 'c1', agentId: 'a1', taskId: 't1' }));

      await expect(first(loadMoreAgentTaskRuns$)).resolves.toEqual(
        loadMoreAgentTaskRunsFailure({ taskId: 't1', error: 'down' }),
      );
    });

    it('does nothing without more pages or while a page is loading', () => {
      const emitted: unknown[] = [];

      for (const overrides of [{ runsHasMore: { t1: false } }, { runsAppendLoading: { t1: true } }]) {
        store.setState(stateWith(overrides));
        actions$ = of(loadMoreAgentTaskRuns({ clientId: 'c1', agentId: 'a1', taskId: 't1' }));
        TestBed.runInInjectionContext(() => loadMoreAgentTaskRuns$().subscribe((action) => emitted.push(action)));
      }

      expect(emitted).toEqual([]);
      expect(service.listRuns).not.toHaveBeenCalled();
    });
  });
});
