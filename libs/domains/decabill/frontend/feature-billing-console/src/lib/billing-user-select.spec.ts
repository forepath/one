import type { UserResponseDto } from '@forepath/identity/frontend';

import { filterBillingAdminUsers } from './billing-user-select';

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
