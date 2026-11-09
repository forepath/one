import type { Server } from 'socket.io';

import { AGENT_TASK_SOCKET_EVENTS } from '../constants/agent-tasks.constants';

import { AgentTaskRealtimeService } from './agent-task-realtime.service';
import { INITIATIVES_BOARD_EVENTS } from './initiative-board-realtime.constants';
import { InitiativeBoardRealtimeService } from './initiative-board-realtime.service';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';

describe('InitiativeBoardRealtimeService', () => {
  it('emits to the workspace room and the per-event room', () => {
    const service = new InitiativeBoardRealtimeService();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });

    service.attachServer({ to } as unknown as Server);
    service.emitToClient('client-1', INITIATIVES_BOARD_EVENTS.initiativeUpsert, { id: 'ini-1' });

    expect(to).toHaveBeenCalledWith(['client:client-1', 'client:client-1#event:initiativeUpsert']);
    expect(emit).toHaveBeenCalledWith(INITIATIVES_BOARD_EVENTS.initiativeUpsert, { id: 'ini-1' });
  });

  it('signals graph-relevant initiative changes, also without an attached server', () => {
    const changes = new WorkspaceGraphChangeNotifierService();
    const listener = jest.fn();

    changes.register(listener);

    const service = new InitiativeBoardRealtimeService(changes);

    service.emitToClient('client-1', INITIATIVES_BOARD_EVENTS.initiativeUpsert, { id: 'ini-1' });
    service.emitToClient('client-1', INITIATIVES_BOARD_EVENTS.initiativeArtifactRemoved, { id: 'doc-1' });
    service.emitToClient('client-1', INITIATIVES_BOARD_EVENTS.initiativeWorkItemsChanged, { initiativeId: 'ini-1' });
    // Runs, turns, findings and activity do not change the graph.
    service.emitToClient('client-1', INITIATIVES_BOARD_EVENTS.initiativeRunUpsert, { id: 'run-1' });
    service.emitToClient('client-1', INITIATIVES_BOARD_EVENTS.initiativeActivityCreated, { id: 'act-1' });

    expect(listener.mock.calls).toEqual([
      ['client-1', 'initiativeUpsert'],
      ['client-1', 'initiativeArtifactRemoved'],
      ['client-1', 'initiativeWorkItemsChanged'],
    ]);
  });
});

describe('AgentTaskRealtimeService', () => {
  it('signals task upserts and removals to the workspace graph, also without an attached server', () => {
    const changes = new WorkspaceGraphChangeNotifierService();
    const listener = jest.fn();

    changes.register(listener);

    const service = new AgentTaskRealtimeService(changes);

    service.emitTaskUpsert({ id: 'task-1', clientId: 'client-1' } as never);
    service.emitTaskRemoved({ id: 'task-1', clientId: 'client-1' } as never);

    expect(listener.mock.calls).toEqual([
      ['client-1', AGENT_TASK_SOCKET_EVENTS.taskUpsert],
      ['client-1', AGENT_TASK_SOCKET_EVENTS.taskRemoved],
    ]);
  });
});
