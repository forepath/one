import type { UserResponseDto } from '@forepath/identity/frontend';

export function filterBillingAdminUsers(users: UserResponseDto[], query: string, limit = 20): UserResponseDto[] {
  const term = query.trim().toLowerCase();
  const filtered = term
    ? users.filter((user) => user.email.toLowerCase().includes(term) || user.id.toLowerCase().includes(term))
    : users;

  return filtered.slice(0, limit);
}

export function resolveBillingAdminUserLabel(userRef: string | null | undefined, users: UserResponseDto[]): string {
  const ref = userRef?.trim();

  if (!ref) {
    return unavailableUserLabel();
  }

  if (ref === 'scheduler') {
    return $localize`:@@featureBilling-triggeredByScheduler:Scheduler`;
  }

  if (ref === 'admin') {
    return $localize`:@@featureBilling-triggeredBySystem:System`;
  }

  const user = users.find((item) => item.id === ref);

  return user?.email?.trim() || unavailableUserLabel();
}

function unavailableUserLabel(): string {
  return $localize`:@@featureBilling-notAvailable:N/A`;
}

export function resolveBillingAdminUserIconClass(userRef: string | null | undefined): string {
  const ref = userRef?.trim();

  if (ref === 'scheduler' || ref === 'admin') {
    return 'bi-gear';
  }

  return 'bi-envelope';
}
