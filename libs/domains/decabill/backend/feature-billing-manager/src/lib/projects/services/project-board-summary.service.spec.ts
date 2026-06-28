import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';
import { ProjectBoardSummaryService } from './project-board-summary.service';

describe('ProjectBoardSummaryService', () => {
  const projectsService = { buildSummary: jest.fn() };
  const projectBoardRealtime = { emitToProject: jest.fn() };

  let service: ProjectBoardSummaryService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectBoardSummaryService(projectsService as never, projectBoardRealtime as never);
  });

  it('broadcasts rebuilt summary to the project room', async () => {
    const project = { id: 'p1' };
    const summary = { projectId: 'p1', openTicketCount: 2 };

    projectsService.buildSummary.mockResolvedValue(summary);

    await service.emitSummaryChanged(project as never);

    expect(projectsService.buildSummary).toHaveBeenCalledWith(project);
    expect(projectBoardRealtime.emitToProject).toHaveBeenCalledWith(
      'p1',
      PROJECTS_BOARD_EVENTS.projectSummaryChanged,
      summary,
    );
  });
});
