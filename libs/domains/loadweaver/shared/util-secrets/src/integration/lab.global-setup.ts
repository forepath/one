import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SOPS_LAB_IMAGE = 'loadweaver-sops-lab:test';

/**
 * Builds the lab image (digest-pinned official SOPS image + checksum-pinned official age release; cached by Docker).
 * Fails loudly without Docker: lab tests are never skipped.
 */
export default async function globalSetup(): Promise<void> {
  // The Dockerfile has no COPY / ADD of local files, so it goes in through stdin without a build context (and lives
  // outside a folder of its own, so Nx doesn't infer a Docker project from it).
  execFileSync('docker', ['build', '-q', '-t', SOPS_LAB_IMAGE, '-'], {
    input: readFileSync(resolve(__dirname, 'sops-lab.Dockerfile')),
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}
