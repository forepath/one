/**
 * Generates DigitalOcean-style hostnames: adjective-noun-xxxxx (single-level subdomain, no dots).
 * Used for DNS records like awesome-armadillo-abc12.spirde.com so SSL can be issued.
 */

const ADJECTIVES = [
  'awesome',
  'brave',
  'calm',
  'daring',
  'eager',
  'fancy',
  'gentle',
  'happy',
  'icy',
  'jolly',
  'kind',
  'lucky',
  'mighty',
  'noble',
  'odd',
  'proud',
  'quick',
  'rapid',
  'swift',
  'tidy',
  'urban',
  'vivid',
  'witty',
  'young',
  'zesty',
];
const NOUNS = [
  'armadillo',
  'bear',
  'cobra',
  'dragon',
  'eagle',
  'falcon',
  'goat',
  'hawk',
  'ibis',
  'jaguar',
  'koala',
  'lion',
  'mouse',
  'newt',
  'otter',
  'panda',
  'quail',
  'raven',
  'sloth',
  'tiger',
  'urchin',
  'viper',
  'wolf',
  'yak',
  'zebra',
];
const SUFFIX_LENGTH = 5;
const ALPHANUMERIC = [...'abcdefghijklmnopqrstuvwxyz0123456789'];

/**
 * Returns a random element from an array.
 */
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Generates a short random alphanumeric suffix (lowercase).
 */
function randomSuffix(length: number): string {
  let result = '';

  for (let i = 0; i < length; i++) {
    result += pick(ALPHANUMERIC);
  }

  return result;
}

/**
 * Generates a single-level subdomain hostname: adjective-noun-xxxxx.
 * No dots allowed so the result is a valid single subdomain for SSL.
 */
export function generateHostnameCandidate(): string {
  const adjective = pick(ADJECTIVES);
  const noun = pick(NOUNS);
  const suffix = randomSuffix(SUFFIX_LENGTH);

  return `${adjective}-${noun}-${suffix}`;
}

/**
 * Validates that a hostname is a single-level subdomain (no dots).
 */
export function isValidSubdomainHostname(hostname: string): boolean {
  if (typeof hostname !== 'string' || hostname.length === 0 || hostname.length > 128) {
    return false;
  }

  return !hostname.includes('.') && /^[a-z0-9-]+$/.test(hostname);
}
