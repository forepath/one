import axios from 'axios';

import { AddonModuleRegistryService } from '../../services/addon-module-registry.service';
import { LoadweaverUsageCollectService } from './loadweaver-usage-collect.service';
import {
  createLoadweaverUsageAddonModule,
  LoadweaverUsageContributorModule,
} from './loadweaver-usage.contributor.module';

jest.mock('axios');

const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;
const SUB = '6f1c1d5e-6a43-4c38-9a59-7f6d4f0e2a10';

describe('LoadweaverUsageCollectService', () => {
  const addonsRepository = { findByIdOrThrow: jest.fn() };
  const ctx = {
    subscriptionId: SUB,
    provider: '',
    addonId: 'addon-lw',
    addonKey: 'lw',
    // A customer-supplied snapshot must never redirect the collector.
    configSnapshot: { LOADWEAVER_API_URL: 'https://evil.example.com/api', LOADWEAVER_API_TOKEN: 'x' },
    meterKeys: ['loadweaver.cpu_core_hours'],
    periodStart: new Date('2026-10-20T10:05:00Z'),
    periodEnd: new Date('2026-10-20T11:05:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    addonsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'addon-lw',
      configDefaultValues: { LOADWEAVER_API_URL: 'https://lw.example.com/api', LOADWEAVER_API_TOKEN: 'pat-1' },
    });
    mockedGet.mockResolvedValue({
      data: {
        cluster: 'lab',
        truncated: false,
        rows: [
          {
            project: 'shop',
            bucket: '2026-10-20T09:00:00.000Z',
            meter: 'cpu_core_hours',
            value: 1.5,
            final: true,
            idempotencyKey: 'loadweaver:lab:shop:cpu_core_hours:2026-10-20T09:00:00.000Z',
            billingSubscription: SUB,
          },
        ],
      },
    });
  });

  it('queries the admin-configured cluster for the subscription’s final hourly buckets', async () => {
    const service = new LoadweaverUsageCollectService(addonsRepository as never);
    const samples = await service.collect(ctx);

    expect(mockedGet).toHaveBeenCalledWith('https://lw.example.com/api/usage', {
      params: {
        billingSubscription: SUB,
        granularity: 'hour',
        finalOnly: 'true',
        from: '2026-10-20T05:00:00.000Z',
        to: '2026-10-20T10:45:00.000Z',
      },
      headers: { Authorization: 'Bearer pat-1', Accept: 'application/json' },
      timeout: 15_000,
      maxContentLength: 32 * 1024 * 1024,
      maxRedirects: 0,
    });
    expect(samples).toEqual([
      expect.objectContaining({
        meterKey: 'loadweaver.cpu_core_hours',
        value: 1.5,
        idempotencyKey: 'loadweaver:lab:shop:cpu_core_hours:2026-10-20T09:00:00.000Z',
      }),
    ]);
  });

  it('calls Loadweaver once per subscription and window for several meters', async () => {
    const service = new LoadweaverUsageCollectService(addonsRepository as never);

    await service.collect(ctx);
    await service.collect({ ...ctx, meterKeys: ['loadweaver.memory_gib_hours'] });

    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('fails (and retries next time) on truncated or malformed answers', async () => {
    const service = new LoadweaverUsageCollectService(addonsRepository as never);

    mockedGet.mockResolvedValueOnce({ data: { cluster: 'lab', rows: [], truncated: true } });
    await expect(service.collect(ctx)).rejects.toThrow(/truncated/);

    mockedGet.mockResolvedValueOnce({ data: { nope: true } });
    await expect(service.collect({ ...ctx, periodEnd: new Date('2026-10-20T11:06:00Z') })).rejects.toThrow(
      /Unexpected/,
    );
  });

  it('refuses to collect without admin defaults', async () => {
    const service = new LoadweaverUsageCollectService(addonsRepository as never);

    addonsRepository.findByIdOrThrow.mockResolvedValue({ id: 'addon-lw', configDefaultValues: {} });

    await expect(service.collect(ctx)).rejects.toThrow(/needs/);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('collects nothing outside an addon', async () => {
    const service = new LoadweaverUsageCollectService(addonsRepository as never);

    expect(await service.collect({ ...ctx, addonId: undefined })).toEqual([]);
  });

  it('registers the addon module with config fields, meters and the collector', () => {
    const registry = new AddonModuleRegistryService();
    const service = new LoadweaverUsageCollectService(addonsRepository as never);

    new LoadweaverUsageContributorModule(registry, service).onModuleInit();

    const module = registry.get('loadweaver-usage');

    expect(module?.configFields?.map((f) => [f.key, f.showInOrderForm])).toEqual([
      ['LOADWEAVER_API_URL', false],
      ['LOADWEAVER_API_TOKEN', false],
    ]);
    expect(module?.meters).toHaveLength(7);
    expect(typeof module?.collectMeters).toBe('function');
    expect(createLoadweaverUsageAddonModule(service).key).toBe('loadweaver-usage');
  });
});
