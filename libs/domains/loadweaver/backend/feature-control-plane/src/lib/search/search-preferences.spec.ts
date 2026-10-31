import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { AccessCaller } from '../access/access.utils';
import { SearchService } from './search.service';

const person = 'fleet:fleet-test:u1';

function setup(caller: AccessCaller) {
  const dataSource = { query: jest.fn(async () => [{ item: 'Node:n1' }]) };
  const access = { caller: jest.fn(async () => caller) };
  const service = new SearchService(dataSource as never, access as never, {} as never, {} as never);

  return { service, dataSource };
}

const fleetUser = { amr: ['pat'], scopes: ['cluster:read', 'fleet:on-behalf-of'] };
const verified = { user: fleetUser, fleetIdentity: { person } } as never;
const unverified = { user: fleetUser } as never;

describe('search favourites / recents per person (2026-10-27)', () => {
  it('uses the verified fleet person, never the fleet service account', async () => {
    const { service, dataSource } = setup({ userId: person, isApiKey: false, projects: new Map() });

    expect(await service.favourites(verified)).toEqual(['Node:n1']);
    await service.setFavourite(verified, 'Node:n2', true);
    await service.visited(verified, 'Node:n2');

    for (const call of dataSource.query.mock.calls as unknown as [string, unknown[]][]) expect(call[1][0]).toBe(person);
  });

  it('has no favourites for a fleet relay without a verified person', async () => {
    const { service, dataSource } = setup({ userId: 'svc-fleet', isApiKey: false, projects: new Map() });

    expect(await service.favourites(unverified)).toEqual([]);
    await expect(service.setFavourite(unverified, 'Node:n2', true)).rejects.toBeInstanceOf(ForbiddenException);
    await service.visited(unverified, 'Node:n2');
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('keeps native users as before', async () => {
    const { service, dataSource } = setup({ userId: 'alice', isApiKey: false, projects: new Map() });
    const native = { user: { amr: ['pwd'] } } as never;

    await service.setFavourite(native, 'Node:n2', false);
    expect((dataSource.query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual(['alice', 'Node:n2']);

    const anonymous = setup({ isApiKey: false, projects: new Map() });

    await expect(anonymous.service.setFavourite(native, 'Node:n2', true)).rejects.toBeInstanceOf(BadRequestException);
  });
});
