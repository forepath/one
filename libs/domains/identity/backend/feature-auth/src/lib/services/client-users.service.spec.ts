import { ClientUserRole, UserRole } from '@forepath/identity/backend';
import { BadRequestException } from '@nestjs/common';

import { ClientUsersService } from './client-users.service';

describe('ClientUsersService (console roles)', () => {
  const clientUsersRepository = {
    findByUserAndClient: jest.fn(),
    create: jest.fn(),
    findByIdOrThrow: jest.fn(),
    delete: jest.fn(),
  };
  const usersRepository = { findByEmail: jest.fn() };
  let service: ClientUsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    usersRepository.findByEmail.mockResolvedValue({ id: 'target', email: 't@example.com' });
    clientUsersRepository.findByUserAndClient.mockResolvedValue(null);
    clientUsersRepository.create.mockImplementation(async (data: object) => ({
      id: 'rel-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...data,
    }));
    clientUsersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'rel-1',
      clientId: 'c1',
      userId: 'target',
      role: ClientUserRole.ADMIN,
    });
    service = new ClientUsersService(clientUsersRepository as never, usersRepository as never, null, null);
  });

  it.each([UserRole.ADMIN, UserRole.MANAGER])('lets a console %s add workspace admins', async (role) => {
    await expect(
      service.addUserToClient('c1', { email: 't@example.com', role: ClientUserRole.ADMIN }, 'actor', role, false),
    ).resolves.toEqual(expect.objectContaining({ role: ClientUserRole.ADMIN }));
  });

  it.each([UserRole.ADMIN, UserRole.MANAGER])('lets a console %s remove workspace admins', async (role) => {
    await expect(service.removeUserFromClient('c1', 'rel-1', 'actor', role, false)).resolves.toBeUndefined();
  });

  it('does not give PAT sessions of managers the console bypass', async () => {
    await expect(
      service.addUserToClient(
        'c1',
        { email: 't@example.com', role: ClientUserRole.ADMIN },
        'actor',
        UserRole.MANAGER,
        false,
        undefined,
        {
          amr: ['pat'],
        },
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.removeUserFromClient('c1', 'rel-1', 'actor', UserRole.MANAGER, false, undefined, { amr: ['pat'] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps regular users without membership out', async () => {
    await expect(
      service.addUserToClient(
        'c1',
        { email: 't@example.com', role: ClientUserRole.USER },
        'actor',
        UserRole.USER,
        false,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
