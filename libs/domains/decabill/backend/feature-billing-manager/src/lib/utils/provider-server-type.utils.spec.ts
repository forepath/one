import {
  assertServerTypeAllowed,
  effectiveSchemaSupportsServerTypeSelection,
  normalizeAllowedServerTypes,
  providerConfigSchemaSupportsServerTypeSelection,
  stripServerTypeFromRequestedConfig,
} from '../utils/provider-server-type.utils';

describe('provider-server-type.utils', () => {
  const schemaWithServerType = { basePriceFromField: 'serverType', properties: {} };

  it('providerConfigSchemaSupportsServerTypeSelection returns true when basePriceFromField is serverType', () => {
    expect(providerConfigSchemaSupportsServerTypeSelection(schemaWithServerType)).toBe(true);
  });

  it('effectiveSchemaSupportsServerTypeSelection falls back to provider schema', () => {
    expect(effectiveSchemaSupportsServerTypeSelection({}, schemaWithServerType)).toBe(true);
  });

  it('stripServerTypeFromRequestedConfig removes serverType', () => {
    expect(stripServerTypeFromRequestedConfig({ serverType: 'cx11', region: 'fsn1' })).toEqual({ region: 'fsn1' });
  });

  it('assertServerTypeAllowed rejects unknown types', () => {
    expect(assertServerTypeAllowed('cx22', ['cx11'])).toBe('serverType "cx22" is not allowed for this plan');
  });

  it('assertServerTypeAllowed accepts allowed types', () => {
    expect(assertServerTypeAllowed('cx11', ['cx11', 'cx22'])).toBeNull();
  });

  it('normalizeAllowedServerTypes deduplicates and trims', () => {
    expect(normalizeAllowedServerTypes([' cx11 ', 'cx11', '', 'cx22', 1])).toEqual(['cx11', 'cx22']);
  });
});
