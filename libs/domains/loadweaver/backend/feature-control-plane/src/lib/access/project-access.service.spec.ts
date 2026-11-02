import type { RequestWithUser } from '@forepath/identity/backend';

import type { FleetGrantRole, VerifiedFleetIdentity } from '../fleet-identity/fleet-identity.utils';
import { ProjectAccessService } from './project-access.service';

/** The caller's roles (3.17) for the cluster's API key, alone and delegating a fleet person (2026-10-29). */
describe('ProjectAccessService.caller: API key fleet delegation', () => {
  const access = new ProjectAccessService(
    { manager: { getRepository: () => ({ findOne: async () => null, find: async () => [] }) } } as never,
    {} as never,
  );
  const identity = (role: FleetGrantRole | null, projects: Record<string, FleetGrantRole> = {}) =>
    ({
      person: 'fleet:fleet-1:alice',
      issuer: 'fleet-1',
      subject: 'alice',
      email: 'alice@example.com',
      emailVerified: true,
      role,
      projects,
      jti: 'jti-0123456789abcdef',
      expiresAt: new Date(Date.now() + 60_000),
    }) satisfies VerifiedFleetIdentity;
  const apiKey = (person?: VerifiedFleetIdentity) =>
    ({
      apiKeyAuthenticated: true,
      user: { id: 'api-key-user', roles: ['admin', 'user'] },
      ...(person ? { fleetIdentity: person } : {}),
    }) as unknown as RequestWithUser;

  it('keeps the API key a cluster admin without a person', async () => {
    expect(await access.caller(apiKey())).toEqual({
      isApiKey: true,
      clusterRole: 'cluster-admin',
      projects: new Map(),
    });
  });

  it('acts as the verified person, capped by the claim (combined gate: the key used to stay admin)', async () => {
    const viewer = await access.caller(apiKey(identity('viewer')));

    // A cluster-wide viewer grant reads like an auditor: no plans, no changes.
    expect(viewer).toMatchObject({
      isApiKey: false,
      userId: 'fleet:fleet-1:alice',
      clusterRole: 'auditor',
      allProjects: 'viewer',
    });

    const shopAdmin = await access.caller(apiKey(identity(null, { shop: 'admin' })));

    expect(shopAdmin).toMatchObject({ isApiKey: false, userId: 'fleet:fleet-1:alice' });
    expect([...shopAdmin.projects]).toEqual([['shop', 'admin']]);
    expect(shopAdmin.clusterRole).toBeUndefined();

    expect(await access.caller(apiKey(identity('admin')))).toMatchObject({
      isApiKey: false,
      userId: 'fleet:fleet-1:alice',
      clusterRole: 'cluster-admin',
    });
  });
});
