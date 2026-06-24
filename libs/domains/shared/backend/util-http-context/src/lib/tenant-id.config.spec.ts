import {
  DEFAULT_TENANT,
  TENANTS_ALLOW_DEFAULT_ENV,
  isConfiguredTenant,
  isDefaultTenantAllowed,
  isValidTenantIdFormat,
  parseConfiguredTenants,
  readIncomingTenantIdFromHandshake,
  readIncomingTenantIdFromHeaders,
  resolveTenantIdFromHeader,
} from './tenant-id.config';

describe('tenant-id.config', () => {
  const originalAllowDefault = process.env[TENANTS_ALLOW_DEFAULT_ENV];

  afterEach(() => {
    if (originalAllowDefault === undefined) {
      delete process.env[TENANTS_ALLOW_DEFAULT_ENV];
    } else {
      process.env[TENANTS_ALLOW_DEFAULT_ENV] = originalAllowDefault;
    }
  });

  it('isDefaultTenantAllowed defaults to true', () => {
    delete process.env[TENANTS_ALLOW_DEFAULT_ENV];

    expect(isDefaultTenantAllowed()).toBe(true);
    expect(isDefaultTenantAllowed('')).toBe(true);
    expect(isDefaultTenantAllowed('true')).toBe(true);
    expect(isDefaultTenantAllowed('FALSE')).toBe(false);
  });

  it('parseConfiguredTenants includes default by default', () => {
    expect(parseConfiguredTenants(undefined)).toEqual(['default']);
    expect(parseConfiguredTenants('')).toEqual(['default']);
    expect(parseConfiguredTenants('one,two')).toEqual(['default', 'one', 'two']);
    expect(parseConfiguredTenants('default,one')).toEqual(['default', 'one']);
  });

  it('parseConfiguredTenants excludes default when TENANTS_ALLOW_DEFAULT is false', () => {
    process.env[TENANTS_ALLOW_DEFAULT_ENV] = 'false';

    expect(parseConfiguredTenants(undefined)).toEqual([]);
    expect(parseConfiguredTenants('')).toEqual([]);
    expect(parseConfiguredTenants('one,two')).toEqual(['one', 'two']);
    expect(parseConfiguredTenants('default,one')).toEqual(['one']);
  });

  it('resolveTenantIdFromHeader defaults to default tenant when allowed', () => {
    expect(resolveTenantIdFromHeader(undefined, ['default', 'one'])).toBe('default');
    expect(resolveTenantIdFromHeader('   ', ['default', 'one'])).toBe('default');
  });

  it('resolveTenantIdFromHeader rejects missing, blank, and default when default is disabled', () => {
    process.env[TENANTS_ALLOW_DEFAULT_ENV] = 'false';
    const tenants = ['one'];

    expect(resolveTenantIdFromHeader(undefined, tenants)).toBeUndefined();
    expect(resolveTenantIdFromHeader('   ', tenants)).toBeUndefined();
    expect(resolveTenantIdFromHeader('default', tenants)).toBeUndefined();
    expect(resolveTenantIdFromHeader('one', tenants)).toBe('one');
  });

  it('resolveTenantIdFromHeader accepts configured tenants', () => {
    expect(resolveTenantIdFromHeader('one', ['default', 'one'])).toBe('one');
  });

  it('resolveTenantIdFromHeader rejects unknown tenants', () => {
    expect(resolveTenantIdFromHeader('unknown', ['default', 'one'])).toBeUndefined();
  });

  it('resolveTenantIdFromHeader rejects invalid format', () => {
    expect(resolveTenantIdFromHeader('bad tenant', ['default'])).toBeUndefined();
    expect(isValidTenantIdFormat('')).toBe(false);
    expect(isValidTenantIdFormat(DEFAULT_TENANT)).toBe(true);
  });

  it('isConfiguredTenant checks membership', () => {
    const tenants = parseConfiguredTenants('alpha');

    expect(isConfiguredTenant('default', tenants)).toBe(true);
    expect(isConfiguredTenant('alpha', tenants)).toBe(true);
    expect(isConfiguredTenant('beta', tenants)).toBe(false);
  });

  it('readIncomingTenantIdFromHeaders reads x-tenant header values', () => {
    expect(readIncomingTenantIdFromHeaders(undefined)).toBeUndefined();
    expect(readIncomingTenantIdFromHeaders({ 'x-tenant': 'default' })).toBe('default');
    expect(readIncomingTenantIdFromHeaders({ 'x-tenant': ['default'] })).toBe('default');
    expect(readIncomingTenantIdFromHeaders({ 'x-tenant': 'unknown' })).toBeUndefined();
  });

  it('readIncomingTenantIdFromHandshake prefers header over auth payload', () => {
    expect(readIncomingTenantIdFromHandshake({ 'x-tenant': 'default' }, { tenantId: 'acme' })).toBe('default');

    const originalTenants = process.env['TENANTS'];

    process.env['TENANTS'] = 'acme';

    try {
      expect(readIncomingTenantIdFromHandshake(undefined, { tenantId: 'acme' })).toBe('acme');
      expect(readIncomingTenantIdFromHandshake(undefined, { 'X-Tenant': 'acme' })).toBe('acme');
      expect(readIncomingTenantIdFromHandshake(undefined, { tenantId: 'not-configured' })).toBeUndefined();
    } finally {
      if (originalTenants === undefined) {
        delete process.env['TENANTS'];
      } else {
        process.env['TENANTS'] = originalTenants;
      }
    }
  });
});
