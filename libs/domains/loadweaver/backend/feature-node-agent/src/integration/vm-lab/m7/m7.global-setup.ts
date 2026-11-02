import '../register-paths';

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { vmLabGlobalSetup } from '@forepath/shared/backend/util-vm-lab';

import { LAB_LABEL } from '../docker';
import { ensureGolden, ensureQemuImage } from '../golden';
import {
  APT_SOURCE_BUNDLE,
  bundleEntry,
  bundlesWithDecoratorMetadata,
  UPDATES_AGENT_BUNDLE,
  WORKSPACE,
} from '../vm-lab.global-setup';

import { CLI_BUNDLE, M7_AGENT_BUNDLE, M7_CLUSTER_AGENT_BUNDLE } from './m7-lab';

/**
 * Global setup of the M7 VM lab (`vm-lab-m7`) and the spikes (`vm-lab-spikes`): the locks (heavy + VM lab), the host
 * memory check for the largest spec (7 GiB + margin), the nested-virtualization preflight (report read by the specs),
 * the golden image and the bundles the specs copy into the VMs. Images of this tree (launcher, control plane, Agenstra
 * lab images) are prerequisites the gate builds; each spec checks for the ones it needs.
 */
export default async function globalSetup(): Promise<void> {
  const log = (line: string) => process.stderr.write(`[vm-lab] ${line}\n`);
  const qemu = await ensureQemuImage();

  await vmLabGlobalSetup({ label: LAB_LABEL, peakMemoryMb: 7168, preflightImage: qemu, log });
  await ensureGolden(log);

  const started = Date.now();

  mkdirSync(join(M7_AGENT_BUNDLE, '..'), { recursive: true });
  // One tsc run for both Nest entries (decorator metadata), then esbuild per entry.
  bundlesWithDecoratorMetadata(
    [
      [join(__dirname, 'm7-agent.entry.ts'), M7_AGENT_BUNDLE],
      [join(__dirname, 'm7-cluster-agent.entry.ts'), M7_CLUSTER_AGENT_BUNDLE],
    ],
    'tsc-m7',
  );
  bundleEntry(join(WORKSPACE, 'apps/loadweaver/cli/src/main.ts'), CLI_BUNDLE);
  // Host updates on an older node (F2): the M6 update driver and the apt-snapshot stand-in.
  bundleEntry(join(__dirname, '..', 'updates-agent.entry.ts'), UPDATES_AGENT_BUNDLE);
  bundleEntry(join(__dirname, '..', 'apt-source.entry.ts'), APT_SOURCE_BUNDLE);
  log(`M7 bundles built in ${Math.round((Date.now() - started) / 1000)}s`);
}
