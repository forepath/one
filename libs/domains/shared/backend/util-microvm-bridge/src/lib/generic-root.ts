import { MICROVM_GUEST_DNS } from './constants';
import { BootConfig } from './messages';

/**
 * Generic mode (`boot.rootDir`): the guest agent runs outside the image root (the initramfs root with the guest tools
 * on `/tools`) and starts the workload chrooted into the image root, in its own mount and PID namespaces, through the
 * static helper `lw-pty`. The image needs no node, python, tini or util-linux.
 */

/** Where the workload helper records the PID of the workload's namespace init (exec sessions join it). */
export const GENERIC_WORKLOAD_PID_FILE = '/run/lw-workload.pid';

/** Identity files (hosts, hostname, resolver) live on the agent's tmpfs and are bind-mounted into the image root. */
export const GENERIC_IDENTITY_DIR = '/run/lw-identity';

/** Mount points the agent prepares inside the image root before the workload starts (`/proc` is the helper's). */
export const GENERIC_ROOT_MOUNT_POINTS = ['/proc', '/sys', '/dev', '/run'] as const;

export type PathKind = 'directory' | 'file' | 'missing' | 'other';

/** The resolver configuration of the guest (`/etc/resolv.conf`). */
export function resolverContent(boot: Pick<BootConfig, 'dnsServers' | 'dnsSearch' | 'dnsOptions'>): string {
  const servers = boot.dnsServers?.length ? boot.dnsServers : [MICROVM_GUEST_DNS];
  const lines = servers.map((server) => `nameserver ${server}`);

  if (boot.dnsSearch) {
    lines.push(`search ${boot.dnsSearch}`);
  }

  if (boot.dnsOptions) {
    lines.push(`options ${boot.dnsOptions}`);
  }

  return `${lines.join('\n')}\n`;
}

/** Identity files of the container (name below `/etc` → content); only the ones the boot configuration carries. */
export function identityFiles(boot: BootConfig): [string, string][] {
  const files: [string, string][] = [['resolv.conf', resolverContent(boot)]];

  if (boot.hostname) {
    files.push(['hostname', `${boot.hostname}\n`]);
  }

  if (boot.hosts) {
    files.push(['hosts', boot.hosts]);
  }

  return files;
}

export class GenericRootError extends Error {}

/**
 * The commands (argv, run with the guest tools' busybox) that prepare the image root: kernel filesystems below
 * `<root>/{sys,dev}`, a tmpfs on `<root>/run` when the image's `/run` is empty, and the identity files bind-mounted
 * over `<root>/etc/{hosts,hostname,resolv.conf}` (never written to the image's writable layer).
 *
 * `pathKind` reports what a path is without following symlinks. A mount point that is a symlink (or anything but a
 * directory) is refused: mounting onto it would follow the link inside the agent's root, outside the image root.
 * Identity targets that are symlinks are skipped (the image keeps its own file), missing ones are created empty.
 */
export function genericRootCommands(options: {
  rootDir: string;
  busybox: string;
  identityDir: string;
  identity: [string, string][];
  pathKind: (path: string) => PathKind;
  runIsEmpty: boolean;
}): { commands: string[][]; createFiles: string[]; skipped: string[] } {
  const { rootDir, busybox, identityDir } = options;
  const commands: string[][] = [];
  const createFiles: string[] = [];
  const skipped: string[] = [];

  for (const mountPoint of GENERIC_ROOT_MOUNT_POINTS) {
    const kind = options.pathKind(`${rootDir}${mountPoint}`);

    if (kind === 'missing') {
      commands.push([busybox, 'mkdir', '-p', `${rootDir}${mountPoint}`]);
    } else if (kind !== 'directory') {
      throw new GenericRootError(`${mountPoint} of the image is not a directory`);
    }
  }

  const dev = `${rootDir}/dev`;

  commands.push(
    [busybox, 'mount', '-t', 'sysfs', '-o', 'nosuid,nodev,noexec,ro', 'sysfs', `${rootDir}/sys`],
    // A fresh tmpfs with the standard nodes (Docker semantics), not the guest's devtmpfs (shared superblock).
    [busybox, 'mount', '-t', 'tmpfs', '-o', 'nosuid,mode=0755,size=65536k', 'tmpfs', dev],
    [busybox, 'mkdir', '-p', `${dev}/pts`, `${dev}/shm`, `${dev}/mqueue`],
    ...(
      [
        ['null', 1, 3],
        ['zero', 1, 5],
        ['full', 1, 7],
        ['random', 1, 8],
        ['urandom', 1, 9],
        ['tty', 5, 0],
      ] as const
    ).map(([name, major, minor]) => [
      busybox,
      'mknod',
      '-m',
      '0666',
      `${dev}/${name}`,
      'c',
      String(major),
      String(minor),
    ]),
    [
      busybox,
      'mount',
      '-t',
      'devpts',
      '-o',
      'nosuid,noexec,newinstance,ptmxmode=0666,mode=0620,gid=5',
      'devpts',
      `${dev}/pts`,
    ],
    [busybox, 'ln', '-sf', 'pts/ptmx', `${dev}/ptmx`],
    [busybox, 'ln', '-sf', '/proc/self/fd', `${dev}/fd`],
    [busybox, 'ln', '-sf', '/proc/self/fd/0', `${dev}/stdin`],
    [busybox, 'ln', '-sf', '/proc/self/fd/1', `${dev}/stdout`],
    [busybox, 'ln', '-sf', '/proc/self/fd/2', `${dev}/stderr`],
    [busybox, 'mount', '-t', 'tmpfs', '-o', 'nosuid,nodev,mode=1777,size=65536k', 'tmpfs', `${dev}/shm`],
    [busybox, 'mount', '-t', 'mqueue', '-o', 'nosuid,nodev,noexec', 'mqueue', `${dev}/mqueue`],
  );

  if (options.runIsEmpty) {
    commands.push([busybox, 'mount', '-t', 'tmpfs', '-o', 'nosuid,nodev,mode=0755', 'tmpfs', `${rootDir}/run`]);
  }

  const etcKind = options.pathKind(`${rootDir}/etc`);

  for (const [name] of options.identity) {
    const target = `${rootDir}/etc/${name}`;
    const kind = etcKind === 'directory' ? options.pathKind(target) : 'other';

    if (kind === 'missing') {
      createFiles.push(target);
    } else if (kind !== 'file') {
      skipped.push(`/etc/${name}`);
      continue;
    }

    commands.push([busybox, 'mount', '--bind', `${identityDir}/${name}`, target]);
  }

  return { commands, createFiles, skipped };
}

export interface HelperUser {
  uid: number;
  gid: number;
  groups: number[];
}

/**
 * argv of the static helper `lw-pty` (see `apps/shared/microvm-launcher/src/lw-pty.c`):
 *  - workload: new mount + PID namespace, `/proc` of the new namespace, chroot, ids, working directory, exec;
 *  - exec: joins the workload's namespaces (PID file), chroot, ids, working directory, optionally on a PTY with the
 *    `pty-helper.py` control protocol on fd 3.
 */
export function lwPtyArgv(options: {
  lwPty: string;
  mode: 'workload' | 'exec';
  rootDir: string;
  pidFile: string;
  user: HelperUser;
  cwd: string;
  tty?: boolean;
  argv: string[];
}): string[] {
  const args = [options.lwPty];

  if (options.mode === 'workload') {
    args.push('--new-ns', '--pid-file', options.pidFile);
  } else {
    args.push('--join-pid-file', options.pidFile);
  }

  if (options.tty) {
    args.push('--pty');
  }

  args.push(
    '--root',
    options.rootDir,
    '--uid',
    String(options.user.uid),
    '--gid',
    String(options.user.gid),
    '--groups',
    options.user.groups.join(','),
    '--cwd',
    options.cwd || '/',
    '--',
    ...options.argv,
  );

  return args;
}
