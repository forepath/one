import { resolveJwtModuleSecret } from './resolve-jwt-module-secret';

describe('resolveJwtModuleSecret', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JWT_SECRET;
    delete process.env.JEST_WORKER_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns trimmed JWT_SECRET when set', () => {
    process.env.JWT_SECRET = '  secret  ';

    expect(resolveJwtModuleSecret('users')).toBe('secret');
  });

  it('uses test default when NODE_ENV is test and secret missing', () => {
    process.env.NODE_ENV = 'test';

    expect(resolveJwtModuleSecret('users')).toBe('test-jwt-secret');
  });

  it('uses test default when JEST_WORKER_ID is set and secret missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.JEST_WORKER_ID = '1';

    expect(resolveJwtModuleSecret('oidc')).toBe('test-jwt-secret');
  });

  it('throws when not in test context and secret missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JEST_WORKER_ID;

    expect(() => resolveJwtModuleSecret('users')).toThrow('JWT_SECRET must be set when AUTHENTICATION_METHOD=users');
  });
});
