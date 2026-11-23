import { REQUIRE_SCOPES_KEY, UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import type { AdminOverviewService } from '../services/admin-overview.service';
import type { ClientsService } from '../services/clients.service';

import { AdminOverviewController } from './admin-overview.controller';

describe('AdminOverviewController', () => {
  let clientsService: { getAccessibleClientIds: jest.Mock };
  let overviewService: { getOverview: jest.Mock };
  let controller: AdminOverviewController;
  const request = (role: string, amr?: string[]) =>
    ({ user: { id: `${role}-1`, roles: [role], ...(amr ? { amr } : {}) } }) as unknown as RequestWithUser;

  beforeEach(() => {
    clientsService = { getAccessibleClientIds: jest.fn().mockResolvedValue(['c1', 'c2']) };
    overviewService = { getOverview: jest.fn().mockResolvedValue({ scope: 'all' }) };
    controller = new AdminOverviewController(
      clientsService as unknown as ClientsService,
      overviewService as unknown as AdminOverviewService,
    );
  });

  it('requires the statistics:admin scope', () => {
    expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, AdminOverviewController)).toEqual(['statistics:admin']);
  });

  it.each([UserRole.ADMIN, UserRole.MANAGER])('serves %s with their accessible workspaces', async (role) => {
    await expect(controller.getOverview('c1', '2026-11-01', '2026-11-30', 'day', request(role))).resolves.toEqual({
      scope: 'all',
    });
    expect(clientsService.getAccessibleClientIds).toHaveBeenCalledWith(`${role}-1`, role, false, { amr: undefined });
    expect(overviewService.getOverview).toHaveBeenCalledWith(['c1', 'c2'], {
      clientId: 'c1',
      from: '2026-11-01',
      to: '2026-11-30',
      groupBy: 'day',
    });
  });

  it('serves the static API key', async () => {
    await controller.getOverview(undefined, undefined, undefined, undefined, {
      apiKeyAuthenticated: true,
    } as unknown as RequestWithUser);

    expect(overviewService.getOverview).toHaveBeenCalled();
  });

  it('rejects regular users and anonymous requests', async () => {
    await expect(controller.getOverview(undefined, undefined, undefined, undefined, request('user'))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(controller.getOverview()).rejects.toThrow(ForbiddenException);
    expect(clientsService.getAccessibleClientIds).not.toHaveBeenCalled();
    expect(overviewService.getOverview).not.toHaveBeenCalled();
  });
});
