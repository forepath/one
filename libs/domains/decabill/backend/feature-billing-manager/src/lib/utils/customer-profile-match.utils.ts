import type { CustomerProfileEntity } from '../entities/customer-profile.entity';

export const SUBSCRIPTION_NUMBER_PATTERN = /^SUB-\d{6}$/;

export const PUBLIC_WITHDRAWAL_MATCH_ERROR = 'We could not find a subscription matching the details provided.';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeSubscriptionNumber(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidSubscriptionNumber(value: string): boolean {
  return SUBSCRIPTION_NUMBER_PATTERN.test(normalizeSubscriptionNumber(value));
}

export function matchesCustomerProfile(
  profile: Pick<CustomerProfileEntity, 'firstName' | 'lastName' | 'company' | 'email'>,
  input: { customerName: string; email: string; company?: string },
): boolean {
  const profileEmail = normalizeText(profile.email);
  const inputEmail = normalizeText(input.email);

  if (!profileEmail || profileEmail !== inputEmail) {
    return false;
  }

  const profileName = normalizeText([profile.firstName, profile.lastName].filter(Boolean).join(' '));
  const inputName = normalizeText(input.customerName);

  if (!profileName || profileName !== inputName) {
    return false;
  }

  const inputCompany = normalizeText(input.company);

  if (inputCompany) {
    const profileCompany = normalizeText(profile.company);

    if (!profileCompany || profileCompany !== inputCompany) {
      return false;
    }
  }

  return true;
}
