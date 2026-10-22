/**
 * Writes the committed standalone host script from its generator (the spec asserts both stay equal):
 * `nx run shared-backend-util-container-runtime:generate-host-script`.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

import { buildGvisorHostScript } from '../src/lib/gvisor-install.script';

// Run from the workspace root (Nx run-commands default).
const target = join(process.cwd(), 'apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh');

writeFileSync(target, buildGvisorHostScript(), { mode: 0o755 });
process.stdout.write(`Wrote ${target}\n`);
