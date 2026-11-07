import { KNOWLEDGE_BOARD_EVENTS } from './knowledge-board-realtime.constants';
import { KnowledgeBoardRealtimeService } from './knowledge-board-realtime.service';
import { ChatPlanRealtimeService } from './chat-plan-realtime.service';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';

describe('WorkspaceGraphChangeNotifierService', () => {
  it('fans out to registered listeners until they unregister and isolates failing listeners', () => {
    const changes = new WorkspaceGraphChangeNotifierService();
    const failing = jest.fn(() => {
      throw new Error('boom');
    });
    const listener = jest.fn();

    changes.register(failing);
    const unregister = changes.register(listener);

    changes.notify('client-1', 'ticketUpsert');
    unregister();
    changes.notify('client-1', 'ticketUpsert');
    changes.notify(null, 'ticketUpsert');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('client-1', 'ticketUpsert');
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('is signalled by knowledge tree / relation changes (not page activity)', () => {
    const changes = new WorkspaceGraphChangeNotifierService();
    const listener = jest.fn();

    changes.register(listener);

    const service = new KnowledgeBoardRealtimeService(changes);

    service.emitToClient('client-1', KNOWLEDGE_BOARD_EVENTS.knowledgeTreeChanged, {});
    service.emitToClient('client-1', KNOWLEDGE_BOARD_EVENTS.knowledgeRelationChanged, {});
    service.emitToClient('client-1', KNOWLEDGE_BOARD_EVENTS.knowledgePageActivityCreated, {});
    expect(listener.mock.calls.map(([, reason]) => reason)).toEqual([
      'knowledgeTreeChanged',
      'knowledgeRelationChanged',
    ]);
  });

  it('is signalled by chat plan upserts', () => {
    const changes = new WorkspaceGraphChangeNotifierService();
    const listener = jest.fn();

    changes.register(listener);
    new ChatPlanRealtimeService(changes).emitToClient('client-1', { id: 'p1' });
    expect(listener).toHaveBeenCalledWith('client-1', 'chatPlanUpsert');
  });
});
