import { UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import type { DeploymentConnectionsService } from '../services/deployment-connections.service';

import { DeploymentConnectionsController } from './deployment-connections.controller';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('DeploymentConnectionsController', () => {
  let service: Record<string, jest.Mock>;
  let controller: DeploymentConnectionsController;
  const admin = { user: { id: 'admin-1', roles: [UserRole.ADMIN] } } as unknown as RequestWithUser;
  const user = { user: { id: 'user-1', roles: ['user'] } } as unknown as RequestWithUser;
  const apiKey = { apiKeyAuthenticated: true } as unknown as RequestWithUser;

  beforeEach(() => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: ID }),
      create: jest.fn().mockResolvedValue({ id: ID }),
      update: jest.fn().mockResolvedValue({ id: ID }),
      delete: jest.fn().mockResolvedValue(undefined),
      test: jest.fn().mockResolvedValue({ ok: true, testedAt: 'now' }),
    };
    controller = new DeploymentConnectionsController(service as unknown as DeploymentConnectionsService);
  });

  it('lists with defaults for admins and API keys', async () => {
    await controller.list(admin);
    expect(service.findAll).toHaveBeenCalledWith(10, 0, undefined, undefined);
    await controller.list(apiKey, 5, 10, 'x', 'github');
    expect(service.findAll).toHaveBeenLastCalledWith(5, 10, 'x', 'github');
  });

  it('rejects non-admin users on every route', async () => {
    await expect(controller.list(user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.get(ID, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.create({ label: 'x', provider: 'gitlab' }, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.update(ID, {}, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.delete(ID, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.test(ID, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(Object.values(service).every((m) => m.mock.calls.length === 0)).toBe(true);
  });

  it('delegates CRUD and test to the service', async () => {
    await controller.get(ID, admin);
    await controller.create({ label: 'x', provider: 'gitlab', token: 't' }, admin);
    await controller.update(ID, { label: 'y' }, admin);
    await controller.delete(ID, admin);
    await controller.test(ID, admin);

    expect(service.findOne).toHaveBeenCalledWith(ID);
    expect(service.create).toHaveBeenCalledWith({ label: 'x', provider: 'gitlab', token: 't' }, 'admin-1');
    expect(service.update).toHaveBeenCalledWith(ID, { label: 'y' });
    expect(service.delete).toHaveBeenCalledWith(ID);
    expect(service.test).toHaveBeenCalledWith(ID);
  });
});
