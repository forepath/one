import { WorkspaceChangeNotifierService } from './workspace-change-notifier.service';
import {
  WORKSPACE_INDEX_CHANGED_EVENT,
  WORKSPACE_INDEX_REBUILD_REQUIRED_EVENT,
  WORKSPACE_SYSTEM_SOCKET_ID,
} from '../constants/workspace-index.constants';

describe('WorkspaceChangeNotifierService', () => {
  let service: WorkspaceChangeNotifierService;
  let indexEvents: Array<{ agentId: string; event: string; data: unknown }>;
  let fileUpdates: Array<{ agentId: string; data: unknown }>;

  beforeEach(() => {
    service = new WorkspaceChangeNotifierService();
    indexEvents = [];
    fileUpdates = [];
    service.registerIndexBroadcaster((agentId, event, data) => {
      indexEvents.push({ agentId, event, data });
    });
    service.registerFileUpdateBroadcaster((agentId, data) => {
      fileUpdates.push({ agentId, data });
    });
  });

  it('broadcasts filtered path changes and system file updates', () => {
    service.notifyPathChanges(
      'agent-1',
      [
        { path: 'src/a.ts', op: 'upsert' },
        { path: '.env', op: 'upsert' },
      ],
      'write',
    );

    expect(indexEvents).toHaveLength(1);
    expect(indexEvents[0].event).toBe(WORKSPACE_INDEX_CHANGED_EVENT);
    const payload = indexEvents[0].data as { changes: Array<{ path: string }> };

    expect(payload.changes).toEqual([{ path: 'src/a.ts', op: 'upsert' }]);
    expect(fileUpdates).toHaveLength(1);
    expect((fileUpdates[0].data as { socketId: string }).socketId).toBe(WORKSPACE_SYSTEM_SOCKET_ID);
  });

  it('broadcasts rebuild required', () => {
    service.notifyRebuildRequired('agent-1', 'workspace-ready', ['src/a.ts', 'node_modules/x']);

    expect(indexEvents).toHaveLength(1);
    expect(indexEvents[0].event).toBe(WORKSPACE_INDEX_REBUILD_REQUIRED_EVENT);
    const payload = indexEvents[0].data as { paths?: string[] };

    expect(payload.paths).toEqual(['src/a.ts']);
  });
});
