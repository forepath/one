/**
 * Guest-side entry point (`bridge-guest.cjs`), started by the guest init inside the microVM. It talks to the
 * launcher over the virtio-serial port `io.agenstra.bridge` and exits with the workload's exit status.
 */
import { createReadStream, createWriteStream, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

import { MICROVM_BRIDGE_CHANNEL } from '../lib/constants';
import { GuestAgent } from '../lib/guest-agent';

const log = (message: string): void => {
  process.stderr.write(`agenstra-microvm-guest: ${message}\n`);
};

function findBridgePort(): string {
  for (const port of readdirSync('/sys/class/virtio-ports')) {
    try {
      if (readFileSync(`/sys/class/virtio-ports/${port}/name`, 'utf8').trim() === MICROVM_BRIDGE_CHANNEL) {
        return `/dev/${port}`;
      }
    } catch {
      // not a named port
    }
  }

  throw new Error(`virtio-serial port ${MICROVM_BRIDGE_CHANNEL} not found`);
}

function main(): void {
  const fd = openSync(findBridgePort(), 'r+');
  const output = createWriteStream('', { fd, autoClose: false });
  const input = createReadStream('', { fd, autoClose: false, highWaterMark: 64 * 1024 });
  const agent = new GuestAgent({
    write: (bytes) => {
      output.write(bytes);
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, content) => writeFileSync(path, content),
    log,
    onWorkloadExit: (code) => {
      agent.stop();
      output.end(() => process.exit(code));
      setTimeout(() => process.exit(code), 2000).unref();
    },
  });

  input.on('data', (chunk) => agent.receive(chunk as Buffer));
  input.on('error', (error) => log(`bridge port: ${error.message}`));
  agent.start();
}

try {
  main();
} catch (error) {
  log((error as Error).message);
  process.exit(1);
}
