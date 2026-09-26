import { WorkspaceInotifySupervisor } from './workspace-inotify-supervisor.service';

describe('WorkspaceInotifySupervisor.parseInotifyLine', () => {
  const supervisor = Object.create(WorkspaceInotifySupervisor.prototype) as WorkspaceInotifySupervisor;

  it('maps close_write to upsert', () => {
    expect(supervisor.parseInotifyLine('/app/src/a.ts|CLOSE_WRITE,CLOSE', '/app')).toEqual({
      path: 'src/a.ts',
      op: 'upsert',
    });
  });

  it('maps delete to delete', () => {
    expect(supervisor.parseInotifyLine('/app/gone.ts|DELETE', '/app')).toEqual({
      path: 'gone.ts',
      op: 'delete',
    });
  });

  it('returns null for malformed lines', () => {
    expect(supervisor.parseInotifyLine('no-separator', '/app')).toBeNull();
  });
});
