import { ClientUserRole } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import type { ClientIsolationSummaryDto } from '../dto/client-isolation.dto';

import { ClientIsolationController } from './client-isolation.controller';

describe('ClientIsolationController', () => {
  const summary = { supported: true, recommendedLevel: 'sandboxed' } as ClientIsolationSummaryDto;
  let clientIsolation: { getSummary: jest.Mock; probe: jest.Mock };
  let clientsRepository: { findById: jest.Mock };
  let clientUsersRepository: { findUserClientAccess: jest.Mock };
  let controller: ClientIsolationController;

  beforeEach(() => {
    clientIsolation = { getSummary: jest.fn().mockResolvedValue(summary), probe: jest.fn().mockResolvedValue(summary) };
    clientsRepository = { findById: jest.fn().mockResolvedValue({ id: 'client-1', userId: 'owner-1' }) };
    clientUsersRepository = { findUserClientAccess: jest.fn().mockResolvedValue(null) };
    controller = new ClientIsolationController(
      clientIsolation as never,
      clientsRepository as never,
      clientUsersRepository as never,
    );
  });

  it('returns the isolation summary to users with workspace access', async () => {
    const req = { apiKeyAuthenticated: true } as never;

    await expect(controller.getIsolation('client-1', req)).resolves.toBe(summary);
    expect(clientIsolation.getSummary).toHaveBeenCalledWith('client-1');
  });

  it('lets workspace members read but not re-probe', async () => {
    const req = { apiKeyAuthenticated: false, user: { id: 'user-1', roles: ['user'] } } as never;

    clientUsersRepository.findUserClientAccess.mockResolvedValue({
      userId: 'user-1',
      clientId: 'client-1',
      role: ClientUserRole.USER,
    });

    await expect(controller.getIsolation('client-1', req)).resolves.toBe(summary);
    await expect(controller.probeIsolation('client-1', req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(clientIsolation.probe).not.toHaveBeenCalled();
  });

  it('re-probes for workspace managers', async () => {
    const req = { apiKeyAuthenticated: true } as never;

    await expect(controller.probeIsolation('client-1', req)).resolves.toBe(summary);
    expect(clientIsolation.probe).toHaveBeenCalledWith('client-1');
  });
});
