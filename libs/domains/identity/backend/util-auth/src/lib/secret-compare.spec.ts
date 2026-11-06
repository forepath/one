import { secretsEqual } from './secret-compare';

describe('secretsEqual', () => {
  it('compares secrets of any length in constant time', () => {
    expect(secretsEqual('static-key', 'static-key')).toBe(true);
    expect(secretsEqual('static-kez', 'static-key')).toBe(false);
    expect(secretsEqual('short', 'a-much-longer-secret')).toBe(false);
    expect(secretsEqual('', 'static-key')).toBe(false);
  });
});
