import { initialAgentTasksState, type AgentTasksState } from './agent-tasks.reducer';
import { selectAgentTaskRuns, selectAgentTasksForAgent } from './agent-tasks.selectors';
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

describe('agent tasks selectors', () => {
  const state: { agentTasks: AgentTasksState } = {
    agentTasks: {
      ...initialAgentTasksState,
      clientId: 'c1',
      tasks: [agentTaskFixture({ id: 't1', agentId: 'a1' }), agentTaskFixture({ id: 't2', agentId: 'a2' })],
      runsByTaskId: { t1: [agentTaskRunFixture()] },
    },
  };

  it('filters tasks by agent (all tasks without an agent)', () => {
    expect(selectAgentTasksForAgent('a2')(state).map((task) => task.id)).toEqual(['t2']);
    expect(selectAgentTasksForAgent(null)(state)).toHaveLength(2);
  });

  it('returns a stable empty run list for unknown tasks', () => {
    expect(selectAgentTaskRuns('t1')(state)).toHaveLength(1);
    expect(selectAgentTaskRuns('missing')(state)).toBe(selectAgentTaskRuns('other')(state));
  });
});
