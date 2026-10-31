import {
  getCustomerLabel,
  getCustomerSecondaryLabel,
  getUnavailableLabel,
  resolveNamedLabel,
} from './named-label.util';

describe('named-label.util', () => {
  it('prefers the first non-empty candidate', () => {
    expect(resolveNamedLabel('  Alpha  ', 'beta')).toBe('Alpha');
  });

  it('returns unavailable when all candidates are empty', () => {
    expect(resolveNamedLabel(undefined, null, '  ')).toBe(getUnavailableLabel());
  });

  it('never returns a raw id when only blank names are provided', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    expect(resolveNamedLabel(undefined)).not.toBe(uuid);
    expect(resolveNamedLabel('')).toBe(getUnavailableLabel());
  });
});

describe('customer labels (DB-18)', () => {
  it('prefers the billing-profile name and keeps the email as secondary', () => {
    const row = { customerName: ' Fischer GmbH ', userEmail: 'demo-fischer@example.test' };

    expect(getCustomerLabel(row)).toBe('Fischer GmbH');
    expect(getCustomerSecondaryLabel(row)).toBe('demo-fischer@example.test');
  });

  it('falls back to the email without a name (no secondary line)', () => {
    const row = { userEmail: 'demo@example.test' };

    expect(getCustomerLabel(row)).toBe('demo@example.test');
    expect(getCustomerSecondaryLabel(row)).toBeNull();
  });

  it('shows unavailable without name and email', () => {
    expect(getCustomerLabel({})).toBe(getUnavailableLabel());
    expect(getCustomerLabel(null)).toBe(getUnavailableLabel());
  });
});
