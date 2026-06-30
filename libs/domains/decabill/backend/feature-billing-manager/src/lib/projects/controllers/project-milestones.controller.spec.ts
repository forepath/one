import { BadRequestException } from '@nestjs/common';

import { ProjectMilestonesController } from './project-milestones.controller';

describe('ProjectMilestonesController', () => {
  const milestonesService = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'm1' }),
    update: jest.fn().mockResolvedValue({ id: 'm1' }),
    lock: jest.fn().mockResolvedValue({ id: 'm1' }),
    delete: jest.fn().mockResolvedValue(undefined),
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

  it('delegates create, update, lock, and delete', async () => {
    const milestoneId = '22222222-2222-4222-8222-222222222222';

    await controller.create(projectId, { name: 'M1' }, authReq);
    await controller.update(projectId, milestoneId, { name: 'M2' }, authReq);
    await controller.lock(projectId, milestoneId, authReq);
    await controller.delete(projectId, milestoneId, authReq);

    expect(milestonesService.create).toHaveBeenCalled();
    expect(milestonesService.update).toHaveBeenCalled();
    expect(milestonesService.lock).toHaveBeenCalled();
    expect(milestonesService.delete).toHaveBeenCalled();
  });
});
