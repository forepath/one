import {
  getProviderEnvDefaultFieldKeys,
  maskProviderDefaultsForResponse,
  resolveProviderApiToken,
  resolveProviderEnvValue,
  sanitizeProviderDefaults,
} from './provider-env-defaults.utils';

describe('provider-env-defaults.utils', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.HETZNER_API_TOKEN;
    delete process.env.DIGITALOCEAN_API_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('sanitizeProviderDefaults', () => {
    it('should keep allowed non-empty keys and strip unknown or blank values', () => {
      const result = sanitizeProviderDefaults(
        {
          HETZNER_API_TOKEN: '  secret  ',
          UNKNOWN: 'x',
          HETZNER_OTHER: '',
        },
        getProviderEnvDefaultFieldKeys('hetzner'),
      );

      expect(result).toEqual({ HETZNER_API_TOKEN: 'secret' });
    });
  });

  describe('resolveProviderEnvValue', () => {
    it('should prefer stored override over environment', () => {
      process.env.HETZNER_API_TOKEN = 'env-token';

      expect(resolveProviderEnvValue('HETZNER_API_TOKEN', { HETZNER_API_TOKEN: 'override' })).toBe('override');
    });

    it('should fall back to environment when override is missing or empty', () => {
      process.env.HETZNER_API_TOKEN = 'env-token';

      expect(resolveProviderEnvValue('HETZNER_API_TOKEN', {})).toBe('env-token');
      expect(resolveProviderEnvValue('HETZNER_API_TOKEN', { HETZNER_API_TOKEN: '   ' })).toBe('env-token');
    });
  });

  describe('resolveProviderApiToken', () => {
    it('should resolve hetzner and digital-ocean tokens', () => {
      process.env.HETZNER_API_TOKEN = 'hetzner-env';
      process.env.DIGITALOCEAN_API_TOKEN = 'do-env';

      expect(resolveProviderApiToken('hetzner', {})).toBe('hetzner-env');
      expect(resolveProviderApiToken('digital-ocean', {})).toBe('do-env');
      expect(resolveProviderApiToken('hetzner', { HETZNER_API_TOKEN: 'custom' })).toBe('custom');
    });
  });

  describe('maskProviderDefaultsForResponse', () => {
    it('should expose configured flags without secret values', () => {
      const masked = maskProviderDefaultsForResponse({ HETZNER_API_TOKEN: 'secret' }, [
        { envKey: 'HETZNER_API_TOKEN', label: 'API token', sensitive: true, type: 'string' },
      ]);

      expect(masked).toEqual({ providerDefaultsConfigured: { HETZNER_API_TOKEN: true } });
      expect(masked).not.toHaveProperty('HETZNER_API_TOKEN');
    });
  });
});
