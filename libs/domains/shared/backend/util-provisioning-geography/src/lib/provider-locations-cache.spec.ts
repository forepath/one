import {
  buildProviderLocationsCacheKey,
  getOrSetProviderLocationsCatalog,
  readProviderLocationsCacheTtlSeconds,
} from './provider-locations-cache';

describe('provider-locations-cache', () => {
  it('buildProviderLocationsCacheKey scopes by provider and token hash', () => {
    const keyA = buildProviderLocationsCacheKey('billing', 'hetzner', 'token-a');
    const keyB = buildProviderLocationsCacheKey('billing', 'hetzner', 'token-b');
    const keyC = buildProviderLocationsCacheKey('billing', 'digital-ocean', 'token-a');

    expect(keyA).toMatch(/^billing:provider-locations:hetzner:[a-f0-9]{16}$/);
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });

  it('readProviderLocationsCacheTtlSeconds defaults to 24 hours', () => {
    expect(readProviderLocationsCacheTtlSeconds({})).toBe(24 * 60 * 60);
  });

  it('readProviderLocationsCacheTtlSeconds reads env override', () => {
    expect(readProviderLocationsCacheTtlSeconds({ PROVIDER_LOCATIONS_CACHE_TTL_SECONDS: '7200' })).toBe(7200);
  });

  it('getOrSetProviderLocationsCatalog returns cached value without calling loader', async () => {
    const cached = [{ id: 'fsn1', name: 'Falkenstein' }];
    const cache = {
      getJson: jest.fn().mockResolvedValue(cached),
      setJson: jest.fn(),
    };
    const loader = jest.fn();
    const result = await getOrSetProviderLocationsCatalog(
      cache,
      { keyPrefix: 'agenstra', providerId: 'hetzner', apiToken: 'token' },
      loader,
    );

    expect(result).toEqual(cached);
    expect(loader).not.toHaveBeenCalled();
    expect(cache.setJson).not.toHaveBeenCalled();
  });

  it('getOrSetProviderLocationsCatalog stores loader result on miss', async () => {
    const fresh = [{ id: 'fra1', name: 'Frankfurt 1' }];
    const cache = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
    };
    const loader = jest.fn().mockResolvedValue(fresh);
    const result = await getOrSetProviderLocationsCatalog(
      cache,
      { keyPrefix: 'agenstra', providerId: 'digital-ocean', apiToken: 'token', ttlSeconds: 1800 },
      loader,
    );

    expect(result).toEqual(fresh);
    expect(loader).toHaveBeenCalled();
    expect(cache.setJson).toHaveBeenCalledWith(
      buildProviderLocationsCacheKey('agenstra', 'digital-ocean', 'token'),
      fresh,
      1800,
    );
  });

  it('getOrSetProviderLocationsCatalog bypasses cache when client is missing', async () => {
    const fresh = [{ id: 'fsn1', name: 'Falkenstein' }];
    const loader = jest.fn().mockResolvedValue(fresh);
    const result = await getOrSetProviderLocationsCatalog(
      undefined,
      {
        keyPrefix: 'agenstra',
        providerId: 'hetzner',
        apiToken: 'token',
      },
      loader,
    );

    expect(result).toEqual(fresh);
    expect(loader).toHaveBeenCalled();
  });
});
