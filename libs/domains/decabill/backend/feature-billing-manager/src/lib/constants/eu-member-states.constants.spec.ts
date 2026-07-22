import { isEuMemberState, normalizeVatCountryCode } from './eu-member-states.constants';

describe('eu-member-states.constants', () => {
  describe('normalizeVatCountryCode', () => {
    it('returns null for empty input', () => {
      expect(normalizeVatCountryCode(null)).toBeNull();
      expect(normalizeVatCountryCode(undefined)).toBeNull();
      expect(normalizeVatCountryCode('')).toBeNull();
      expect(normalizeVatCountryCode('D')).toBeNull();
    });

    it('uppercases and maps GR to EL', () => {
      expect(normalizeVatCountryCode(' de ')).toBe('DE');
      expect(normalizeVatCountryCode('gr')).toBe('EL');
      expect(normalizeVatCountryCode('EL')).toBe('EL');
    });
  });

  describe('isEuMemberState', () => {
    it('recognizes EU members including Greece aliases', () => {
      expect(isEuMemberState('DE')).toBe(true);
      expect(isEuMemberState('FR')).toBe(true);
      expect(isEuMemberState('GR')).toBe(true);
      expect(isEuMemberState('EL')).toBe(true);
    });

    it('rejects non-EU and invalid codes', () => {
      expect(isEuMemberState('US')).toBe(false);
      expect(isEuMemberState('GB')).toBe(false);
      expect(isEuMemberState(null)).toBe(false);
    });
  });
});
