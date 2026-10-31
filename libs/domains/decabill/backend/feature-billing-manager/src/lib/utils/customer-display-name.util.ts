import type { CustomerProfileEntity } from '../entities/customer-profile.entity';

type CustomerNameSource = Pick<CustomerProfileEntity, 'company' | 'firstName' | 'lastName'>;

/** Readable customer name from the billing profile: company, else "first last"; `undefined` when neither is set. */
export function formatCustomerDisplayName(profile: CustomerNameSource | null | undefined): string | undefined {
  if (!profile) {
    return undefined;
  }

  const company = profile.company?.trim();

  if (company) {
    return company;
  }

  const fullName = [profile.firstName?.trim(), profile.lastName?.trim()].filter(Boolean).join(' ');

  return fullName || undefined;
}

/** Minimal repository surface used to look up the profiles of a page of rows. */
export interface CustomerProfilesByUserIdsLookup {
  findByUserIds(userIds: string[]): Promise<Array<CustomerNameSource & Pick<CustomerProfileEntity, 'userId'>>>;
}

/**
 * Customer names for the user ids of one admin list page (DB-18). Admin lists show the billing-profile name instead of
 * the login email; rows without a profile name keep the email only. Lookup failures fall back to no names.
 */
export async function resolveCustomerNamesByUserId(
  repository: CustomerProfilesByUserIdsLookup | null | undefined,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(userIds.filter(Boolean))];

  if (!repository || unique.length === 0) {
    return names;
  }

  const profiles = await repository.findByUserIds(unique);

  for (const profile of profiles) {
    const name = formatCustomerDisplayName(profile);

    if (name) {
      names.set(profile.userId, name);
    }
  }

  return names;
}
