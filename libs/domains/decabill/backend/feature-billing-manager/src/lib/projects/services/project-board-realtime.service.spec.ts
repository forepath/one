import { ProjectBoardRealtimeService } from './project-board-realtime.service';
import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';

describe('ProjectBoardRealtimeService', () => {
  it('projectRoom formats room name', () => {
    expect(ProjectBoardRealtimeService.projectRoom('abc')).toBe('project:abc');
  });

  it('emitToProject no-ops when server not attached', () => {
    const service = new ProjectBoardRealtimeService();

    expect(() => service.emitToProject('p1', PROJECTS_BOARD_EVENTS.ticketUpsert, {})).not.toThrow();
  });

  it('emitToProject emits to project room when server attached', () => {
    const service = new ProjectBoardRealtimeService();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });

    service.attachServer({ to } as never);
    service.emitToProject('p1', PROJECTS_BOARD_EVENTS.ticketUpsert, { id: 't1' });

    expect(to).toHaveBeenCalledWith('project:p1');
    expect(emit).toHaveBeenCalledWith(PROJECTS_BOARD_EVENTS.ticketUpsert, { id: 't1' });
  });
});
