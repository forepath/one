import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** MaxMind's public test database (pinned commit and checksum): 81.2.69.160/27 is GB, 89.160.20.128/25 SE. */
const TEST_DB =
  'https://raw.githubusercontent.com/maxmind/MaxMind-DB/0ee49278e35fd7bdf341ac236edbba20de1aceb9/test-data/GeoIP2-Country-Test.mmdb';
export const GEOIP_TEST_DB_SHA256 = 'ff5a273c91d332bcfb4d808cc128c4f98cb59bb55f75931b64ff69022ddfa1bc';

/** Path of the test database, downloaded once per machine and checked against the pin. */
export function geoipTestDb(): string {
  const cached = join(tmpdir(), 'lw-geoip2-country-test.mmdb');

  if (!existsSync(cached)) execFileSync('curl', ['-sSfL', '-o', cached, TEST_DB]);

  if (createHash('sha256').update(readFileSync(cached)).digest('hex') !== GEOIP_TEST_DB_SHA256) {
    rmSync(cached, { force: true });
    throw new Error('GeoIP test database does not match the pinned checksum');
  }

  return cached;
}
