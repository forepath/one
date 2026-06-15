import { sanitizeProviderMetadata } from './statistics-metadata-sanitizer';

describe('sanitizeProviderMetadata', () => {
  it('should return empty object for undefined', () => {
    expect(sanitizeProviderMetadata(undefined)).toBe('{}');
  });

  it('should return empty object for empty string', () => {
    expect(sanitizeProviderMetadata('')).toBe('{}');
  });

  it('should return empty object for whitespace-only string', () => {
    expect(sanitizeProviderMetadata('   ')).toBe('{}');
  });

  it('should remove gitToken from metadata', () => {
    const input = JSON.stringify({ location: 'fsn1', gitToken: 'secret-token-123' });
    const result = JSON.parse(sanitizeProviderMetadata(input));

    expect(result).toEqual({ location: 'fsn1' });
    expect(result).not.toHaveProperty('gitToken');
  });

  it('should remove gitPassword from metadata', () => {
    const input = JSON.stringify({ datacenter: 'fsn1-dc8', gitPassword: 'secret-pass' });
    const result = JSON.parse(sanitizeProviderMetadata(input));

    expect(result).toEqual({ datacenter: 'fsn1-dc8' });
    expect(result).not.toHaveProperty('gitPassword');
  });

  it('should remove cursorApiKey from metadata', () => {
    const input = JSON.stringify({ serverType: 'cx11', cursorApiKey: 'cursor-key-xyz' });
    const result = JSON.parse(sanitizeProviderMetadata(input));

    expect(result).toEqual({ serverType: 'cx11' });
    expect(result).not.toHaveProperty('cursorApiKey');
  });

  it('should remove keycloakClientSecret from metadata', () => {
    const input = JSON.stringify({ realm: 'test', keycloakClientSecret: 'client-secret' });
    const result = JSON.parse(sanitizeProviderMetadata(input));

    expect(result).toEqual({ realm: 'test' });
    expect(result).not.toHaveProperty('keycloakClientSecret');
  });

  it('should keep non-secret fields (location, image, serverType)', () => {
    const input = JSON.stringify({
      location: 'fsn1',
      image: 'ubuntu-22.04',
      serverType: 'cx11',
      cores: 2,
      memory: 4096,
      disk: 40,
    });
    const result = JSON.parse(sanitizeProviderMetadata(input));

    expect(result).toEqual({
      location: 'fsn1',
      image: 'ubuntu-22.04',
      serverType: 'cx11',
      cores: 2,
      memory: 4096,
      disk: 40,
    });
  });

  it('should remove keys matching secret patterns (password, token, secret)', () => {
    const input = JSON.stringify({
      safeField: 'value',
      apiPassword: 'secret',
      authToken: 'token',
      clientSecret: 'secret',
    });
    const result = JSON.parse(sanitizeProviderMetadata(input));

    expect(result).toEqual({ safeField: 'value' });
    expect(result).not.toHaveProperty('apiPassword');
    expect(result).not.toHaveProperty('authToken');
    expect(result).not.toHaveProperty('clientSecret');
  });

  it('should recursively sanitize nested objects', () => {
    const input = JSON.stringify({
      topLevel: 'keep',
      nested: {
        inner: 'keep',
        nestedToken: 'remove',
      },
    });
    const result = JSON.parse(sanitizeProviderMetadata(input));

    expect(result).toEqual({
      topLevel: 'keep',
      nested: { inner: 'keep' },
    });
    expect(result.nested).not.toHaveProperty('nestedToken');
  });

  it('should sanitize arrays of objects', () => {
    const input = JSON.stringify({
      items: [{ name: 'a', password: 'secret' }, { name: 'b' }],
    });
    const result = JSON.parse(sanitizeProviderMetadata(input));

    expect(result).toEqual({
      items: [{ name: 'a' }, { name: 'b' }],
    });
  });

  it('should return empty object for invalid JSON', () => {
    expect(sanitizeProviderMetadata('not valid json')).toBe('{}');
  });

  it('should return empty object when parsed value is not an object', () => {
    expect(sanitizeProviderMetadata('"string"')).toBe('{}');
    expect(sanitizeProviderMetadata('123')).toBe('{}');
  });
});
