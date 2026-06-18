import type { UserResponseDto } from '@forepath/identity/frontend';

export function filterBillingAdminUsers(users: UserResponseDto[], query: string, limit = 20): UserResponseDto[] {
  const term = query.trim().toLowerCase();
  const filtered = term
    ? users.filter((user) => user.email.toLowerCase().includes(term) || user.id.toLowerCase().includes(term))
    : users;

  return filtered.slice(0, limit);
}
