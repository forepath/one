import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SPILO_GID, SPILO_TLS_SUBDIR, SPILO_UID } from '@forepath/loadweaver/backend/feature-node-agent';
import type { PostgresTls } from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

/**
 * What the agent does before it starts a member's Spilo (`installSpiloTls` + `ownBySpilo`, "bootstrap with the final
 * config", 2026-10-27): Spilo reads its server certificate from `<postgresDir>/tls` (`SPILO_TLS_FILE_ENVIRONMENT`).
 * The directory always exists and belongs to Spilo's `postgres` user (without a certificate Spilo generates its
 * self-signed one there); with a certificate both files are written there, mode 0600, owned by `postgres`.
 * Runs as root in a throw-away container: the test user can't hand files to uid 101.
 */
export function prepareSpiloTls(
  postgresDir: string,
  tls?: Pick<PostgresTls, 'certificatePem' | 'privateKeyPem'> | null,
): void {
  const source = mkdtempSync(join(tmpdir(), 'lw-spilo-tls-'));

  try {
    if (tls) {
      writeFileSync(join(source, 'server.crt'), tls.certificatePem, { mode: 0o600 });
      writeFileSync(join(source, 'server.key'), tls.privateKeyPem, { mode: 0o600 });
    }

    const dir = `/work/${SPILO_TLS_SUBDIR}`;
    const owner = `${SPILO_UID}:${SPILO_GID}`;
    const script = [
      `mkdir -p ${dir}`,
      `chown ${owner} /work ${dir}`,
      `chmod 700 ${dir}`,
      ...(tls
        ? [
            `cp /tls/server.crt /tls/server.key ${dir}/`,
            `chown ${owner} ${dir}/server.crt ${dir}/server.key`,
            `chmod 600 ${dir}/server.crt ${dir}/server.key`,
          ]
        : []),
    ].join(' && ');

    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${postgresDir}:/work`,
        '-v',
        `${source}:/tls:ro`,
        COMPONENT_IMAGES['node-shell'],
        'sh',
        '-c',
        script,
      ],
      { stdio: 'pipe' },
    );
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
}
