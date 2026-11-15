import { UsersController } from './users.controller';

describe('UsersController', () => {
  const mockUsersService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    getUsersCount: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    lockUser: jest.fn(),
    unlockUser: jest.fn(),
    confirmEmail: jest.fn(),
    remove: jest.fn(),
  };
  let controller: UsersController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UsersController(mockUsersService as any);
  });

  it('delegates lock endpoint with requesting user id', async () => {
    mockUsersService.lockUser.mockResolvedValue({ id: 'target-1' });

    await controller.lock('target-1', { user: { id: 'admin-1' } } as any);

    expect(mockUsersService.lockUser).toHaveBeenCalledWith('target-1', 'admin-1');
  });

  it('delegates unlock endpoint with requesting user id', async () => {
    mockUsersService.unlockUser.mockResolvedValue({ id: 'target-1' });

    await controller.unlock('target-1', { user: { id: 'admin-1' } } as any);

    expect(mockUsersService.unlockUser).toHaveBeenCalledWith('target-1', 'admin-1');
  });

  it('delegates confirm-email endpoint', async () => {
    mockUsersService.confirmEmail.mockResolvedValue({ id: 'target-1' });

    await controller.confirmEmail('target-1');

    expect(mockUsersService.confirmEmail).toHaveBeenCalledWith('target-1');
  });
});
