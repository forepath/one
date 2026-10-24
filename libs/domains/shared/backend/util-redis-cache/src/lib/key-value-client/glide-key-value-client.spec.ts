import { GlideClient } from '@valkey/valkey-glide';

import { GlideKeyValueClient } from './glide-key-value-client';

const glideInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  get: jest.fn(),
  getdel: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  mget: jest.fn(),
  scan: jest.fn(),
  close: jest.fn(),
};

jest.mock('@valkey/valkey-glide', () => ({
  __esModule: true,
  GlideClient: { createClient: jest.fn(async () => glideInstance) },
  Decoder: { Bytes: 0, String: 1 },
  TimeUnit: { Seconds: 'EX' },
}));

const createClientMock = GlideClient.createClient as unknown as jest.Mock;

describe('GlideKeyValueClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createClient(password?: string): GlideKeyValueClient {
    return new GlideKeyValueClient({
      config: { host: 'valkey', port: 6379, db: 2, keyPrefix: 'p', ...(password ? { password } : {}) },
      clientName: 'forepath-test',
    });
  }

  it('creates a string-decoding standalone client on connect', async () => {
    await createClient('secret').connect();

    expect(createClientMock).toHaveBeenCalledWith({
      addresses: [{ host: 'valkey', port: 6379 }],
      databaseId: 2,
      credentials: { password: 'secret' },
      clientName: 'forepath-test',
      defaultDecoder: 1,
      requestTimeout: 2000,
    });
  });

  it('connects only once', async () => {
    const client = createClient();

    await client.connect();
    await client.connect();

    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('rejects commands before connect', async () => {
    await expect(createClient().get('k')).rejects.toThrow('not connected');
  });

  it('maps commands to GLIDE', async () => {
    const client = createClient();

    await client.connect();
    await expect(client.ping()).resolves.toBe(true);

    glideInstance.get.mockResolvedValueOnce('v');
    await expect(client.get('k')).resolves.toBe('v');

    glideInstance.getdel.mockResolvedValueOnce(null);
    await expect(client.getDel('k')).resolves.toBeNull();

    await client.set('k', 'v');
    expect(glideInstance.set).toHaveBeenLastCalledWith('k', 'v');
    await client.set('k', 'v', 60);
    expect(glideInstance.set).toHaveBeenLastCalledWith('k', 'v', { expiry: { type: 'EX', count: 60 } });

    glideInstance.mget.mockResolvedValueOnce(['a', null]);
    await expect(client.mget(['k1', 'k2'])).resolves.toEqual(['a', null]);
    expect(glideInstance.mget).toHaveBeenCalledWith(['k1', 'k2']);

    glideInstance.scan.mockResolvedValueOnce(['0', ['k1']]);
    await expect(client.scan('0', 'p:*', 100)).resolves.toEqual(['0', ['k1']]);
    expect(glideInstance.scan).toHaveBeenCalledWith('0', { match: 'p:*', count: 100 });

    await client.close();
    expect(glideInstance.close).toHaveBeenCalled();
  });
});
