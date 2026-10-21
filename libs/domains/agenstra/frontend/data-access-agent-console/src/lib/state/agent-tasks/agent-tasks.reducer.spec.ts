import {
  agentTaskRemovedReceived,
  agentTaskRunReceived,
  agentTaskUpsertReceived,
  createAgentTask,
  createAgentTaskFailure,
  createAgentTaskSuccess,
  deleteAgentTaskSuccess,
  loadAgentTaskRunsSuccess,
  loadMoreAgentTaskRuns,
  loadMoreAgentTaskRunsFailure,
  loadMoreAgentTaskRunsSuccess,
  loadAgentTasks,
  loadAgentTasksSuccess,
  runAgentTaskNow,
  runAgentTaskNowSuccess,
} from './agent-tasks.actions';
import { agentTasksReducer, initialAgentTasksState } from './agent-tasks.reducer';
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

describe('agentTasksReducer', () => {
  const loaded = agentTasksReducer(
    agentTasksReducer(initialAgentTasksState, loadAgentTasks({ clientId: 'c1' })),
    loadAgentTasksSuccess({
      clientId: 'c1',
      tasks: [
        agentTaskFixture({ id: 't2', createdAt: '2026-10-21T10:00:00.000Z' }),
        agentTaskFixture({ id: 't1', createdAt: '2026-10-21T08:00:00.000Z' }),
      ],
    }),
  );

  it('loads tasks for a workspace sorted by creation time', () => {
    expect(loaded.clientId).toBe('c1');
    expect(loaded.loading).toBe(false);
    expect(loaded.tasks.map((task) => task.id)).toEqual(['t1', 't2']);
  });

  it('resets when switching workspaces and ignores stale responses', () => {
    const switched = agentTasksReducer(loaded, loadAgentTasks({ clientId: 'c2' }));

    expect(switched.tasks).toEqual([]);
    expect(agentTasksReducer(switched, loadAgentTasksSuccess({ clientId: 'c1', tasks: loaded.tasks })).tasks).toEqual(
      [],
    );
  });

  it('tracks saving and errors of mutations', () => {
    const saving = agentTasksReducer(
      loaded,
      createAgentTask({
        clientId: 'c1',
        agentId: 'a1',
        dto: { title: 'x', prompt: 'y', cronExpression: '0 9 * * *', model: 'm/x' },
      }),
    );

    expect(saving.saving).toBe(true);

    const created = agentTasksReducer(
      saving,
      createAgentTaskSuccess({ task: agentTaskFixture({ id: 't3', createdAt: '2026-10-21T11:00:00.000Z' }) }),
    );

    expect(created.saving).toBe(false);
    expect(created.tasks.map((task) => task.id)).toEqual(['t1', 't2', 't3']);
    expect(agentTasksReducer(saving, createAgentTaskFailure({ error: 'bad cron' }))).toEqual(
      expect.objectContaining({ saving: false, error: 'bad cron' }),
    );
  });

  it('applies live upserts and removals of the current workspace only', () => {
    const updated = agentTasksReducer(
      loaded,
      agentTaskUpsertReceived({ task: agentTaskFixture({ title: 'Renamed' }) }),
    );

    expect(updated.tasks.find((task) => task.id === 't1')?.title).toBe('Renamed');
    expect(
      agentTasksReducer(loaded, agentTaskUpsertReceived({ task: agentTaskFixture({ id: 'x', clientId: 'c2' }) })),
    ).toBe(loaded);

    const removed = agentTasksReducer(
      loaded,
      agentTaskRemovedReceived({ event: { clientId: 'c1', agentId: 'a1', taskId: 't1' } }),
    );

    expect(removed.tasks.map((task) => task.id)).toEqual(['t2']);
  });

  it('drops runs of deleted tasks', () => {
    const withRuns = agentTasksReducer(
      loaded,
      loadAgentTaskRunsSuccess({ taskId: 't1', runs: [agentTaskRunFixture()], hasMore: false }),
    );
    const deleted = agentTasksReducer(withRuns, deleteAgentTaskSuccess({ taskId: 't1' }));

    expect(deleted.runsByTaskId['t1']).toBeUndefined();
    expect(deleted.tasks.map((task) => task.id)).toEqual(['t2']);
  });

  it('upserts live runs newest first and caps the history', () => {
    let state = agentTasksReducer(loaded, agentTaskRunReceived({ run: agentTaskRunFixture() }));

    state = agentTasksReducer(state, agentTaskRunReceived({ run: agentTaskRunFixture({ status: 'succeeded' }) }));
    state = agentTasksReducer(
      state,
      agentTaskRunReceived({ run: agentTaskRunFixture({ id: 'r2', startedAt: '2026-10-22T09:00:01.000Z' }) }),
    );

    expect(state.runsByTaskId['t1'].map((run) => [run.id, run.status])).toEqual([
      ['r2', 'running'],
      ['r1', 'succeeded'],
    ]);
  });

  it('keeps loaded transcripts when a live run snapshot without transcript arrives', () => {
    const transcript = [{ payload: { kind: 'assistantMessage' }, timestamp: 1 }];
    const loadedRuns = agentTasksReducer(
      loaded,
      loadAgentTaskRunsSuccess({ taskId: 't1', runs: [agentTaskRunFixture({ transcript })], hasMore: false }),
    );
    const live = agentTasksReducer(
      loadedRuns,
      agentTaskRunReceived({ run: agentTaskRunFixture({ status: 'succeeded' }) }),
    );

    expect(live.runsByTaskId['t1'][0]).toEqual(expect.objectContaining({ status: 'succeeded', transcript }));
  });

  describe('session history paging', () => {
    const run = (id: string, startedAt: string) => agentTaskRunFixture({ id, startedAt });
    const firstPage = agentTasksReducer(
      loaded,
      loadAgentTaskRunsSuccess({
        taskId: 't1',
        runs: [run('r2', '2026-10-21T10:00:00.000Z'), run('r1', '2026-10-21T09:00:00.000Z')],
        hasMore: true,
      }),
    );

    it('appends further pages without duplicates and tracks hasMore', () => {
      const loading = agentTasksReducer(
        firstPage,
        loadMoreAgentTaskRuns({ clientId: 'c1', agentId: 'a1', taskId: 't1' }),
      );

      expect(loading.runsAppendLoading['t1']).toBe(true);

      const appended = agentTasksReducer(
        loading,
        loadMoreAgentTaskRunsSuccess({
          taskId: 't1',
          runs: [run('r1', '2026-10-21T09:00:00.000Z'), run('r0', '2026-10-20T09:00:00.000Z')],
          hasMore: false,
        }),
      );

      expect(appended.runsByTaskId['t1'].map((entry) => entry.id)).toEqual(['r2', 'r1', 'r0']);
      expect(appended.runsHasMore['t1']).toBe(false);
      expect(appended.runsAppendLoading['t1']).toBe(false);
    });

    it('keeps append errors per task for retry', () => {
      const failed = agentTasksReducer(firstPage, loadMoreAgentTaskRunsFailure({ taskId: 't1', error: 'down' }));

      expect(failed.runsAppendError['t1']).toBe('down');
      expect(failed.runsAppendLoading['t1']).toBe(false);
    });

    it('merges a refreshed first page into the loaded pages', () => {
      const appended = agentTasksReducer(
        firstPage,
        loadMoreAgentTaskRunsSuccess({ taskId: 't1', runs: [run('r0', '2026-10-20T09:00:00.000Z')], hasMore: true }),
      );
      const refreshed = agentTasksReducer(
        appended,
        loadAgentTaskRunsSuccess({
          taskId: 't1',
          runs: [run('r3', '2026-10-21T11:00:00.000Z'), run('r2', '2026-10-21T10:00:00.000Z')],
          hasMore: true,
          refresh: true,
        }),
      );

      expect(refreshed.runsByTaskId['t1'].map((entry) => entry.id)).toEqual(['r3', 'r2', 'r1', 'r0']);
      expect(refreshed.runsHasMore['t1']).toBe(true);
    });

    it('replaces the pages on a regular reload and drops paging state with the task', () => {
      const reloaded = agentTasksReducer(
        firstPage,
        loadAgentTaskRunsSuccess({ taskId: 't1', runs: [run('r9', '2026-10-22T09:00:00.000Z')], hasMore: false }),
      );

      expect(reloaded.runsByTaskId['t1'].map((entry) => entry.id)).toEqual(['r9']);

      const deleted = agentTasksReducer(firstPage, deleteAgentTaskSuccess({ taskId: 't1' }));

      expect(deleted.runsHasMore['t1']).toBeUndefined();
    });
  });

  it('tracks run-now requests and their outcome', () => {
    const requested = agentTasksReducer(loaded, runAgentTaskNow({ clientId: 'c1', agentId: 'a1', taskId: 't1' }));

    expect(requested.runRequestTaskIds).toEqual(['t1']);

    const done = agentTasksReducer(requested, runAgentTaskNowSuccess({ taskId: 't1', queued: false }));

    expect(done.runRequestTaskIds).toEqual([]);
    expect(done.lastRunNow).toEqual({ taskId: 't1', queued: false });
  });
});
