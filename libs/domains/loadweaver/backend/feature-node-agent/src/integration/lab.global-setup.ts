import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export const LAB_IMAGE = 'loadweaver-agent-lab:test';

/** Builds the lab node image (cached by Docker). Fails loudly without Docker: lab tests are never skipped. */
export default async function globalSetup(): Promise<void> {
  const context = resolve(__dirname, '../../../../../../../apps/loadweaver/backend-node-agent/lab');

  execFileSync('docker', ['build', '-q', '-t', LAB_IMAGE, '-f', `${context}/Dockerfile.lab`, context], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
