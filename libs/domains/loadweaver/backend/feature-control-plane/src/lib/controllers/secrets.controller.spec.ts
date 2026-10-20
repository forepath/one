import { PatScopesGuard, UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ProjectAccessService } from '../access/project-access.service';
import { ClusterMemberEntity, type ClusterRole } from '../entities/cluster-member.entity';
import type { ProjectRole } from '../entities/project-access.entity';
import { SecretsController } from './secrets.controller';

describe('SecretsController', () => {
  const clusterMembers = { findOne: jest.fn() };
  const projectMembers = { find: jest.fn() };
  const access = new ProjectAccessService(
    {
      manager: {
        getRepository: (entity: unknown) => (entity === ClusterMemberEntity ? clusterMembers : projectMembers),
      },
    } as never,
    {} as never,
  );
  const secrets = { setValue: jest.fn(), remove: jest.fn(), list: jest.fn() };
  const clusterAccess = { assert: jest.fn() };
  const controller = new SecretsController(secrets as never, clusterAccess as never, access);
  const guard = new PatScopesGuard(new Reflector());
  const request = (pat = false, scopes = ['secrets:write'], roles = [UserRole.USER]) =>
    ({ user: { id: 'owner', roles, amr: [pat ? 'pat' : 'pwd'], scopes } }) as unknown as RequestWithUser;
  const write = async (method: 'set' | 'remove', req = request(), name = 'env', project = 'shop') => {
    const context = {
      getHandler: () => SecretsController.prototype[method],
      getClass: () => SecretsController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    guard.canActivate(context);

    return method === 'set'
      ? await controller.set(project, name, { value: 'private-value' }, req)
      : await controller.remove(project, name, req);
  };
  let originalAuth: string | undefined;

  beforeEach(() => {
    originalAuth = process.env.AUTHENTICATION_METHOD;
    process.env.AUTHENTICATION_METHOD = 'users';
    clusterMembers.findOne.mockResolvedValue(null);
    projectMembers.find.mockResolvedValue([]);
    secrets.setValue.mockResolvedValue({ version: 1 });
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalAuth === undefined) delete process.env.AUTHENTICATION_METHOD;
    else process.env.AUTHENTICATION_METHOD = originalAuth;
  });

  describe.each(['set', 'remove'] as const)('%s', (method) => {
    it.each(['admin', 'operator'] as ProjectRole[])('allows project %s', async (role) => {
      projectMembers.find.mockResolvedValue([{ project: 'shop', role }]);
      await write(method);
      expect(secrets[method === 'set' ? 'setValue' : 'remove']).toHaveBeenCalledWith(
        'shop',
        'env',
        ...(method === 'set' ? [Buffer.alloc('private-value'.length)] : []),
        { type: 'user', id: 'owner' },
        { req: request() },
      );
    });

    it.each(['developer', 'viewer'] as ProjectRole[])('denies project %s', async (role) => {
      projectMembers.find.mockResolvedValue([{ project: 'shop', role }]);
      await expect(write(method)).rejects.toBeInstanceOf(ForbiddenException);
      expect(secrets.setValue).not.toHaveBeenCalled();
      expect(secrets.remove).not.toHaveBeenCalled();
    });

    it.each([undefined, 'infra-operator'] as (ClusterRole | undefined)[])(
      'denies a non-member with cluster role %s without revealing project existence',
      async (role) => {
        clusterMembers.findOne.mockResolvedValue(role ? { role } : null);
        for (const project of ['shop', 'missing']) {
          await expect(write(method, request(), 'env', project)).rejects.toMatchObject({ status: 403 });
        }
        expect(secrets.setValue).not.toHaveBeenCalled();
        expect(secrets.remove).not.toHaveBeenCalled();
      },
    );

    it('allows an infra operator who is a project operator', async () => {
      clusterMembers.findOne.mockResolvedValue({ role: 'infra-operator' });
      projectMembers.find.mockResolvedValue([{ project: 'shop', role: 'operator' }]);
      await expect(write(method)).resolves.not.toThrow();
    });

    it('allows cluster admins for ordinary and reserved secrets', async () => {
      clusterMembers.findOne.mockResolvedValue({ role: 'cluster-admin' });
      await write(method);
      await write(method, request(), 'lw-reserved');
    });

    it.each(['admin', 'operator'] as ProjectRole[])('denies lw- names for project %s, including PATs', async (role) => {
      projectMembers.find.mockResolvedValue([{ project: 'shop', role }]);
      for (const pat of [false, true]) {
        await expect(write(method, request(pat), 'lw-reserved')).rejects.toMatchObject({ status: 403 });
      }
      expect(secrets.setValue).not.toHaveBeenCalled();
      expect(secrets.remove).not.toHaveBeenCalled();
    });

    it('denies a PAT without secrets:write', async () => {
      projectMembers.find.mockResolvedValue([{ project: 'shop', role: 'operator' }]);
      await expect(write(method, request(true, ['secrets:read']))).rejects.toMatchObject({ status: 403 });
      expect(secrets.setValue).not.toHaveBeenCalled();
      expect(secrets.remove).not.toHaveBeenCalled();
    });

    it('bounds a scoped PAT by its viewer owner, ignoring an admin JWT claim', async () => {
      projectMembers.find.mockResolvedValue([{ project: 'shop', role: 'viewer' }]);
      await expect(write(method, request(true, ['secrets:write'], [UserRole.ADMIN]))).rejects.toMatchObject({
        status: 403,
      });
    });

    it('allows a scoped operator PAT and re-evaluates its membership', async () => {
      projectMembers.find.mockResolvedValue([{ project: 'shop', role: 'operator' }]);
      const req = request(true);
      await write(method, req);
      projectMembers.find.mockResolvedValue([{ project: 'shop', role: 'viewer' }]);
      await expect(write(method, req)).rejects.toMatchObject({ status: 403 });
    });
  });

  it('keeps metadata reads cluster-admin only', async () => {
    clusterAccess.assert.mockRejectedValue(new ForbiddenException());
    await expect(controller.list('shop', request())).rejects.toMatchObject({ status: 403 });
    expect(secrets.list).not.toHaveBeenCalled();
  });
});
