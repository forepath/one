import { configureTrustProxy, resolveTrustProxySetting } from './trust-proxy.config';

describe('trust proxy configuration', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['false', undefined],
    ['1', 1],
    ['2', 2],
    ['true', 1],
    ['loopback', 'loopback'],
    ['10.0.0.1, 10.0.0.2', '10.0.0.1, 10.0.0.2'],
  ])('%s → %s', (raw, expected) => {
    expect(resolveTrustProxySetting(raw)).toBe(expected);
  });

  it('only sets trust proxy when configured', () => {
    const app = { set: jest.fn() };
    const backup = process.env.TRUST_PROXY;

    delete process.env.TRUST_PROXY;
    configureTrustProxy(app);
    expect(app.set).not.toHaveBeenCalled();

    process.env.TRUST_PROXY = '1';
    configureTrustProxy(app);
    expect(app.set).toHaveBeenCalledWith('trust proxy', 1);

    if (backup === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = backup;
  });
});
