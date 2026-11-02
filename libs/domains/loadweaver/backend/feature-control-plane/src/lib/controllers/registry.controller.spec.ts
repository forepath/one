import type { RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AccessCaller } from '../access/access.utils';
import type { ProjectAccessService } from '../access/project-access.service';
import type { RegistryTokenService } from '../services/registry-token.service';
import { RegistryController } from './registry.controller';

describe('RegistryController (project roles, 2026-10-26)', () => {
  const setup = (caller: AccessCaller) => {
    const tokens = {
      issue: jest.fn().mockResolvedValue('t'),
      issueWithCatalog: jest.fn().mockResolvedValue('c'),
    };
    const dataSource = {
      getRepository: () => ({ find: async () => [{ name: 'shop' }, { name: 'other' }] }),
    } as unknown as DataSource;
    const access = { caller: async () => caller } as unknown as ProjectAccessService;

    return {
      tokens,
      controller: new RegistryController(dataSource, tokens as unknown as RegistryTokenService, access),
    };
  };
  const developer: AccessCaller = { userId: 'u1', isApiKey: false, projects: new Map([['shop', 'developer']]) };
  const req = (scopes?: string[]) =>
    ({
      user: { id: 'u1', roles: ['user'], ...(scopes ? { amr: ['pat'], scopes } : {}) },
    }) as unknown as RequestWithUser;
  const scope = ['repository:shop/api:pull,push', 'repository:other/api:pull,push'];

  it('logs a project member in without any cluster role', async () => {
    const { controller, tokens } = setup(developer);

    await expect(controller.token('loadweaver-registry', undefined, req())).resolves.toMatchObject({ token: 't' });
    expect(tokens.issue).toHaveBeenCalledWith('user:u1', [], 300);
  });

  it('refuses login for users without any membership', async () => {
    const { controller } = setup({ userId: 'u2', isApiKey: false, projects: new Map() });

    await expect(controller.token(undefined, undefined, req())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grants the own project only and narrows push to PATs with registry:push', async () => {
    const { controller, tokens } = setup(developer);

    await controller.token(undefined, scope, req());
    expect(tokens.issue).toHaveBeenLastCalledWith('user:u1', [{ name: 'shop/api', actions: ['pull', 'push'] }], 300);

    await controller.token(undefined, scope, req(['registry:pull']));
    expect(tokens.issue).toHaveBeenLastCalledWith('user:u1', [{ name: 'shop/api', actions: ['pull'] }], 300);

    await controller.token(undefined, scope, req(['registry:pull', 'registry:push']));
    expect(tokens.issue).toHaveBeenLastCalledWith('user:u1', [{ name: 'shop/api', actions: ['pull', 'push'] }], 300);
  });

  it('gives cluster admins every project and the catalog only to cluster roles', async () => {
    const admin = setup({ userId: 'u1', isApiKey: false, clusterRole: 'cluster-admin', projects: new Map() });

    await admin.controller.token(undefined, [...scope, 'registry:catalog:*'], req());
    expect(admin.tokens.issueWithCatalog).toHaveBeenCalledWith(
      'user:u1',
      [
        { name: 'shop/api', actions: ['pull', 'push'] },
        { name: 'other/api', actions: ['pull', 'push'] },
      ],
      300,
    );

    const dev = setup(developer);

    await dev.controller.token(undefined, 'registry:catalog:*', req());
    expect(dev.tokens.issueWithCatalog).not.toHaveBeenCalled();
    expect(dev.tokens.issue).toHaveBeenCalledWith('user:u1', [], 300);
  });
});
