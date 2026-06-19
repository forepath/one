import { resolveCountryDisplayName } from './country-display-name.util';

describe('resolveCountryDisplayName', () => {
  it('returns official English name for ISO2 code', () => {
    expect(resolveCountryDisplayName('de')).toBe('Germany');
    expect(resolveCountryDisplayName('GB')).toBe('United Kingdom');
  });

  it('returns undefined for empty input', () => {
    expect(resolveCountryDisplayName(undefined)).toBeUndefined();
    expect(resolveCountryDisplayName('  ')).toBeUndefined();
  });

  it('falls back to the code when unknown', () => {
    expect(resolveCountryDisplayName('ZZ')).toBe('ZZ');
  });
});
