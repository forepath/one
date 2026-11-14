import { checkClientAccess, REQUIRE_SCOPES_KEY, UserRole } from '@forepath/identity/backend';

import { ClientsController } from '../controllers/clients.controller';

import { VncGateway } from './vnc.gateway';

describe('VNC websocket for machine tokens', () => {
  it('requires the VNC websocket scope to mint a session ticket', () => {
    const handler = ClientsController.prototype.createClientAgentVncSession;

    expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, handler)).toEqual(['agent_vnc:write', 'websocket:vnc:write']);
  });

  it('keeps PAT / app token tickets on workspace membership checks (no admin bypass)', async () => {
    const gateway = Object.create(VncGateway.prototype) as {
      buildSyntheticRequest: (record: unknown) => { user?: { amr?: string[]; roles?: string[] } };
    };
    const req = gateway.buildSyntheticRequest({
      subject: 'user-1',
      isApiKeyAuth: false,
      userRole: UserRole.ADMIN,
      amr: ['pat'],
    });
    const clients = { findById: jest.fn().mockResolvedValue({ id: 'c1', userId: 'someone-else' }) };
    const members = { findUserClientAccess: jest.fn().mockResolvedValue(null) };

    expect(req.user?.amr).toEqual(['pat']);
    await expect(
      checkClientAccess(clients, members, 'c1', 'user-1', UserRole.ADMIN, false, { amr: req.user?.amr }),
    ).resolves.toEqual({ hasAccess: false, isClientCreator: false });
  });

  it('leaves interactive tickets unchanged', () => {
    const gateway = Object.create(VncGateway.prototype) as {
      buildSyntheticRequest: (record: unknown) => { user?: { amr?: string[]; roles?: string[] } };
    };

    expect(gateway.buildSyntheticRequest({ subject: 'u', isApiKeyAuth: false, userRole: UserRole.ADMIN })).toEqual({
      user: { id: 'u', roles: [UserRole.ADMIN] },
    });
  });
});
