import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { PROTOCOL_VERSION } from '../lib/versioning';
import { currentSnapshot, loadSnapshot, PROTOCOL_DIRECTIONS, snapshotFile } from './protocol-snapshots';

/**
 * Release step (3.26): freezes the current agent-protocol schemas as `src/compat/v<PROTOCOL_VERSION>/`, the N-1
 * snapshot the next release is checked against. Runs only with `LW_FREEZE_AGENT_PROTOCOL=1`, via
 * `nx run loadweaver-shared-util-agent-protocol:freeze-protocol`. An existing snapshot of the same version is only
 * rewritten if identical (a changed protocol needs a new `PROTOCOL_VERSION`).
 */
const freeze = process.env['LW_FREEZE_AGENT_PROTOCOL'] === '1';

(freeze ? describe : describe.skip)('freeze agent-protocol snapshot', () => {
  it(`writes v${PROTOCOL_VERSION}`, () => {
    for (const direction of PROTOCOL_DIRECTIONS) {
      const file = snapshotFile(PROTOCOL_VERSION, direction);
      const snapshot = JSON.parse(JSON.stringify(currentSnapshot(direction))) as unknown;

      if (existsSync(file) && !isDeepStrictEqual(loadSnapshot(PROTOCOL_VERSION, direction), snapshot))
        throw new Error(
          `${file} exists and differs from the current schemas: bump PROTOCOL_VERSION before freezing a changed protocol`,
        );

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
  });
});
