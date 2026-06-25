import type { UserResponseDto } from '@forepath/identity/frontend';

import {
  filterBillingAdminUsers,
  resolveBillingAdminUserIconClass,
  resolveBillingAdminUserLabel,
} from './billing-user-select';

describe('filterBillingAdminUsers', () => {
  const users: UserResponseDto[] = [
    { id: 'user-1', email: 'alice@example.com' } as UserResponseDto,
    { id: 'user-2', email: 'bob@example.com' } as UserResponseDto,
    { id: 'other-3', email: 'charlie@other.com' } as UserResponseDto,
  ];

  it('returns all users up to the limit when query is empty', () => {
    expect(filterBillingAdminUsers(users, '', 2)).toEqual(users.slice(0, 2));
  });

  it('filters users by email or id', () => {
    expect(filterBillingAdminUsers(users, 'alice')).toEqual([users[0]]);
    expect(filterBillingAdminUsers(users, 'user-2')).toEqual([users[1]]);
    expect(filterBillingAdminUsers(users, 'other.com')).toEqual([users[2]]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterBillingAdminUsers(users, 'missing')).toEqual([]);
  });
});

describe('resolveBillingAdminUserLabel', () => {
  const users: UserResponseDto[] = [{ id: 'user-1', email: 'alice@example.com' } as UserResponseDto];

  it('resolves a user id to email', () => {
    expect(resolveBillingAdminUserLabel('user-1', users)).toBe('alice@example.com');
  });

  it('maps known system refs to labels', () => {
    expect(resolveBillingAdminUserLabel('scheduler', users)).toBe('Scheduler');
    expect(resolveBillingAdminUserLabel('admin', users)).toBe('System');
  });

  it('returns N/A for missing or unknown refs', () => {
    expect(resolveBillingAdminUserLabel(undefined, users)).toBe('N/A');
    expect(resolveBillingAdminUserLabel('missing-user-id', users)).toBe('N/A');
  });
});

describe('resolveBillingAdminUserIconClass', () => {
  it('uses gear for system refs and envelope for users', () => {
    expect(resolveBillingAdminUserIconClass('scheduler')).toBe('bi-gear');
    expect(resolveBillingAdminUserIconClass('admin')).toBe('bi-gear');
    expect(resolveBillingAdminUserIconClass('user-1')).toBe('bi-envelope');
  });
});
