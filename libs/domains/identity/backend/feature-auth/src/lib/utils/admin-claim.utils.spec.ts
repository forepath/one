import { createHash } from 'node:crypto';

import { AdminClaimAttemptLimiter, adminClaimTokenMatches, resolveAdminClaimConfig } from './admin-claim.utils';

describe('admin claim utils', () => {
  const token = 'lwc_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
  const hex = createHash('sha256').update(token).digest('hex');

  it('is off unless ADMIN_CLAIM_TOKEN_SHA256 is set, and fails closed on malformed values', () => {
    expect(resolveAdminClaimConfig({})).toEqual({ configured: false, hash: null });
    expect(resolveAdminClaimConfig({ ADMIN_CLAIM_TOKEN_SHA256: ' ' })).toEqual({ configured: false, hash: null });
    expect(resolveAdminClaimConfig({ ADMIN_CLAIM_TOKEN_SHA256: 'xyz' })).toEqual({ configured: true, hash: null });
    expect(resolveAdminClaimConfig({ ADMIN_CLAIM_TOKEN_SHA256: hex.toUpperCase() }).hash?.toString('hex')).toBe(hex);
  });

  it('compares the token hash', () => {
    const { hash } = resolveAdminClaimConfig({ ADMIN_CLAIM_TOKEN_SHA256: hex });

    expect(adminClaimTokenMatches(token, hash)).toBe(true);
    expect(adminClaimTokenMatches(`${token}x`, hash)).toBe(false);
    expect(adminClaimTokenMatches(undefined, hash)).toBe(false);
    expect(adminClaimTokenMatches(token, null)).toBe(false);
  });

  it('blocks a client after too many failures until the window ends', () => {
    const limiter = new AdminClaimAttemptLimiter(2, 1000);

    limiter.recordFailure('a', 0);
    expect(limiter.isBlocked('a', 10)).toBe(false);
    limiter.recordFailure('a', 20);
    expect(limiter.isBlocked('a', 30)).toBe(true);
    expect(limiter.isBlocked('b', 30)).toBe(false);
    expect(limiter.isBlocked('a', 1001)).toBe(false);
  });
});
