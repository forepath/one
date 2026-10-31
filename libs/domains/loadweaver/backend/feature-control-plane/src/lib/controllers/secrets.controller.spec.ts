import { PatScopesGuard, UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ProjectAccessService } from '../access/project-access.service';
import { ClusterMemberEntity, type ClusterRole } from '../entities/cluster-member.entity';
import type { ProjectRole } from '../entities/project-access.entity';
import { capRolesToFleetIdentity, type VerifiedFleetIdentity } from '../fleet-identity/fleet-identity.utils';
import {
  ListSecretNamesQueryDto,
  ListSecretsQueryDto,
  SecretNamesProjectDto,
  SecretsController,
} from './secrets.controller';

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
  const secrets = { setValue: jest.fn(), remove: jest.fn(), list: jest.fn(), listAll: jest.fn() };
  const controller = new SecretsController(secrets as never, access);
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

  it('denies metadata reads before querying for a non-member', async () => {
    await expect(controller.list('shop', request())).rejects.toMatchObject({ status: 403 });
    expect(secrets.list).not.toHaveBeenCalled();
  });

  it.each(['admin', 'operator'] as const)(
    'allows metadata reads for project %s without reserved names',
    async (role) => {
      projectMembers.find.mockResolvedValue([{ project: 'shop', role }]);
      secrets.list.mockResolvedValue([]);
      await expect(controller.list('shop', request())).resolves.toEqual({ items: [] });
      expect(secrets.list).toHaveBeenCalledWith('shop', false);
    },
  );

  it('caps API-key fleet roles as well as service-user roles and audits the person', async () => {
    const req = {
      apiKeyAuthenticated: true,
      fleetIdentity: { person: 'fleet:f:u', role: null, projects: { shop: 'operator' } },
    } as unknown as RequestWithUser;
    secrets.list.mockResolvedValue([]);
    await controller.list('shop', req);
    expect(secrets.list).toHaveBeenCalledWith('shop', false);
    await controller.set('shop', 'env', { value: 'private-value' }, req);
    expect(secrets.setValue.mock.calls[0][3]).toMatchObject({
      type: 'api-key',
      onBehalfOf: 'fleet:f:u',
      person: 'fleet:f:u',
    });
    await expect(controller.set('shop', 'lw-key', { value: 'private-value' }, req)).rejects.toMatchObject({
      status: 403,
    });
    await expect(controller.list('other', req)).rejects.toMatchObject({
      status: 403,
      message: 'project operator or admin role required',
    });
  });

  it('refuses a fleet service credential without a verified person on every route', async () => {
    clusterMembers.findOne.mockResolvedValue({ role: 'cluster-admin' });
    const req = request(true, ['secrets:read', 'secrets:write', 'fleet:on-behalf-of']);
    for (const operation of [
      () => controller.list('shop', req),
      () => controller.listNames({ project: 'shop' }, new ListSecretNamesQueryDto(), req),
      () => controller.listAll(new ListSecretsQueryDto(), req),
      () => controller.set('shop', 'env', { value: 'private-value' }, req),
      () => controller.remove('shop', 'env', req),
    ])
      await expect(operation()).rejects.toMatchObject({
        status: 403,
        message: 'secrets through a fleet need a verified fleet identity',
      });
    expect(secrets.setValue).not.toHaveBeenCalled();
  });

  it('passes the capped caller and filters to listAll without denying an empty project set', async () => {
    secrets.listAll.mockResolvedValue([]);
    await expect(controller.listAll({ project: 'other', q: 'DB', limit: 1 }, request())).resolves.toEqual({
      items: [],
    });
    expect(secrets.listAll).toHaveBeenCalledWith(expect.objectContaining({ projects: new Map() }), {
      project: 'other',
      q: 'DB',
      limit: 1,
    });
  });
});

describe('SecretsController.listNames', () => {
  const secrets = { listNames: jest.fn() };
  const projectAccess = { caller: jest.fn() };
  const controller = new SecretsController(secrets as never, projectAccess as never);
  const guard = new PatScopesGuard(new Reflector());
  const req = (amr = ['pwd'], scopes = ['secrets:read'], roles = [UserRole.USER]) =>
    ({ user: { id: 'owner', roles, amr, scopes } }) as unknown as RequestWithUser;
  const read = async (request = req(), query = new ListSecretNamesQueryDto()) => {
    guard.canActivate({
      getHandler: () => SecretsController.prototype.listNames,
      getClass: () => SecretsController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext);

    return await controller.listNames({ project: 'shop' }, query, request);
  };
  let originalAuth: string | undefined;

  beforeEach(() => {
    originalAuth = process.env.AUTHENTICATION_METHOD;
    process.env.AUTHENTICATION_METHOD = 'users';
    projectAccess.caller.mockResolvedValue({ userId: 'owner', projects: new Map([['shop', 'admin']]) });
    secrets.listNames.mockResolvedValue({ items: [{ name: 'db-password' }] });
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalAuth === undefined) delete process.env.AUTHENTICATION_METHOD;
    else process.env.AUTHENTICATION_METHOD = originalAuth;
  });

  it('returns names only for a project member with the existing cluster-admin read permission', async () => {
    const result = await read();

    expect(result).toEqual({ items: [{ name: 'db-password' }] });
    expect(Object.keys(result)).toEqual(['items']);
    expect(Object.keys(result.items[0])).toEqual(['name']);
    expect(secrets.listNames).toHaveBeenCalledWith('shop', undefined, 50, false);
  });

  it('passes the substring and bounded limit to the names-only service, not the legacy list', async () => {
    await read(req(), { q: 'DB', limit: 2 });
    expect(secrets.listNames).toHaveBeenCalledWith('shop', 'DB', 2, false);
  });

  it.each(['developer', 'viewer', undefined] as const)(
    'denies project role %s before lookup, regardless of infra-operator rights',
    async (role) => {
      projectAccess.caller.mockResolvedValue({
        clusterRole: 'infra-operator',
        projects: new Map(role ? [['shop', role]] : []),
      });
      await expect(read()).rejects.toMatchObject({ status: 403 });
      expect(secrets.listNames).not.toHaveBeenCalled();
    },
  );

  it('requires secrets:read on PATs', async () => {
    await expect(read(req(['pat'], ['secrets:write']))).rejects.toMatchObject({ status: 403 });
    expect(secrets.listNames).not.toHaveBeenCalled();
    await expect(read(req(['pat']))).resolves.toEqual({ items: [{ name: 'db-password' }] });
  });

  it('does not inherit admin JWT roles for PATs', async () => {
    projectAccess.caller.mockResolvedValue({ projects: new Map() });
    await expect(read(req(['pat'], ['secrets:read'], [UserRole.ADMIN]))).rejects.toMatchObject({ status: 403 });
    expect(secrets.listNames).not.toHaveBeenCalled();
    projectAccess.caller.mockResolvedValue({ clusterRole: 'cluster-admin', projects: new Map() });
    await expect(read(req(['pwd'], [], [UserRole.ADMIN]))).resolves.toBeDefined();
    expect(secrets.listNames).toHaveBeenCalledWith('shop', undefined, 50, true);
  });

  it('allows fleet project grants only up to the service user permission', async () => {
    const fleetReq = (role: 'admin' | 'viewer' | null) =>
      ({
        ...req(['pat'], ['secrets:read', 'fleet:on-behalf-of']),
        fleetIdentity: { person: 'fleet:f:u', role, projects: { shop: 'viewer' } },
      }) as unknown as RequestWithUser;

    for (const role of ['viewer', null] as const) {
      await expect(read(fleetReq(role))).rejects.toMatchObject({ status: 403 });
    }
    expect(secrets.listNames).not.toHaveBeenCalled();
    await expect(read(fleetReq('admin'))).resolves.toBeDefined();
    projectAccess.caller.mockResolvedValue({ projects: new Map([['shop', 'viewer']]) });
    await expect(read(fleetReq('admin'))).rejects.toMatchObject({ status: 403 });
    expect(secrets.listNames).toHaveBeenCalledTimes(1);
  });

  it('uses the shared cap for a project-only operator claim', async () => {
    const identity = { role: null, projects: { shop: 'operator' } } as unknown as VerifiedFleetIdentity;
    expect(capRolesToFleetIdentity({ clusterRole: 'cluster-admin', projects: new Map() }, identity)).toMatchObject({
      projects: new Map([['shop', 'operator']]),
    });
    const request = {
      ...req(['pat'], ['secrets:read', 'fleet:on-behalf-of']),
      fleetIdentity: identity,
    } as unknown as RequestWithUser;
    await expect(read(request)).resolves.toBeDefined();
  });

  describe('input validation through the application ValidationPipe', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const query = (value: unknown) => pipe.transform(value, { type: 'query', metatype: ListSecretNamesQueryDto });
    const project = (value: unknown) => pipe.transform(value, { type: 'param', metatype: SecretNamesProjectDto });
    const all = (value: unknown) => pipe.transform(value, { type: 'query', metatype: ListSecretsQueryDto });

    it('validates listAll bounds and refuses repeated project, q and limit parameters', async () => {
      await expect(all({})).resolves.toEqual({ limit: 200 });
      await expect(all({ project: 'shop', q: 'DB', limit: '500' })).resolves.toEqual({
        project: 'shop',
        q: 'DB',
        limit: 500,
      });
      for (const query of [
        { project: ['shop', 'other'] },
        { q: ['a', 'b'] },
        { limit: ['1', '2'] },
        { limit: '0' },
        { limit: '501' },
      ])
        await expect(all(query)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults to 50 and transforms integer query strings, including both bounds', async () => {
      await expect(query({})).resolves.toEqual({ limit: 50 });
      for (const limit of ['1', '200']) {
        await expect(query({ q: 'A'.repeat(200), limit })).resolves.toEqual({ q: 'A'.repeat(200), limit: +limit });
      }
    });

    it.each(['0', '201', '-1', '1.5', 'abc', '', ['1', '2']])('rejects invalid limit %s', async (limit) => {
      await expect(query({ limit })).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['x'.repeat(201), ['db', 'env'], { name: 'db' }])('rejects invalid q %s', async (q) => {
      await expect(query({ q })).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([{}, { project: '' }, { project: 'Shop' }, { project: '../shop' }, { project: 'x'.repeat(64) }])(
      'rejects invalid or missing project %s',
      async (params) => {
        await expect(project(params)).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('accepts the existing project pattern and rejects unknown query fields', async () => {
      await expect(project({ project: 'shop-1' })).resolves.toEqual({ project: 'shop-1' });
      await expect(query({ value: 'not-allowed' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
