import { isUsersConsoleJwtValid, jwtPayloadHasPatAmr, parseJwtPayload } from './jwt-payload.utils';

function buildJwt(payload: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

describe('jwt-payload.utils', () => {
  describe('parseJwtPayload', () => {
    it('should decode a valid JWT payload', () => {
      const jwt = buildJwt({ sub: 'user-1', amr: ['pwd'] });

      expect(parseJwtPayload(jwt)).toEqual({ sub: 'user-1', amr: ['pwd'] });
    });

    it('should return null for invalid JWT', () => {
      expect(parseJwtPayload('not-a-jwt')).toBeNull();
    });

    it('should return null when payload segment is missing', () => {
      expect(parseJwtPayload('headeronly')).toBeNull();
    });
  });

  describe('jwtPayloadHasPatAmr', () => {
    it('should return true when amr includes pat', () => {
      expect(jwtPayloadHasPatAmr({ amr: ['pat'] })).toBe(true);
    });

    it('should return false for password sessions', () => {
      expect(jwtPayloadHasPatAmr({ amr: ['pwd'] })).toBe(false);
    });

    it('should return false for null/undefined or non-array amr', () => {
      expect(jwtPayloadHasPatAmr(null)).toBe(false);
      expect(jwtPayloadHasPatAmr(undefined)).toBe(false);
      expect(jwtPayloadHasPatAmr({ amr: 'pat' })).toBe(false);
    });
  });

  describe('isUsersConsoleJwtValid', () => {
    it('should accept unexpired password JWT', () => {
      const jwt = buildJwt({
        sub: 'user-1',
        exp: Math.floor((Date.now() + 3600000) / 1000),
        amr: ['pwd'],
      });

      expect(isUsersConsoleJwtValid(jwt)).toBe(true);
    });

    it('should reject PAT JWT', () => {
      const jwt = buildJwt({
        sub: 'user-1',
        exp: Math.floor((Date.now() + 3600000) / 1000),
        amr: ['pat'],
      });

      expect(isUsersConsoleJwtValid(jwt)).toBe(false);
    });

    it('should reject missing, expired, or unparsable JWT', () => {
      expect(isUsersConsoleJwtValid(null)).toBe(false);
      expect(isUsersConsoleJwtValid(undefined)).toBe(false);
      expect(isUsersConsoleJwtValid('bad')).toBe(false);

      const expired = buildJwt({
        sub: 'user-1',
        exp: Math.floor((Date.now() - 3600000) / 1000),
        amr: ['pwd'],
      });

      expect(isUsersConsoleJwtValid(expired)).toBe(false);
    });
  });
});
