import { PatScopesGuard, type RequestWithUser } from '@forepath/identity/backend';
import { ConflictException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { ProjectAccessService } from '../access/project-access.service';
import { SecretsService } from '../services/secrets.service';
import { SecretsController } from './secrets.controller';

describe('secrets HTTP response safety (unit app, no database)', () => {
  let app: INestApplication;
  let base: string;
  let scopes: string[];
  const usedBy = [{ kind: 'Deployment', project: 'shop', name: 'app', pinnedVersion: 2 }];
  const summary = {
    project: 'shop',
    name: 'password',
    version: 3,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    updatedBy: 'owner',
    reserved: false,
    usedBy,
  };
  const secrets = { list: jest.fn(), listAll: jest.fn(), listNames: jest.fn(), setValue: jest.fn(), remove: jest.fn() };
  const access = { caller: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SecretsController],
      providers: [
        { provide: SecretsService, useValue: secrets },
        { provide: ProjectAccessService, useValue: access },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use((req: RequestWithUser, _res: unknown, next: () => void) => {
      req.user = { id: 'owner', amr: ['pat'], scopes } as RequestWithUser['user'];
      next();
    });
    app.useGlobalGuards(new PatScopesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    scopes = ['secrets:read', 'secrets:write'];
    access.caller.mockResolvedValue({ projects: new Map([['shop', 'operator']]) });
    secrets.list.mockResolvedValue([summary]);
    secrets.listAll.mockResolvedValue([summary]);
    secrets.listNames.mockResolvedValue({ items: [{ name: 'password' }] });
    secrets.setValue.mockResolvedValue(summary);
    secrets.remove.mockResolvedValue(undefined);
  });

  it.each([
    ['GET', '/projects/shop/secrets', 200],
    ['GET', '/projects/shop/secrets/names', 200],
    ['GET', '/secrets?project=shop', 200],
    ['PUT', '/projects/shop/secrets/password', 200],
    ['DELETE', '/projects/shop/secrets/password', 204],
  ])('sets no-store on %s %s and never returns a submitted value', async (method, path, status) => {
    const response = await fetch(`${base}/api${path}`, {
      method: String(method),
      headers: { 'content-type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify({ value: 'private-value' }) : undefined,
    });
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    for (const forbidden of ['private-value', 'ciphertext', 'wrappedKey', 'fingerprint'])
      expect(text).not.toContain(forbidden);
  });

  it('sets no-store on scope and role denials, bad queries, body validation and 409 errors', async () => {
    scopes = [];
    let response = await fetch(`${base}/api/projects/shop/secrets`);
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    scopes = ['secrets:read', 'secrets:write'];
    access.caller.mockResolvedValue({ projects: new Map() });
    response = await fetch(`${base}/api/projects/missing/secrets`);
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    response = await fetch(`${base}/api/secrets?project=shop&project=other`);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    response = await fetch(`${base}/api/projects/shop/secrets/password`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { input: 'private-value' } }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('private-value');
    access.caller.mockResolvedValue({ projects: new Map([['shop', 'operator']]) });
    secrets.remove.mockRejectedValue(
      new ConflictException({ message: 'secret is in use; remove the references first', usedBy }),
    );
    response = await fetch(`${base}/api/projects/shop/secrets/password`, { method: 'DELETE' });
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ message: 'secret is in use; remove the references first', usedBy });
  });
});
