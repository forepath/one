/**
 * Every row created by the demo data seeders uses a UUID starting with this prefix ("seed data").
 * Resets delete exactly those rows, so real data in the same database is never touched.
 */
export const DEMO_ID_PREFIX = '5eedda7a';

export const DEMO_ID_LIKE_PATTERN = `${DEMO_ID_PREFIX}-%`;

export function isDemoId(id: string): boolean {
  return id.startsWith(`${DEMO_ID_PREFIX}-`);
}

/**
 * Builds an RFC 4122 v4-shaped UUID whose first group is the demo prefix.
 * `nextNibble` must return integers in [0, 15].
 */
export function createDemoId(nextNibble: () => number): string {
  const hex = (count: number): string => Array.from({ length: count }, () => nextNibble().toString(16)).join('');
  const variant = (8 + (nextNibble() % 4)).toString(16);

  return `${DEMO_ID_PREFIX}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
