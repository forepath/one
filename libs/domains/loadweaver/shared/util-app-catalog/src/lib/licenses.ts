/**
 * SPDX ids of free / open-source licences the app store lists (OSI-approved or public-domain dedications).
 * Source-available licences (BUSL-1.1, SSPL-1.0, Elastic-2.0, Commons Clause, …) are not on it.
 */
export const FREE_LICENSES: readonly string[] = [
  '0BSD',
  'AFL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'Artistic-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSL-1.0',
  'CC0-1.0',
  'CDDL-1.0',
  'ECL-2.0',
  'EPL-1.0',
  'EPL-2.0',
  'EUPL-1.2',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'MS-PL',
  'MulanPSL-2.0',
  'NCSA',
  'OSL-3.0',
  'PostgreSQL',
  'Python-2.0',
  'UPL-1.0',
  'Unlicense',
  'W3C',
  'Zlib',
];

export type LicenseCheck =
  | { verdict: 'free' }
  /** `LicenseRef-…` ids: allowed only after human review (e.g. a product's free tier). */
  | { verdict: 'review'; ids: string[] }
  | { verdict: 'not-free'; ids: string[] };

/**
 * Checks an SPDX licence id or expression (`MIT OR Apache-2.0`, `GPL-2.0-only WITH Classpath-exception-2.0`): every
 * licence in it must be on `FREE_LICENSES` (exception ids after `WITH` are not checked).
 */
export function checkLicense(expression: string): LicenseCheck {
  const tokens = expression.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  const ids: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === 'AND' || token === 'OR') continue;

    if (token === 'WITH') {
      i++;
      continue;
    }

    ids.push(token);
  }

  if (ids.length === 0) return { verdict: 'not-free', ids: [] };

  const notFree = ids.filter((id) => !FREE_LICENSES.includes(id) && !id.startsWith('LicenseRef-'));

  if (notFree.length > 0) return { verdict: 'not-free', ids: notFree };

  const review = ids.filter((id) => id.startsWith('LicenseRef-'));

  return review.length > 0 ? { verdict: 'review', ids: review } : { verdict: 'free' };
}
