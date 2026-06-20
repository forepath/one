import { DYNAMIC_PROVIDERS_FAIL_FAST_ENV } from './types';
import { handleDynamicProviderError, shouldFailFastOnError } from './startup-error-policy';

describe('startup-error-policy', () => {
  const originalEnv = process.env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV];
    } else {
      process.env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV] = originalEnv;
    }
  });

  it('never fail-fast for optional registries', () => {
    process.env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV] = 'true';
    expect(shouldFailFastOnError('optional')).toBe(false);
  });

  it('fail-fast for critical registries when env flag is true', () => {
    process.env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV] = 'true';
    expect(shouldFailFastOnError('critical')).toBe(true);
  });

  it('remains permissive for critical registries when env flag is unset', () => {
    delete process.env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV];
    expect(shouldFailFastOnError('critical')).toBe(false);
  });

  it('skips errors permissively for optional registries', () => {
    const onPermissive = jest.fn();

    handleDynamicProviderError(new Error('load failed'), {
      criticality: 'optional',
      envKey: 'DYNAMIC_CHAT_FILTERS',
      entryLabel: '@forepath/foo',
      onPermissive,
    });

    expect(onPermissive).toHaveBeenCalled();
  });

  it('rethrows for critical registries when fail-fast is enabled', () => {
    process.env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV] = 'true';
    const error = new Error('load failed');

    expect(() =>
      handleDynamicProviderError(error, {
        criticality: 'critical',
        envKey: 'DYNAMIC_PROVISIONING_PROVIDERS',
        entryLabel: '@forepath/foo',
        onPermissive: jest.fn(),
      }),
    ).toThrow(error);
  });
});
