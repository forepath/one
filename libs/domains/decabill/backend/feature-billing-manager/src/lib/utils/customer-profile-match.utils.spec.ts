import {
  isValidSubscriptionNumber,
  matchesCustomerProfile,
  normalizeSubscriptionNumber,
} from './customer-profile-match.utils';

describe('customer-profile-match.utils', () => {
  const profile = {
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Acme GmbH',
    email: 'billing@example.com',
  };

  it('normalizes subscription number to uppercase', () => {
    expect(normalizeSubscriptionNumber('sub-000001')).toBe('SUB-000001');
  });

  it('validates subscription number pattern', () => {
    expect(isValidSubscriptionNumber('SUB-000001')).toBe(true);
    expect(isValidSubscriptionNumber('SUB-2026-00001')).toBe(false);
  });

  it('matches profile when all fields align', () => {
    expect(
      matchesCustomerProfile(profile, {
        customerName: 'Jane Doe',
        email: 'billing@example.com',
        company: 'Acme GmbH',
      }),
    ).toBe(true);
  });

  it('matches profile when company is omitted', () => {
    expect(
      matchesCustomerProfile(profile, {
        customerName: 'Jane Doe',
        email: 'billing@example.com',
      }),
    ).toBe(true);
  });

  it('rejects when email differs', () => {
    expect(
      matchesCustomerProfile(profile, {
        customerName: 'Jane Doe',
        email: 'other@example.com',
      }),
    ).toBe(false);
  });

  it('rejects when name differs', () => {
    expect(
      matchesCustomerProfile(profile, {
        customerName: 'John Doe',
        email: 'billing@example.com',
      }),
    ).toBe(false);
  });

  it('rejects when company provided but does not match', () => {
    expect(
      matchesCustomerProfile(profile, {
        customerName: 'Jane Doe',
        email: 'billing@example.com',
        company: 'Other GmbH',
      }),
    ).toBe(false);
  });
});
