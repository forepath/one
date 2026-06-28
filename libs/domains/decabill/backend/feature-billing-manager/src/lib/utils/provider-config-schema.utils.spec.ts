import {
  applyProviderConfigFieldScopes,
  getProductProviderConfigKeys,
  getProviderConfigFieldScope,
  getServerProviderConfigKeys,
} from './provider-config-schema.utils';

describe('providerConfigSchemaUtils', () => {
  describe('applyProviderConfigFieldScopes', () => {
    it('marks server and product fields', () => {
      const properties = applyProviderConfigFieldScopes(
        {
          serverType: { type: 'string', description: 'Server type' },
          location: { type: 'string', description: 'Location' },
          firewallId: { type: 'number', description: 'Firewall' },
          authenticationMethod: { type: 'string', description: 'Auth' },
          git: { type: 'object', description: 'Git' },
        },
        ['serverType', 'location', 'firewallId'],
      );

      expect(properties['serverType']?.['scope']).toBe('server');
      expect(properties['authenticationMethod']?.['scope']).toBe('product');
      expect(properties['git']?.['productServices']).toEqual(['manager']);
    });
  });

  describe('getServerProviderConfigKeys', () => {
    it('returns only server scoped keys', () => {
      const schema = applyProviderConfigFieldScopes(
        {
          serverType: { type: 'string' },
          location: { type: 'string' },
          authenticationMethod: { type: 'string' },
        },
        ['serverType', 'location'],
      );

      expect(getServerProviderConfigKeys(schema, Object.keys(schema))).toEqual(['serverType', 'location']);
    });
  });

  describe('getProductProviderConfigKeys', () => {
    it('filters product keys by selected integrated service', () => {
      const schema = applyProviderConfigFieldScopes(
        {
          serverType: { type: 'string' },
          authenticationMethod: { type: 'string' },
          git: { type: 'object' },
          disableSignup: { type: 'boolean' },
        },
        ['serverType'],
      );

      expect(getProductProviderConfigKeys(schema, Object.keys(schema), ['controller'])).toEqual([
        'authenticationMethod',
        'disableSignup',
      ]);
      expect(getProductProviderConfigKeys(schema, Object.keys(schema), ['manager'])).toEqual([
        'authenticationMethod',
        'git',
      ]);
    });
  });

  describe('getProviderConfigFieldScope', () => {
    it('treats internal keys as internal', () => {
      expect(getProviderConfigFieldScope('service', { type: 'string' })).toBe('internal');
    });
  });
});
