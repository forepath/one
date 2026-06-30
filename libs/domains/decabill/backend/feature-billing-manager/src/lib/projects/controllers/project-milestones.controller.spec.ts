import { BadRequestException } from '@nestjs/common';

import { ProjectMilestonesController } from './project-milestones.controller';

describe('ProjectMilestonesController', () => {
  const milestonesService = {
    list: jest.fn().mockResolvedValue([]),
  };
  const controller = new ProjectMilestonesController(milestonesService as never);
  const authReq = { user: { id: 'user-1' } } as never;
  const projectId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    jest.resetAllMocks();
    milestonesService.list.mockResolvedValue([]);
  });

  it('rejects unauthenticated list requests', async () => {
    await expect(controller.list(projectId, {} as never)).rejects.toThrow(BadRequestException);
    expect(milestonesService.list).not.toHaveBeenCalled();
  });

  it('passes authenticated user to list service', async () => {
    await controller.list(projectId, authReq);

    expect(milestonesService.list).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ userId: 'user-1', isApiKeyAuth: false }),
    );
  });
});
