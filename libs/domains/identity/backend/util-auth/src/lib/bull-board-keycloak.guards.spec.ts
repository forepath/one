import { ExecutionContext } from '@nestjs/common';
import {
  AuthGuard as KeycloakAuthGuard,
  ResourceGuard as KeycloakResourceGuard,
  RoleGuard as KeycloakRoleGuard,
} from 'nest-keycloak-connect';

import {
  BullBoardSkippingAuthGuard,
  BullBoardSkippingResourceGuard,
  BullBoardSkippingRoleGuard,
} from './bull-board-keycloak.guards';

describe('BullBoardSkipping Keycloak guards', () => {
  const originalPath = process.env.QUEUE_BULL_BOARD_PATH;

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.QUEUE_BULL_BOARD_PATH;
    } else {
      process.env.QUEUE_BULL_BOARD_PATH = originalPath;
    }

    jest.restoreAllMocks();
  });

  function createContext(path: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: path, url: path }),
      }),
    } as ExecutionContext;
  }

  it('BullBoardSkippingAuthGuard skips Bull Board paths', async () => {
    const guard = Object.create(BullBoardSkippingAuthGuard.prototype) as BullBoardSkippingAuthGuard;
    const superCanActivate = jest.spyOn(KeycloakAuthGuard.prototype, 'canActivate').mockResolvedValue(false);

    await expect(guard.canActivate(createContext('/admin/queues/api/queues'))).resolves.toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();

    await expect(guard.canActivate(createContext('/api/clients'))).resolves.toBe(false);
    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });

  it('BullBoardSkippingResourceGuard skips Bull Board paths', async () => {
    const guard = Object.create(BullBoardSkippingResourceGuard.prototype) as BullBoardSkippingResourceGuard;
    const superCanActivate = jest.spyOn(KeycloakResourceGuard.prototype, 'canActivate').mockResolvedValue(false);

    await expect(guard.canActivate(createContext('/admin/queues'))).resolves.toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();

    await expect(guard.canActivate(createContext('/api/clients'))).resolves.toBe(false);
    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });

  it('BullBoardSkippingRoleGuard skips Bull Board paths', async () => {
    const guard = Object.create(BullBoardSkippingRoleGuard.prototype) as BullBoardSkippingRoleGuard;
    const superCanActivate = jest.spyOn(KeycloakRoleGuard.prototype, 'canActivate').mockResolvedValue(false);

    await expect(guard.canActivate(createContext('/admin/queues/jobs'))).resolves.toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();

    await expect(guard.canActivate(createContext('/api/clients'))).resolves.toBe(false);
    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });
});
