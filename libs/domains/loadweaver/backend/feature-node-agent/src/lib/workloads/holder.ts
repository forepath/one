import { arch } from 'node:os';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The placeholder process of a restored replica's Docker container (3.10). Docker creates and starts the container
 * as usual (image, writable layer, mounts, network with the kept address, logs, health checks, stats), but runs this
 * instead of the image's entrypoint; the restored process tree then joins its network namespace, root filesystem
 * and cgroup through runc. It must exist on every host without depending on the image's contents, so it is a
 * minimal static ELF built here: an endless `pause()` (amd64) / `ppoll()` (arm64) loop — 129 / 148 bytes, no libc,
 * no allocations, no file access. As PID 1 of its namespace it ignores every signal but SIGKILL.
 */

const BASE = BigInt(0x400000);
const ELF_HEADER = 64;
const PROGRAM_HEADER = 56;

/** `mov eax, 34 (pause); syscall; jmp -9` */
const AMD64_CODE = Buffer.from([0xb8, 0x22, 0x00, 0x00, 0x00, 0x0f, 0x05, 0xeb, 0xf7]);
/** `mov x8, #73 (ppoll); mov x0..x3, #0; svc #0; b -24` */
const ARM64_CODE = Buffer.concat(
  [0xd2800928, 0xd2800000, 0xd2800001, 0xd2800002, 0xd2800003, 0xd4000001, 0x17fffffa].map((word) => {
    const b = Buffer.alloc(4);

    b.writeUInt32LE(word, 0);

    return b;
  }),
);

const MACHINES = { amd64: { machine: 62, code: AMD64_CODE }, arm64: { machine: 183, code: ARM64_CODE } } as const;

export type HolderArch = keyof typeof MACHINES;

/** The holder binary for an architecture: one `PT_LOAD` segment (R+X) with the code right after the headers. */
export function holderElf(target: HolderArch): Buffer {
  const { machine, code } = MACHINES[target];
  const offset = ELF_HEADER + PROGRAM_HEADER;
  const b = Buffer.alloc(offset + code.length);

  b.write('\x7fELF', 0, 'latin1');
  b[4] = 2; // ELFCLASS64
  b[5] = 1; // little endian
  b[6] = 1; // EV_CURRENT
  b.writeUInt16LE(2, 16); // ET_EXEC
  b.writeUInt16LE(machine, 18);
  b.writeUInt32LE(1, 20);
  b.writeBigUInt64LE(BASE + BigInt(offset), 24); // entry
  b.writeBigUInt64LE(BigInt(ELF_HEADER), 32); // program headers
  b.writeUInt16LE(ELF_HEADER, 52);
  b.writeUInt16LE(PROGRAM_HEADER, 54);
  b.writeUInt16LE(1, 56); // one program header
  b.writeUInt32LE(1, 64); // PT_LOAD
  b.writeUInt32LE(5, 68); // PF_R | PF_X
  b.writeBigUInt64LE(BigInt(0), 72); // file offset
  b.writeBigUInt64LE(BASE, 80); // vaddr
  b.writeBigUInt64LE(BASE, 88); // paddr
  b.writeBigUInt64LE(BigInt(b.length), 96); // file size
  b.writeBigUInt64LE(BigInt(b.length), 104); // memory size
  b.writeBigUInt64LE(BigInt(0x1000), 112); // alignment
  code.copy(b, offset);

  return b;
}

export function hostHolderArch(value: string = arch()): HolderArch {
  if (value === 'x64') return 'amd64';

  if (value === 'arm64') return 'arm64';

  throw new Error(`unsupported architecture ${value}`);
}

/** Where the holder lives on the host (not under `/run`, which is mounted `noexec`). */
export function holderPath(stateDir: string): string {
  return `${stateDir}/bin/lw-hold`;
}

/** Path of the holder inside the container (bind-mounted read-only). */
export const HOLDER_TARGET = '/.lw-hold';

/** Writes the holder binary if it is missing or differs (atomically, 0755). */
export async function ensureHolder(path: string, target: HolderArch = hostHolderArch()): Promise<string> {
  const binary = holderElf(target);
  const current = await readFile(path).catch(() => null);

  if (current?.equals(binary)) return path;

  await mkdir(dirname(path), { recursive: true, mode: 0o755 });

  const tmp = `${path}.${process.pid}.tmp`;

  await writeFile(tmp, binary, { mode: 0o755 });
  await chmod(tmp, 0o755);
  await rename(tmp, path);

  return path;
}
