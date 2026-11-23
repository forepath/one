import { UserRole } from '@forepath/identity/backend';
import { UnauthorizedException } from '@nestjs/common';

import { SessionRoleController } from './session-role.controller';

describe('SessionRoleController', () => {
  const usersRepository = { findById: jest.fn() };
  let controller: SessionRoleController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SessionRoleController(usersRepository as never);
  });

  it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.USER])('returns the live DB role %s', async (role) => {
    usersRepository.findById.mockResolvedValue({ id: 'u1', role });

    await expect(controller.getRole({ user: { id: 'u1', roles: ['admin'] } } as never)).resolves.toEqual({ role });
    expect(usersRepository.findById).toHaveBeenCalledWith('u1');
  });

  it('reads the DB role, not the (possibly stale) JWT role claim', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'u1', role: UserRole.USER });

    await expect(controller.getRole({ user: { id: 'u1', roles: ['admin'] } } as never)).resolves.toEqual({
      role: UserRole.USER,
    });
  });

  it('maps non-console roles to user', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'u1', role: UserRole.CONTROLLER });

    await expect(controller.getRole({ user: { id: 'u1', roles: [] } } as never)).resolves.toEqual({
      role: UserRole.USER,
    });
  });

  it('rejects unknown users', async () => {
    usersRepository.findById.mockResolvedValue(null);

    await expect(controller.getRole({ user: { id: 'gone', roles: [] } } as never)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(controller.getRole({} as never)).rejects.toThrow(UnauthorizedException);
  });
});
