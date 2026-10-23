/**
 * Guest-side entry point (`bridge-guest.cjs`), started by the guest init inside the microVM. It talks to the
 * launcher over the virtio-serial port `io.agenstra.bridge` and exits with the workload's exit status.
 *
 *   bridge-guest.cjs                                bundled mode (the image root is the guest's root)
 *   bridge-guest.cjs --root /newroot [--tools /tools]   generic mode (started from the initramfs with the guest tools)
 */
import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';

import { MICROVM_BRIDGE_CHANNEL, MICROVM_GUEST_TOOLS_MOUNT } from '../lib/constants';
import { PathKind } from '../lib/generic-root';
import { GuestAgent } from '../lib/guest-agent';
import { PortAttachment } from '../lib/port-attachment';

/** How often the port is read again while no launcher daemon is connected (reads return end-of-file). */
const PORT_RETRY_MS = 200;

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

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pathKind(path: string): PathKind {
  try {
    const stat = lstatSync(path);

    return stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'other';
  }
}

function main(): void {
  const rootDir = argument('--root');
  const tools = argument('--tools') ?? MICROVM_GUEST_TOOLS_MOUNT;
  const generic = rootDir
    ? {
        rootDir,
        lwPtyPath: `${tools}/bin/lw-pty`,
        busyboxPath: `${tools}/bin/busybox`,
        runSync: (argv: string[]) => {
          execFileSync(argv[0], argv.slice(1), { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 });
        },
        pathKind,
        listDir: (path: string) => {
          try {
            return readdirSync(path);
          } catch {
            return [];
          }
        },
      }
    : {};
  const fd = openSync(findBridgePort(), 'r+');
  const output = createWriteStream('', { fd, autoClose: false });
  const agent = new GuestAgent({
    write: (bytes) => {
      output.write(bytes);
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, content) => writeFileSync(path, content),
    log,
    ...generic,
    onWorkloadExit: (code) => {
      agent.stop();
      output.end(() => process.exit(code));
      setTimeout(() => process.exit(code), 2000).unref();
    },
  });

  const attachment = new PortAttachment(() => agent.reattach());
  // The port reads end-of-file while no launcher daemon is connected (before it connected at boot; after a live
  // migration until the target's daemon connected): read again, re-attaching when an established session ended.
  const read = (): void => {
    const input = createReadStream('', { fd, autoClose: false, highWaterMark: 64 * 1024 });

    input.on('data', (chunk) => {
      attachment.data();
      agent.receive(chunk as Buffer);
    });
    input.on('error', (error) => log(`bridge port: ${error.message}`));
    input.on('end', () => {
      attachment.ended();
      setTimeout(read, PORT_RETRY_MS);
    });
  };

  read();
  agent.start();
}

try {
  main();
} catch (error) {
  log((error as Error).message);
  process.exit(1);
}
