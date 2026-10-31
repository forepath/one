import { trustProxySetting } from './trust-proxy';

describe('trustProxySetting', () => {
  it('is off unless configured', () => {
    expect(trustProxySetting({})).toBeUndefined();
    expect(trustProxySetting({ LOADWEAVER_TRUST_PROXY: ' ' })).toBeUndefined();
  });

  it('accepts only loopback', () => {
    expect(trustProxySetting({ LOADWEAVER_TRUST_PROXY: 'loopback' })).toBe('loopback');
    expect(trustProxySetting({ LOADWEAVER_TRUST_PROXY: ' Loopback ' })).toBe('loopback');
    expect(() => trustProxySetting({ LOADWEAVER_TRUST_PROXY: 'true' })).toThrow(/LOADWEAVER_TRUST_PROXY/);
    expect(() => trustProxySetting({ LOADWEAVER_TRUST_PROXY: '0.0.0.0/0' })).toThrow(/LOADWEAVER_TRUST_PROXY/);
  });
});
