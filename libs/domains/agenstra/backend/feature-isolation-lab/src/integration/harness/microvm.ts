import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ISOLATION_LAB_LABEL, ISOLATION_LAB_QEMU_BASE_IMAGE } from '../../lib/isolation-lab.config';

import { REPO_ROOT } from './lab-host';
import { docker as hostDocker, runProcessOrThrow } from './process';

/** Small Debian worker below the microVM's guest root (python3, nslookup, an unprivileged agent user). */
export const LAB_MICROVM_GUEST_IMAGE = 'agenstra-isolation-lab-microvm-guest:local';
/** Shared launcher image built from the repository's apps/shared/microvm-launcher (the worker image's base). */
export const LAB_MICROVM_LAUNCHER_IMAGE = 'agenstra-isolation-lab-microvm-launcher:local';
/** MicroVM worker image built from the repository's Dockerfile.worker-microvm on top of the lab guest. */
export const LAB_MICROVM_IMAGE = 'agenstra-isolation-lab-microvm:local';

const BRIDGE_ENTRIES = { 'bridge-host.cjs': 'host.ts', 'bridge-guest.cjs': 'guest.ts' } as const;

/**
 * Build the lab microVM worker image exactly like the `worker-microvm-container-image` target does (the shared
 * launcher image from `shared-microvm-launcher:container-image`'s context, then Dockerfile.worker-microvm on it), but
 * on a small Debian worker so it loads into lab VMs fast.
 */
export async function buildLabMicrovmImages(): Promise<void> {
  const context = fs.mkdtempSync(path.join(os.tmpdir(), 'agenstra-lab-microvm-'));

  try {
    // The launcher's build context, as the `copy-microvm-bridge` target assembles it.
    for (const entry of ['rootfs', 'src']) {
      fs.cpSync(path.join(REPO_ROOT, 'apps/shared/microvm-launcher', entry), path.join(context, entry), {
        recursive: true,
      });
    }

    fs.mkdirSync(path.join(context, 'microvm-bridge'));

    for (const [bundle, entry] of Object.entries(BRIDGE_ENTRIES)) {
      await runProcessOrThrow(
        path.join(REPO_ROOT, 'node_modules/.bin/esbuild'),
        [
          path.join(REPO_ROOT, 'libs/domains/shared/backend/util-microvm-bridge/src/bin', entry),
          '--bundle',
          '--platform=node',
          '--target=node20',
          '--format=cjs',
          `--outfile=${path.join(context, 'microvm-bridge', bundle)}`,
          `--tsconfig=${path.join(REPO_ROOT, 'libs/domains/shared/backend/util-microvm-bridge/tsconfig.lib.json')}`,
          '--legal-comments=none',
        ],
        { timeoutMs: 5 * 60_000 },
      );
    }

    await hostDocker(
      [
        'build',
        '-q',
        '-t',
        LAB_MICROVM_LAUNCHER_IMAGE,
        '--label',
        `${ISOLATION_LAB_LABEL}=image`,
        '-f',
        path.join(REPO_ROOT, 'apps/shared/microvm-launcher/Dockerfile'),
        context,
      ],
      { timeoutMs: 40 * 60_000 },
    );

    // The guest's original entrypoint (the launcher's AGENSTRA_MICROVM_ENTRYPOINT) prints a marker and idles.
    fs.writeFileSync(
      path.join(context, 'Dockerfile.lab-guest'),
      `FROM ${ISOLATION_LAB_QEMU_BASE_IMAGE}
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 bind9-dnsutils procps ca-certificates \\
 && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home agent \\
 && printf '#!/bin/sh\\necho lab-workload-started\\nexec sleep infinity\\n' > /usr/local/bin/docker-entrypoint.sh \\
 && chmod 0755 /usr/local/bin/docker-entrypoint.sh
WORKDIR /home/agent
`,
    );
    await hostDocker(
      [
        'build',
        '-q',
        '-t',
        LAB_MICROVM_GUEST_IMAGE,
        '--label',
        `${ISOLATION_LAB_LABEL}=image`,
        '-f',
        path.join(context, 'Dockerfile.lab-guest'),
        context,
      ],
      { timeoutMs: 20 * 60_000 },
    );
    await hostDocker(
      [
        'build',
        '-q',
        '-t',
        LAB_MICROVM_IMAGE,
        '--label',
        `${ISOLATION_LAB_LABEL}=image`,
        '--build-arg',
        `WORKER_IMAGE=${LAB_MICROVM_GUEST_IMAGE}`,
        '--build-arg',
        `LAUNCHER_IMAGE=${LAB_MICROVM_LAUNCHER_IMAGE}`,
        '-f',
        path.join(REPO_ROOT, 'apps/agenstra/backend-agent-manager/Dockerfile.worker-microvm'),
        context,
      ],
      { timeoutMs: 40 * 60_000 },
    );
  } finally {
    fs.rmSync(context, { recursive: true, force: true });
  }
}
