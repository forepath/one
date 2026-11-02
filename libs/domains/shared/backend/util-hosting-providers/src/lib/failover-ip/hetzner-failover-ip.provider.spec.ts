import axios from 'axios';

import { HetznerFailoverIpProvider } from './hetzner-failover-ip.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HetznerFailoverIpProvider', () => {
  beforeEach(() => jest.resetAllMocks());

  it('assigns a floating IP to the server found by name, and skips when it already points there', async () => {
    mockedAxios.get.mockImplementation(async (url: string) =>
      url.endsWith('/floating_ips')
        ? {
            data: {
              floating_ips: [
                { id: 7, ip: '203.0.113.10', server: 1 },
                { id: 8, ip: '2001:db8:1::/64', server: null },
              ],
            },
          }
        : { data: { servers: [{ id: 2, name: 'n2' }] } },
    );
    mockedAxios.post.mockResolvedValue({ data: {} });

    const provider = new HetznerFailoverIpProvider({ apiToken: 't' });

    await provider.assign('203.0.113.10', { name: 'n2' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.hetzner.cloud/v1/floating_ips/7/actions/assign',
      { server: 2 },
      expect.any(Object),
    );

    mockedAxios.post.mockClear();
    await provider.assign('203.0.113.10', { id: '1' });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(await provider.holder('2001:db8:1::5')).toBeNull();
    await expect(provider.holder('2001:db8:10::1')).rejects.toThrow('not found');
    await expect(provider.holder('198.51.100.1')).rejects.toThrow('not found');
  });
});
