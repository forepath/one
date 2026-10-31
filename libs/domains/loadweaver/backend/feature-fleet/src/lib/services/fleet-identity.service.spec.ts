import { createPublicKey, verify } from 'node:crypto';

import { ConflictException } from '@nestjs/common';

import type { FleetSigningKeyEntity } from '../entities/fleet-signing-key.entity';
import { FleetIdentityService } from './fleet-identity.service';

const caller = { userId: 'u1', isApiKey: false, isAdmin: true, label: 'fleet:alice@example.com' };

function setup(users: Record<string, { email: string; emailConfirmedAt?: Date }> = {}) {
  const rows: FleetSigningKeyEntity[] = [];
  const where = (w: Partial<FleetSigningKeyEntity>) => (r: FleetSigningKeyEntity) =>
    Object.entries(w).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);
  const keys = {
    findOne: jest.fn(async ({ where: w }: { where: Partial<FleetSigningKeyEntity> }) => rows.find(where(w)) ?? null),
    find: jest.fn(async () => [...rows]),
    exists: jest.fn(async ({ where: w }: { where: Partial<FleetSigningKeyEntity> }) => rows.some(where(w))),
    create: jest.fn((x: Partial<FleetSigningKeyEntity>) => ({ createdAt: new Date(), ...x })),
    save: jest.fn(async (x: FleetSigningKeyEntity) => {
      rows.push(x);

      return x;
    }),
    manager: {
      transaction: async (fn: (m: unknown) => Promise<void>) =>
        await fn({
          getRepository: () => ({
            update: async (w: Partial<FleetSigningKeyEntity>, patch: Partial<FleetSigningKeyEntity>) =>
              rows.filter(where(w)).forEach((r) => Object.assign(r, patch)),
          }),
        }),
    },
  };
  const userRepo = { findOne: jest.fn(async ({ where: w }: { where: { id: string } }) => users[w.id] ?? null) };
  const audit = { record: jest.fn() };

  return { service: new FleetIdentityService(keys as never, userRepo as never, audit as never), rows, audit };
}

const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

describe('FleetIdentityService (3.24)', () => {
  it('creates the active key on first use and signs claims of users with the fleet grant', async () => {
    const { service, rows } = setup({ u1: { email: 'Alice@Example.com', emailConfirmedAt: new Date() } });
    const token = await service.claimFor(
      caller,
      { clusterRole: 'operator', projects: new Map([['shop', 'admin']]), readOnly: false },
      { audience: 'cluster-1', method: 'POST', url: '/api/plans/p1/approve', body: null },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'active', issuer: expect.stringMatching(/^fleet-/) });

    const [header, payload, signature] = (token as string).split('.');

    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        createPublicKey(rows[0].publicKey),
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(decode(token as string)).toMatchObject({
      iss: rows[0].issuer,
      aud: 'cluster-1',
      sub: 'u1',
      email: 'alice@example.com',
      email_verified: true,
      role: 'operator',
      prj: { shop: 'admin' },
    });
    await expect(service.personFor(caller)).resolves.toBe(`fleet:${rows[0].issuer}:u1`);
  });

  it('mints nothing for the static API key and marks unconfirmed emails as unverified', async () => {
    const { service } = setup({ u1: { email: 'a@x.io' } });
    const access = { clusterRole: 'admin' as const, projects: new Map(), readOnly: false };
    const request = { audience: 'c', method: 'GET', url: '/api/overview' };

    await expect(service.claimFor({ ...caller, userId: null, isApiKey: true }, access, request)).resolves.toBeNull();
    expect(decode((await service.claimFor(caller, access, request)) as string)).toMatchObject({
      email_verified: false,
    });
  });

  it('rotates: a next key for registration, activation retires the old one (same issuer), audited', async () => {
    const { service, rows, audit } = setup();
    const first = await service.describe();
    const withNext = await service.createNext(caller);

    await expect(service.createNext(caller)).rejects.toThrow(ConflictException);

    const next = withNext.keys.find((k) => k.state === 'next');

    if (!next) throw new Error('no next key');

    expect(next.fingerprint).toMatch(/^SHA256:/);

    const rotated = await service.activate(caller, next.kid);

    expect(rotated.issuer).toBe(first.issuer);
    expect(rotated.keys.map((k) => k.state).sort()).toEqual(['active', 'retired']);
    expect(rows.find((r) => r.kid === next.kid)?.state).toBe('active');
    expect(audit.record).toHaveBeenCalledWith(
      caller,
      'identity.key-activated',
      `identity/key/${next.kid}`,
      expect.anything(),
    );

    // New claims are signed with the new key.
    const token = await service.probeClaim('cluster-1');

    expect(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).kid).toBe(next.kid);
    expect(JSON.stringify(rotated)).not.toContain('PRIVATE KEY');
  });
});
