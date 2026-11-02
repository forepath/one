import { SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';

import { ProjectAccessService } from '../access/project-access.service';
import type { VerifiedFleetIdentity } from '../fleet-identity/fleet-identity.utils';
import { socketRequest, SocketSessionService } from './socket-session.service';

/** Socket handshakes of the Loadweaver control plane (user decision 2026-10-31, combined gate). */
describe('SocketSessionService', () => {
  const env = { ...process.env };
  const PAT = 'Bearer machine-jwt';
  const identity = (role: 'viewer' | 'operator' | 'admin' | null, projects: Record<string, 'viewer' | 'admin'> = {}) =>
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

  /** The API's guard: a machine (PAT) session with the given scopes, an interactive session, or a refusal. */
  function setup(
    options: {
      scopes?: string[];
      interactive?: boolean;
      evaluation?: unknown;
      socketUser?: SocketUserInfo | null;
    } = {},
  ) {
    const guard = {
      canActivate: jest.fn(async (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
        const req = context.switchToHttp().getRequest();
        const header = (req['headers'] as Record<string, string>)['authorization'];

        if (header === PAT)
          req['user'] = { id: 'svc', roles: ['admin'], amr: ['pat'], scopes: options.scopes ?? [], patId: 'p1' };
        else if (options.interactive) req['user'] = { id: 'u1', roles: ['user'], amr: ['pwd'] };
        else throw new Error('Invalid or expired token');

        return true;
      }),
    };
    const socketAuth = {
      validateAndGetUser: jest.fn(async () => (options.socketUser === undefined ? null : options.socketUser)),
    };
    const fleets = {
      evaluateSocket: jest.fn(async () => options.evaluation ?? { result: 'verified', identity: identity('viewer') }),
    };
    const service = new SocketSessionService(socketAuth as never, { get: () => guard } as never, fleets as never);

    return { service, guard, socketAuth, fleets };
  }

  const handshake = (authorization: string, fleetIdentity?: string) => ({
    headers: { authorization },
    auth: fleetIdentity ? { fleetIdentity } : {},
  });

  beforeEach(() => {
    process.env['AUTHENTICATION_METHOD'] = 'users';
    delete process.env['LOADWEAVER_API_KEY_FLEET_DELEGATION'];
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("accepts a PAT machine session on a non-exec namespace with that namespace's HTTP scope", async () => {
    const { service, socketAuth } = setup({ scopes: ['resources:read'] });
    const session = await service.authenticate(handshake(PAT), 'plans');

    expect(session.userInfo).toMatchObject({ userId: 'svc', isApiKeyAuth: false, amr: ['pat'] });
    expect(session.fleetIdentity).toBeUndefined();
    expect(socketAuth.validateAndGetUser).not.toHaveBeenCalled();
    // PAT sessions never inherit admin powers from the role claim.
    expect((await new ProjectAccessService(repos(), {} as never).caller(socketRequest(session))).clusterRole).toBe(
      undefined,
    );
  });

  it('refuses a PAT without the namespace scope', async () => {
    const { service } = setup({ scopes: ['resources:read'] });

    await expect(service.authenticate(handshake(PAT), 'logs')).rejects.toThrow('Unauthorized');
    await expect(service.authenticate(handshake(PAT), 'unknown')).rejects.toThrow('Unauthorized');
  });

  it('leaves interactive sessions and the API key to the shared socket auth', async () => {
    const interactive = setup({ interactive: true, socketUser: { userId: 'u1', isApiKeyAuth: false, amr: ['pwd'] } });

    expect((await interactive.service.authenticate(handshake('Bearer session'), 'logs')).userInfo.userId).toBe('u1');
    expect(interactive.socketAuth.validateAndGetUser).toHaveBeenCalledWith('Bearer session');

    process.env['AUTHENTICATION_METHOD'] = 'api-key';

    const key = setup({ socketUser: { isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } } });

    expect((await key.service.authenticate(handshake('Bearer key'), 'topology')).userInfo.isApiKeyAuth).toBe(true);
    expect(key.guard.canActivate).not.toHaveBeenCalled();

    await expect(setup().service.authenticate(handshake('Bearer nope'), 'plans')).rejects.toThrow('Unauthorized');
    await expect(setup().service.authenticate(undefined, 'plans')).rejects.toThrow('Unauthorized');
  });

  it('acts as the verified fleet person and caps the roles (PAT and API key)', async () => {
    const pat = setup({
      scopes: ['resources:read', 'fleet:on-behalf-of'],
      evaluation: { result: 'verified', identity: identity(null, { shop: 'viewer' }) },
    });
    const session = await pat.service.authenticate(handshake(PAT, 'claim'), 'plans');

    expect(pat.fleets.evaluateSocket).toHaveBeenCalledWith('claim', 'plans');
    expect(session.fleetIdentity?.person).toBe('fleet:fleet-1:alice');

    // The service user is a cluster admin; the person only views `shop`.
    const access = new ProjectAccessService(repos('cluster-admin'), {} as never);
    const capped = await access.caller(socketRequest(session));

    expect(capped).toMatchObject({ userId: 'fleet:fleet-1:alice', isApiKey: false });
    expect(capped.clusterRole).toBeUndefined();
    expect([...capped.projects]).toEqual([['shop', 'viewer']]);

    process.env['AUTHENTICATION_METHOD'] = 'api-key';

    const key = setup({
      socketUser: { isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } },
      evaluation: { result: 'verified', identity: identity('viewer') },
    });
    const viaKey = await key.service.authenticate(handshake('Bearer key', 'claim'), 'topology');

    expect(await access.caller(socketRequest(viaKey))).toMatchObject({
      isApiKey: false,
      userId: 'fleet:fleet-1:alice',
      clusterRole: 'auditor',
      allProjects: 'viewer',
    });
  });

  it('refuses invalid claims, claims of untrusted fleets and claims on credentials that cannot carry one', async () => {
    const scopes = ['resources:read', 'fleet:on-behalf-of'];

    await expect(
      setup({ scopes, evaluation: { result: 'refused', reason: 'claim expired' } }).service.authenticate(
        handshake(PAT, 'claim'),
        'plans',
      ),
    ).rejects.toThrow('fleet identity claim refused: claim expired');
    await expect(
      setup({
        scopes,
        evaluation: { result: 'ignored', reason: 'fleet evil is not trusted by this cluster' },
      }).service.authenticate(handshake(PAT, 'claim'), 'plans'),
    ).rejects.toThrow('fleet evil is not trusted');
    // A PAT without `fleet:on-behalf-of` and an interactive session never carry a person.
    await expect(
      setup({ scopes: ['resources:read'] }).service.authenticate(handshake(PAT, 'claim'), 'plans'),
    ).rejects.toThrow('only PATs with fleet:on-behalf-of');
    await expect(
      setup({ interactive: true, socketUser: { userId: 'u1', isApiKeyAuth: false } }).service.authenticate(
        handshake('Bearer session', 'claim'),
        'plans',
      ),
    ).rejects.toThrow('fleet identity claim refused');

    // The API key with delegation switched off.
    process.env['AUTHENTICATION_METHOD'] = 'api-key';
    process.env['LOADWEAVER_API_KEY_FLEET_DELEGATION'] = 'off';
    await expect(
      setup({ socketUser: { isApiKeyAuth: true } }).service.authenticate(handshake('Bearer key', 'claim'), 'plans'),
    ).rejects.toThrow('API key fleet delegation is off');
  });

  it('leaves the shared SocketAuthService as it is: PAT machine sessions stay refused there (Agenstra, Decabill)', async () => {
    const shared = new SocketAuthService(
      null,
      null,
      { verifyAsync: async () => ({ sub: 'svc', amr: ['pat'], patId: 'p1' }) } as never,
      { findById: async () => ({ id: 'svc', role: 'admin' }) } as never,
      null,
    );

    expect(await shared.validateAndGetUser('Bearer machine-jwt')).toBeNull();
  });

  function repos(clusterRole?: string) {
    return {
      manager: {
        getRepository: () => ({
          findOne: async () => (clusterRole ? { userId: 'svc', role: clusterRole } : null),
          find: async () => [],
        }),
      },
    } as never;
  }
});
