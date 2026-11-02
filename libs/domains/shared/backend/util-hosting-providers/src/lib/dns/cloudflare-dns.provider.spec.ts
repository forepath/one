import axios from 'axios';

import { CloudflareDnsProvider } from './cloudflare-dns.provider';
import { DnsProviderRegistry } from './dns-provider.registry';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CloudflareDnsProvider', () => {
  beforeEach(() => jest.resetAllMocks());

  it('pages through records and maps them', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          result: [{ id: 'r1', type: 'A', name: 'a.example.com', content: '1.2.3.4', ttl: 60 }],
          result_info: { total_pages: 2 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          result: [{ id: 'r2', type: 'MX', name: 'example.com', content: 'mx.example.com', ttl: 1, priority: 10 }],
          result_info: { total_pages: 2 },
        },
      });

    const records = await new CloudflareDnsProvider({ apiToken: 't' }).listRecords('z1', { type: 'A' });

    expect(records.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(records[1].priority).toBe(10);
    expect(mockedAxios.get.mock.calls[0][0]).toBe(
      'https://api.cloudflare.com/client/v4/zones/z1/dns_records?type=A&per_page=500&page=1',
    );
  });

  it('creates new and updates existing records, clamping TTLs', async () => {
    mockedAxios.post.mockResolvedValue({ data: { result: { id: 'new' } } });
    mockedAxios.put.mockResolvedValue({ data: { result: { id: 'old' } } });

    const provider = new CloudflareDnsProvider({ apiToken: 't' });

    expect(
      (await provider.upsertRecord('z1', { name: 'a.example.com', type: 'A', content: '1.2.3.4', ttl: 30 })).id,
    ).toBe('new');
    expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({ ttl: 60, proxied: false });
    await provider.upsertRecord('z1', {
      id: 'old',
      name: 'a.example.com',
      type: 'A',
      content: '1.2.3.5',
      ttl: 300,
      proxied: true,
    });
    expect(mockedAxios.put.mock.calls[0][0]).toBe('https://api.cloudflare.com/client/v4/zones/z1/dns_records/old');
    expect(mockedAxios.put.mock.calls[0][1]).toMatchObject({ ttl: 1, proxied: true });
  });

  it('is created through the registry', () => {
    const registry = new DnsProviderRegistry();

    expect(registry.list()).toEqual([{ id: 'cloudflare', displayName: 'Cloudflare' }]);
    expect(registry.create('cloudflare', { apiToken: 't' }).capabilities.proxied).toBe(true);
    expect(() => registry.create('nope', {})).toThrow('unknown DNS provider');
  });
});
