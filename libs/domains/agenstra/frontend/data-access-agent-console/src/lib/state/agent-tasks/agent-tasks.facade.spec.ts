import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  clearAgentTasksError,
  createAgentTask,
  deleteAgentTask,
  loadAgentTaskRuns,
  loadAgentTasks,
  runAgentTaskNow,
  updateAgentTask,
} from './agent-tasks.actions';
import { AgentTasksFacade } from './agent-tasks.facade';

describe('AgentTasksFacade', () => {
  let facade: AgentTasksFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn().mockReturnValue(of(null)), dispatch: jest.fn() } as unknown as jest.Mocked<Store>;
    TestBed.configureTestingModule({ providers: [AgentTasksFacade, { provide: Store, useValue: store }] });
    facade = TestBed.inject(AgentTasksFacade);
  });

  it('dispatches task actions', () => {
    const dto = { title: 'T', prompt: 'P', cronExpression: '0 9 * * *', model: 'openai/gpt-5' };

    facade.load('c1');
    facade.create('c1', 'a1', dto);
    facade.update('c1', 'a1', 't1', { enabled: false });
    facade.delete('c1', 'a1', 't1');
    facade.runNow('c1', 'a1', 't1');
    facade.loadRuns('c1', 'a1', 't1');
    facade.clearError();

    expect(store.dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadAgentTasks({ clientId: 'c1' }),
      createAgentTask({ clientId: 'c1', agentId: 'a1', dto }),
      updateAgentTask({ clientId: 'c1', agentId: 'a1', taskId: 't1', dto: { enabled: false } }),
      deleteAgentTask({ clientId: 'c1', agentId: 'a1', taskId: 't1' }),
      runAgentTaskNow({ clientId: 'c1', agentId: 'a1', taskId: 't1' }),
      loadAgentTaskRuns({ clientId: 'c1', agentId: 'a1', taskId: 't1' }),
      clearAgentTasksError(),
    ]);
  });
});
