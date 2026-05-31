import { assertValidBullMqJobId, buildCoordinatorJobId, buildJobId, sanitizeJobIdSegment } from './job-id.util';

describe('job-id.util', () => {
  it('joins namespace and parts with .', () => {
    expect(buildJobId('billing', 'subscription', 'abc-123')).toBe('billing.subscription.abc-123');
  });

  it('omits empty parts', () => {
    expect(buildJobId('sync', undefined, 'id')).toBe('sync.id');
  });

  it('sanitizes colons and slashes in namespace and parts', () => {
    expect(buildJobId('billing:subscription', 'abc-123')).toBe('billing.subscription.abc-123');
    expect(sanitizeJobIdSegment('invoice-sync/ref')).toBe('invoice-sync.ref');
  });

  it('buildCoordinatorJobId uses allowed characters only', () => {
    expect(buildCoordinatorJobId('filter-rules-sync')).toBe('coordinator.filter-rules-sync');
    assertValidBullMqJobId(buildCoordinatorJobId('filter-rules-sync'));
  });

  it('rejects integer-only job ids', () => {
    expect(() => assertValidBullMqJobId('12345')).toThrow('must not be an integer');
  });

  it('rejects job ids containing colons', () => {
    expect(() => assertValidBullMqJobId('coordinator:bad')).toThrow("must not contain ':'");
  });

  it('rejects job ids with disallowed characters', () => {
    expect(() => assertValidBullMqJobId('billing/subscription')).toThrow('may only contain');
  });
});
