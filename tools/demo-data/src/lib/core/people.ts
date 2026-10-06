import {
  CITIES,
  CityFixture,
  COMPANY_KINDS,
  COMPANY_LEGAL_FORMS,
  COMPANY_STEMS,
  FIRST_NAMES,
  LAST_NAMES,
  STREETS,
} from './fixtures';
import { DemoRandom, slugify } from './random';

export interface DemoPerson {
  firstName: string;
  lastName: string;
  fullName: string;
  company: string | null;
  emailLocalPart: string;
  addressLine1: string;
  addressLine2: string | null;
  location: CityFixture;
  phone: string;
}

export function createCompanyName(random: DemoRandom): string {
  return `${random.pick(COMPANY_STEMS)} ${random.pick(COMPANY_KINDS)} ${random.pick(COMPANY_LEGAL_FORMS)}`;
}

export function createVatId(random: DemoRandom, location: CityFixture): string | null {
  if (!location.vatPrefix) {
    return null;
  }

  return `${location.vatPrefix}${random.int(100000000, 999999999)}`;
}

/**
 * Creates a person with a unique email local part. `usedLocalParts` is shared across one
 * scope (for example a tenant) to avoid unique-constraint collisions.
 */
export function createPerson(
  random: DemoRandom,
  usedLocalParts: Set<string>,
  options: { business?: boolean } = {},
): DemoPerson {
  const firstName = random.pick(FIRST_NAMES);
  const lastName = random.pick(LAST_NAMES);
  const base = `${slugify(firstName)}.${slugify(lastName)}`.replace(/-/g, '');
  let emailLocalPart = base;
  let suffix = 2;

  while (usedLocalParts.has(emailLocalPart)) {
    emailLocalPart = `${base}${suffix}`;
    suffix++;
  }

  usedLocalParts.add(emailLocalPart);
  const location = random.pick(CITIES);
  const business = options.business ?? random.chance(0.6);

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    company: business ? createCompanyName(random) : null,
    emailLocalPart,
    addressLine1: `${random.pick(STREETS)} ${random.int(1, 180)}`,
    addressLine2: random.chance(0.2) ? `${random.int(1, 5)}. OG` : null,
    location,
    phone: `${location.phonePrefix} ${random.int(1000000, 9999999)}`,
  };
}
