/**
 * VM lab driver for the node agent's volume manager (bundled with esbuild by the VM lab global setup and copied
 * into the VMs). Runs the real `VolumeManager` / `VolumePluginServer` / `CommandRunner` on a real kernel; only the
 * secret broker is replaced by a key file (the control plane isn't part of this lab).
 *
 * usage: node volume-driver.js <apply|mount|unmount|serve> <node> <assignments.json> [dockerName]
 *   apply    converge LVM thin + LUKS + DRBD for the assignments
 *   mount    apply, then promote + mount `dockerName` (prints the mountpoint)
 *   unmount  apply, then unmount + demote `dockerName`
 *   serve    apply, then serve the Docker volume plugin socket until SIGTERM
 * env: LW_LAB_KEY_FILE (LUKS key, default /etc/loadweaver/lab-volume.key)
 */
import { readFile } from 'node:fs/promises';

import { volumeAssignmentSchema } from '@forepath/loadweaver/shared/util-agent-protocol';

import { CommandRunner } from '../../lib/host/command-runner';
import { VolumePluginServer } from '../../lib/volumes/volume-plugin.server';
import { VolumeManager } from '../../lib/volumes/volume.manager';
import type { SecretBroker } from '../../lib/workloads/secret-broker.service';

async function main(): Promise<void> {
  const [mode, node, file, dockerName] = process.argv.slice(2);

  if (!mode || !node || !file) throw new Error('usage: <apply|mount|unmount|serve> <node> <assignments.json>');

  const assignments = volumeAssignmentSchema.array().parse(JSON.parse(await readFile(file, 'utf8')));
  const keyFile = process.env['LW_LAB_KEY_FILE'] || '/etc/loadweaver/lab-volume.key';
  const secrets = { fetch: async () => await readFile(keyFile) } as unknown as SecretBroker;
  const manager = new VolumeManager(new CommandRunner(), secrets);
  const changed = await manager.apply(node, assignments);

  switch (mode) {
    case 'apply':
      process.stdout.write(`${JSON.stringify({ changed })}\n`);
      break;
    case 'mount':
      process.stdout.write(`${JSON.stringify({ changed, mountpoint: await manager.mount(String(dockerName)) })}\n`);
      break;
    case 'unmount':
      await manager.unmount(String(dockerName));
      process.stdout.write(`${JSON.stringify({ changed })}\n`);
      break;
    case 'serve': {
      const plugin = new VolumePluginServer(manager);

      await plugin.start();
      process.stdout.write('ready\n');
      await new Promise<void>((resolve) => process.once('SIGTERM', () => resolve()));
      plugin.onModuleDestroy();
      break;
    }
    default:
      throw new Error(`unknown mode ${mode}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
