import axios from 'axios';

import {
  LOADWEAVER_FLEET_TEARDOWN_JOB_KEY,
  LOADWEAVER_FLEET_TEARDOWN_PAGE_SIZE,
  LoadweaverFleetTeardownService,
  loadweaverFleetReference,
  loadweaverFleetSyncIntervalMs,
  resolveLoadweaverFleetConfig,
} from './loadweaver-fleet-teardown.service';

jest.mock('axios');

const mockedPut = axios.put as jest.MockedFunction<typeof axios.put>;
const NOW = new Date('2026-10-20T12:00:00Z');
const config = { url: 'https://fleet.example.com', token: 'fleet-pat' };

function setup(items: Array<{ id: string; configSnapshot: Record<string, unknown> }>) {
  const subscriptions = {
    find: jest.fn(async () => [
      { id: 'sub-1', number: 'S-1', teardownNotBefore: new Date('2026-10-27T12:00:00Z'), cancelEffectiveAt: NOW },
    ]),
  };
  const itemRepo = { find: jest.fn(async () => items) };

  return {
    service: new LoadweaverFleetTeardownService(subscriptions as never, itemRepo as never),
    subscriptions,
    itemRepo,
  };
}

describe('Loadweaver Cloud teardown via the fleet (section 4)', () => {
  beforeEach(() => mockedPut.mockReset());

  it('reads the fleet connection only when complete and safe', () => {
    expect(resolveLoadweaverFleetConfig({})).toBeNull();
    expect(resolveLoadweaverFleetConfig({ LOADWEAVER_FLEET_URL: 'https://fleet.example.com/api/' })).toBeNull();
    expect(
      resolveLoadweaverFleetConfig({
        LOADWEAVER_FLEET_URL: 'https://fleet.example.com/api/',
        LOADWEAVER_FLEET_TOKEN: 't',
      }),
    ).toEqual({ url: 'https://fleet.example.com', token: 't' });
    expect(
      resolveLoadweaverFleetConfig({ LOADWEAVER_FLEET_URL: 'http://fleet:3500', LOADWEAVER_FLEET_TOKEN: 't' }),
    ).toBeNull();
    expect(
      resolveLoadweaverFleetConfig({
        LOADWEAVER_FLEET_URL: 'http://fleet:3500',
        LOADWEAVER_FLEET_TOKEN: 't',
        LOADWEAVER_FLEET_ALLOW_INSECURE_HTTP: 'true',
      }),
    ).toEqual({ url: 'http://fleet:3500', token: 't' });
    expect(
      resolveLoadweaverFleetConfig({
        LOADWEAVER_FLEET_URL: 'https://u:p@fleet.example.com',
        LOADWEAVER_FLEET_TOKEN: 't',
      }),
    ).toBeNull();
    expect(loadweaverFleetSyncIntervalMs({})).toBe(15 * 60_000);
    expect(loadweaverFleetSyncIntervalMs({ LOADWEAVER_FLEET_SYNC_INTERVAL_MS: '1000' })).toBe(15_000);
  });

  it('is a disabled no-op without configuration (current behaviour)', async () => {
    const { service, subscriptions } = setup([]);
    const saved = { ...process.env };

    delete process.env['LOADWEAVER_FLEET_URL'];
    delete process.env['LOADWEAVER_FLEET_TOKEN'];

    const job = service.jobDefinition();

    expect(job.key).toBe(LOADWEAVER_FLEET_TEARDOWN_JOB_KEY);
    expect(job.isEnabled?.()).toBe(false);
    await expect(service.sync(NOW, null)).resolves.toEqual({ notified: [], notRegistered: [], failed: [] });
    expect(subscriptions.find).not.toHaveBeenCalled();
    expect(mockedPut).not.toHaveBeenCalled();
    process.env = saved;
  });

  it('asks the fleet for the final backup and read-only grace of each Loadweaver item in grace', async () => {
    const { service } = setup([
      { id: 'item-1', configSnapshot: { service: 'loadweaver' } },
      { id: 'item-2', configSnapshot: { service: 'agenstra-manager' } },
    ]);

    mockedPut.mockResolvedValue({ status: 200, data: {} } as never);

    const result = await service.sync(NOW, config);

    expect(result).toEqual({ notified: ['decabill:sub-1:item-1'], notRegistered: [], failed: [] });
    expect(mockedPut).toHaveBeenCalledTimes(1);
    expect(mockedPut).toHaveBeenCalledWith(
      'https://fleet.example.com/api/cloud/clusters/decabill%3Asub-1%3Aitem-1/teardown',
      { readOnlyUntil: '2026-10-27T12:00:00.000Z', reason: 'Decabill subscription S-1 cancelled', finalBackup: true },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fleet-pat' }),
        maxRedirects: 0,
      }),
    );
  });

  it('skips clusters that are not registered and keeps going after failures', async () => {
    const { service } = setup([
      { id: 'item-1', configSnapshot: { service: 'loadweaver' } },
      { id: 'item-2', configSnapshot: { service: 'loadweaver' } },
      { id: 'item-3', configSnapshot: { service: 'loadweaver' } },
    ]);

    mockedPut
      .mockResolvedValueOnce({ status: 404, data: {} } as never)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 200, data: {} } as never);

    await expect(service.sync(NOW, config)).resolves.toEqual({
      notified: ['decabill:sub-1:item-3'],
      notRegistered: ['decabill:sub-1:item-1'],
      failed: ['decabill:sub-1:item-2'],
    });
  });

  it('selects cancellations in effect and withdrawals / instant cancels in their grace', async () => {
    const { service, subscriptions } = setup([]);

    await service.inGrace(NOW);

    const [{ where }] = subscriptions.find.mock.calls[0] as unknown as [
      { where: Record<string, { _type?: string; _value?: unknown }>[] },
    ];

    expect(where).toHaveLength(2);
    expect(where[0]['cancelEffectiveAt']).toMatchObject({ _type: 'lessThanOrEqual', _value: NOW });
    expect(where[1]['cancelEffectiveAt']).toMatchObject({ _type: 'isNull' });
    expect(where[0]['teardownNotBefore']).toMatchObject({ _type: 'moreThan', _value: NOW });
    expect(where[0]['status']).toMatchObject({
      _type: 'in',
      _value: ['pending_cancel', 'pending_withdrawal', 'pending_instant_cancel'],
    });
  });

  it('walks more than one page in id order so a large backlog never starves', async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `sub-${String(from + i).padStart(4, '0')}`,
        number: `S-${from + i}`,
        teardownNotBefore: new Date('2026-10-27T12:00:00Z'),
        cancelEffectiveAt: NOW,
      }));
    const subscriptions = {
      find: jest
        .fn()
        .mockResolvedValueOnce(page(0, LOADWEAVER_FLEET_TEARDOWN_PAGE_SIZE))
        .mockResolvedValueOnce(page(LOADWEAVER_FLEET_TEARDOWN_PAGE_SIZE, 3)),
    };
    const itemRepo = { find: jest.fn(async () => [{ id: 'item', configSnapshot: { service: 'loadweaver' } }]) };
    const service = new LoadweaverFleetTeardownService(subscriptions as never, itemRepo as never);

    mockedPut.mockResolvedValue({ status: 200, data: {} } as never);

    const result = await service.sync(NOW, config);

    expect(result.notified).toHaveLength(LOADWEAVER_FLEET_TEARDOWN_PAGE_SIZE + 3);
    expect(subscriptions.find).toHaveBeenCalledTimes(2);

    const [first, second] = subscriptions.find.mock.calls as unknown as [
      { where: Record<string, { _value?: unknown }>[]; order: unknown; take: number },
    ][];

    expect(first[0].order).toEqual({ id: 'ASC' });
    expect(first[0].where[0]['id']).toBeUndefined();
    expect(second[0].where[0]['id']).toMatchObject({ _type: 'moreThan', _value: 'sub-0499' });
    expect(second[0].where[1]['id']).toMatchObject({ _type: 'moreThan', _value: 'sub-0499' });
  });

  it('builds the fleet reference', () => {
    expect(loadweaverFleetReference('s', 'i')).toBe('decabill:s:i');
  });
});
