import axios from 'axios';

import { CloudflareDnsService } from './cloudflare-dns.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CloudflareDnsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv, CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ZONE_ID: 'zone-123' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('isConfigured returns true when token and zone are set', () => {
    const service = new CloudflareDnsService();

    expect(service.isConfigured()).toBe(true);
  });

  it('isConfigured returns false when token is missing', () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    const service = new CloudflareDnsService();

    expect(service.isConfigured()).toBe(false);
  });

  it('getFqdn returns subdomain.baseDomain', () => {
    process.env.DNS_BASE_DOMAIN = 'spirde.com';
    const service = new CloudflareDnsService();

    expect(service.getFqdn('awesome-armadillo-abc12')).toBe('awesome-armadillo-abc12.spirde.com');
  });

  it('getFqdn uses default base domain when DNS_BASE_DOMAIN not set', () => {
    delete process.env.DNS_BASE_DOMAIN;
    const service = new CloudflareDnsService();

    expect(service.getFqdn('foo')).toBe('foo.spirde.com');
  });

  it('createARecord posts to Cloudflare API', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });
    const service = new CloudflareDnsService();

    await service.createARecord('awesome-armadillo-abc12', '1.2.3.4');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-123/dns_records',
      expect.objectContaining({
        type: 'A',
        name: 'awesome-armadillo-abc12.spirde.com',
        content: '1.2.3.4',
        ttl: 1,
        proxied: false,
      }),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      }),
    );
  });

  it('createARecord does not throw when not configured', async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    const service = new CloudflareDnsService();

    await expect(service.createARecord('sub', '1.2.3.4')).resolves.toBeUndefined();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('createARecord skips invalid hostname (contains dot)', async () => {
    const service = new CloudflareDnsService();

    await expect(service.createARecord('sub.domain', '1.2.3.4')).resolves.toBeUndefined();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('deleteRecord fetches by name and deletes each record', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { result: [{ id: 'rec-1', type: 'A', name: 'awesome-armadillo-abc12.spirde.com' }] },
    });
    mockedAxios.delete.mockResolvedValue({ data: {} });
    const service = new CloudflareDnsService();

    await service.deleteRecord('awesome-armadillo-abc12');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('zones/zone-123/dns_records'),
      expect.any(Object),
    );
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-123/dns_records/rec-1',
      expect.any(Object),
    );
  });

  it('deleteRecord does not throw when not configured', async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    const service = new CloudflareDnsService();

    await expect(service.deleteRecord('sub')).resolves.toBeUndefined();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
