import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { readGenericBootSnapshot, parseGenericBootProcess, reachableNameservers } from './boot-snapshot';
import { CONTROL_STREAM, HostDaemon } from './host-daemon';
import { Frame, FrameDecoder, FrameType, decodeJson, encodeFrame, encodeJson } from './frame';
import { GENERIC_IDENTITY_DIR, PathKind, genericRootCommands, identityFiles, lwPtyArgv } from './generic-root';
import { GuestAgent } from './guest-agent';
import { computeGuestStats, parseCpuSample } from './guest-stats';
import { supplementaryGroups } from './guest-users';
import { BootConfig, GuestStats, normalizeStopSignal, parseBootConfig, parseGuestStats } from './messages';

const PASSWD = 'root:x:0:0:root:/root:/bin/sh\napp:x:1000:1000::/home/app:/bin/sh\n';
const GROUP = 'root:x:0:\napp:x:1000:\naudio:x:29:app,other\nvideo:x:44:other\n';

const MEMINFO = 'MemTotal:        2048000 kB\nMemFree:          100000 kB\nMemAvailable:    1024000 kB\n';
const STAT_1 = 'cpu  100 0 100 700 0 0 0 100 0 0\ncpu0 100 0 100 700 0 0 0 100 0 0\n';
const STAT_2 = 'cpu  200 0 200 1400 0 0 0 200 0 0\n';

function boot(overrides: Partial<BootConfig> = {}): BootConfig {
  return parseBootConfig({
    argv: ['/app/server', '--port', '8080'],
    env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'MODE=prod'],
    workdir: '/app',
    user: 'app',
    hostname: 'web-0',
    hosts: '127.0.0.1 localhost\n10.1.0.5 web-0\n',
    dnsSearch: 'shop.lw',
    dnsOptions: 'ndots:2',
    dnsServers: ['10.1.0.1'],
    loopbackPorts: [],
    rootDir: '/newroot',
    stopSignal: 'SIGQUIT',
    ...overrides,
  });
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdio: unknown[];
  readonly pid = 4242;
  exitCode: number | null = null;

  constructor() {
    super();
    this.stdio = [this.stdin, this.stdout, this.stderr, new PassThrough()];
  }
}

interface GuestHarness {
  agent: GuestAgent;
  frames: Frame[];
  spawned: { command: string; args: string[]; cwd: unknown; env: NodeJS.ProcessEnv }[];
  commands: string[][];
  writes: Record<string, string>;
  logs: string[];
  exits: number[];
  children: FakeChild[];
  send: (type: FrameType, stream: number, value: unknown) => void;
}

function guestHarness(options: { rootDir?: string; pathKind?: (path: string) => PathKind; runEmpty?: boolean } = {}) {
  const decoder = new FrameDecoder();
  const harness: GuestHarness = {
    agent: undefined as unknown as GuestAgent,
    frames: [],
    spawned: [],
    commands: [],
    writes: {},
    logs: [],
    exits: [],
    children: [],
    send: (type, stream, value) => harness.agent.receive(encodeFrame(type, stream, encodeJson(value))),
  };
  const files: Record<string, string> = {
    '/newroot/etc/passwd': PASSWD,
    '/newroot/etc/group': GROUP,
    '/proc/meminfo': MEMINFO,
    '/proc/stat': STAT_1,
    '/proc/loadavg': '0.42 0.30 0.10 1/80 123\n',
  };

  harness.agent = new GuestAgent({
    write: (bytes) => harness.frames.push(...decoder.push(bytes)),
    readFile: (path) => {
      if (files[path] === undefined) {
        throw new Error(`ENOENT ${path}`);
      }

      return files[path];
    },
    writeFile: (path, content) => {
      harness.writes[path] = content;
    },
    spawn: (command, args, spawnOptions) => {
      const child = new FakeChild();

      harness.children.push(child);
      harness.spawned.push({ command, args, cwd: spawnOptions.cwd, env: spawnOptions.env as NodeJS.ProcessEnv });

      return child as unknown as ChildProcess;
    },
    ids: { uid: 0, gid: 0 },
    log: (message) => harness.logs.push(message),
    onWorkloadExit: (code) => harness.exits.push(code),
    rootDir: options.rootDir,
    lwPtyPath: '/tools/bin/lw-pty',
    busyboxPath: '/tools/bin/busybox',
    runSync: (argv) => harness.commands.push(argv),
    pathKind:
      options.pathKind ??
      ((path) =>
        path.endsWith('/etc/hostname') ? 'missing' : path.startsWith('/newroot/etc/') ? 'file' : 'directory'),
    listDir: () => (options.runEmpty === false ? ['lock'] : []),
  });

  return harness;
}

function controlMessages(frames: Frame[], type: FrameType): unknown[] {
  return frames
    .filter((frame) => frame.stream === CONTROL_STREAM && frame.type === type)
    .map((frame) => decodeJson(frame.payload));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('generic boot configuration (protocol 1, additive fields)', () => {
  it('keeps bundled boot configurations unchanged', () => {
    const parsed = parseBootConfig({ argv: ['/entry'], env: [], workdir: '/', user: '' });

    expect(parsed).not.toHaveProperty('rootDir');
    expect(parsed).not.toHaveProperty('stopSignal');
    expect(parsed).not.toHaveProperty('dnsServers');
    expect(parsed).not.toHaveProperty('statsIntervalSeconds');
  });

  it('validates the generic fields', () => {
    expect(boot()).toMatchObject({ rootDir: '/newroot', stopSignal: 'SIGQUIT', dnsServers: ['10.1.0.1'] });
    expect(() => boot({ rootDir: '/' })).toThrow('Invalid root directory');
    expect(() => boot({ rootDir: '/newroot/../etc' })).toThrow('Invalid root directory');
    expect(() => boot({ rootDir: 'relative' })).toThrow('Invalid root directory');
    expect(() => boot({ stopSignal: 'SIGSEGV' as never })).toThrow('Invalid stop signal');
    expect(() => boot({ dnsServers: ['dns.example'] })).toThrow('Invalid dnsServers');
    expect(() => boot({ statsIntervalSeconds: -1 })).toThrow('Invalid statsIntervalSeconds');
    expect(boot({ statsIntervalSeconds: 0 })).not.toHaveProperty('statsIntervalSeconds');
  });

  it('normalises Docker stop signals', () => {
    expect(normalizeStopSignal('TERM')).toBe('SIGTERM');
    expect(normalizeStopSignal('sigquit')).toBe('SIGQUIT');
    expect(normalizeStopSignal('15')).toBe('SIGTERM');
    expect(normalizeStopSignal('SIGRTMIN+3')).toBeNull();
  });

  it('builds the boot configuration from the node agent boot process file', () => {
    const process = parseGenericBootProcess({
      entrypoint: ['/docker-entrypoint.sh'],
      cmd: ['nginx', '-g', 'daemon off;'],
      env: ['PATH=/usr/sbin:/usr/bin', 'NGINX_VERSION=1.29'],
      user: '101:101',
      workingDir: '',
      stopSignal: 'QUIT',
    });
    const config = readGenericBootSnapshot({
      process,
      hostname: 'web-0',
      hosts: '127.0.0.1 localhost\n',
      resolvConf: 'nameserver 127.0.0.11\nnameserver 10.1.0.1\nnameserver fd00::1\nsearch shop.lw\noptions ndots:2\n',
    });

    expect(config).toEqual({
      argv: ['/docker-entrypoint.sh', 'nginx', '-g', 'daemon off;'],
      env: ['PATH=/usr/sbin:/usr/bin', 'NGINX_VERSION=1.29'],
      workdir: '/',
      user: '101:101',
      hostname: 'web-0',
      hosts: '127.0.0.1 localhost\n',
      dnsSearch: 'shop.lw',
      dnsOptions: 'ndots:2',
      dnsServers: ['10.1.0.1', 'fd00::1'],
      loopbackPorts: [],
      rootDir: '/newroot',
      stopSignal: 'SIGQUIT',
    });
    expect(() => parseGenericBootProcess({ entrypoint: 'sh' })).toThrow('entrypoint');
    expect(() => parseGenericBootProcess({ stopSignal: 'SIGSTOP' })).toThrow('stopSignal');
    expect(() =>
      readGenericBootSnapshot({ process: parseGenericBootProcess({}), hostname: '', hosts: '', resolvConf: '' }),
    ).toThrow('argv');
    expect(reachableNameservers('nameserver ::1\nnameserver 127.0.0.53\n')).toEqual([]);
  });
});

describe('generic image root preparation', () => {
  it('mounts kernel filesystems below the image root and binds the identity files', () => {
    const plan = genericRootCommands({
      rootDir: '/newroot',
      busybox: '/tools/bin/busybox',
      identityDir: GENERIC_IDENTITY_DIR,
      identity: identityFiles(boot()),
      pathKind: (path) =>
        path === '/newroot/run'
          ? 'missing'
          : path === '/newroot/etc/hosts'
            ? 'other'
            : path === '/newroot/etc/hostname'
              ? 'missing'
              : path.startsWith('/newroot/etc/')
                ? 'file'
                : 'directory',
      runIsEmpty: true,
    });

    expect(plan.commands).toContainEqual(['/tools/bin/busybox', 'mkdir', '-p', '/newroot/run']);
    expect(plan.commands).toContainEqual([
      '/tools/bin/busybox',
      'mount',
      '-t',
      'sysfs',
      '-o',
      'nosuid,nodev,noexec,ro',
      'sysfs',
      '/newroot/sys',
    ]);
    // /dev is a fresh tmpfs: the guest's devtmpfs would expose the bridge's virtio-serial port to the workload.
    expect(plan.commands.some((command) => command.includes('devtmpfs'))).toBe(false);
    expect(plan.commands).toContainEqual([
      '/tools/bin/busybox',
      'mknod',
      '-m',
      '0666',
      '/newroot/dev/null',
      'c',
      '1',
      '3',
    ]);
    expect(plan.commands).toContainEqual([
      '/tools/bin/busybox',
      'mount',
      '-t',
      'tmpfs',
      '-o',
      'nosuid,nodev,mode=0755',
      'tmpfs',
      '/newroot/run',
    ]);
    expect(plan.commands).toContainEqual([
      '/tools/bin/busybox',
      'mount',
      '--bind',
      '/run/lw-identity/resolv.conf',
      '/newroot/etc/resolv.conf',
    ]);
    expect(plan.createFiles).toEqual(['/newroot/etc/hostname']);
    expect(plan.skipped).toEqual(['/etc/hosts']);
    expect(plan.commands.some((command) => command.includes('/newroot/etc/hosts'))).toBe(false);
  });

  it('refuses mount points that are symlinks (they would resolve outside the image root)', () => {
    expect(() =>
      genericRootCommands({
        rootDir: '/newroot',
        busybox: '/tools/bin/busybox',
        identityDir: GENERIC_IDENTITY_DIR,
        identity: [],
        pathKind: (path) => (path === '/newroot/dev' ? 'other' : 'directory'),
        runIsEmpty: false,
      }),
    ).toThrow('/dev of the image is not a directory');
  });

  it('renders the workload and exec helper command lines', () => {
    const user = { uid: 1000, gid: 1000, groups: [1000, 29] };

    expect(
      lwPtyArgv({
        lwPty: '/tools/bin/lw-pty',
        mode: 'workload',
        rootDir: '/newroot',
        pidFile: '/run/w.pid',
        user,
        cwd: '/app',
        argv: ['/app/server'],
      }),
    ).toEqual([
      '/tools/bin/lw-pty',
      '--new-ns',
      '--pid-file',
      '/run/w.pid',
      '--root',
      '/newroot',
      '--uid',
      '1000',
      '--gid',
      '1000',
      '--groups',
      '1000,29',
      '--cwd',
      '/app',
      '--',
      '/app/server',
    ]);
    expect(
      lwPtyArgv({
        lwPty: 'lw-pty',
        mode: 'exec',
        rootDir: '/r',
        pidFile: '/p',
        user,
        cwd: '',
        tty: true,
        argv: ['sh'],
      }).slice(0, 5),
    ).toEqual(['lw-pty', '--join-pid-file', '/p', '--pty', '--root']);
    expect(supplementaryGroups({ uid: 1000, gid: 1000, name: 'app', home: '/' }, GROUP)).toEqual([1000, 29]);
    expect(supplementaryGroups({ uid: 5, gid: 0, name: null, home: '/' }, GROUP)).toEqual([]);
  });
});

describe('generic guest agent', () => {
  it('prepares the image root and starts the workload chrooted through lw-pty', () => {
    const guest = guestHarness({ rootDir: '/newroot' });

    guest.send(FrameType.Boot, CONTROL_STREAM, boot());

    expect(guest.writes['/run/lw-identity/resolv.conf']).toBe('nameserver 10.1.0.1\nsearch shop.lw\noptions ndots:2\n');
    expect(guest.writes['/run/lw-identity/hosts']).toBe('127.0.0.1 localhost\n10.1.0.5 web-0\n');
    expect(guest.writes['/proc/sys/kernel/hostname']).toBe('web-0');
    expect(guest.writes['/newroot/etc/hostname']).toBe('');
    expect(guest.writes['/etc/resolv.conf']).toBeUndefined();
    expect(guest.commands[0]).toEqual(['/tools/bin/busybox', 'mkdir', '-p', '/run/lw-identity']);
    expect(guest.spawned).toHaveLength(1);
    expect(guest.spawned[0].command).toBe('/tools/bin/lw-pty');
    expect(guest.spawned[0].args).toEqual([
      '--new-ns',
      '--pid-file',
      '/run/lw-workload.pid',
      '--root',
      '/newroot',
      '--uid',
      '1000',
      '--gid',
      '1000',
      '--groups',
      '1000,29',
      '--cwd',
      '/app',
      '--',
      '/app/server',
      '--port',
      '8080',
    ]);
    expect(guest.spawned[0].cwd).toBe('/');
    expect(guest.spawned[0].env).toMatchObject({ MODE: 'prod', HOME: '/home/app' });
    expect(guest.frames.filter((frame) => frame.type === FrameType.Ready)).toHaveLength(1);
  });

  it("stops the workload with the image's stop signal", () => {
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const guest = guestHarness({ rootDir: '/newroot' });

    guest.send(FrameType.Boot, CONTROL_STREAM, boot());
    guest.send(FrameType.Stop, CONTROL_STREAM, { graceSeconds: 0 });

    expect(kill).toHaveBeenCalledWith(-4242, 'SIGQUIT');
  });

  it('runs exec sessions in the workload namespaces as the requested user', () => {
    const guest = guestHarness({ rootDir: '/newroot' });

    guest.send(FrameType.Boot, CONTROL_STREAM, boot());
    guest.send(FrameType.OpenExec, 7, {
      argv: ['sh'],
      env: ['TERM=xterm'],
      user: 'root',
      workdir: '',
      tty: true,
      cols: 120,
      rows: 40,
    });

    const exec = guest.spawned[1];

    expect(exec.command).toBe('/tools/bin/lw-pty');
    expect(exec.args).toEqual([
      '--join-pid-file',
      '/run/lw-workload.pid',
      '--pty',
      '--root',
      '/newroot',
      '--uid',
      '0',
      '--gid',
      '0',
      '--groups',
      '0',
      '--cwd',
      '/app',
      '--',
      'sh',
    ]);
    expect(exec.env).toMatchObject({ AGENSTRA_PTY_COLS: '120', AGENSTRA_PTY_ROWS: '40', TERM: 'xterm', HOME: '/root' });
  });

  it('refuses a boot configuration for another root and reports a launch failure', () => {
    const bundled = guestHarness();

    bundled.send(FrameType.Boot, CONTROL_STREAM, boot());

    expect(bundled.spawned).toHaveLength(0);
    expect(controlMessages(bundled.frames, FrameType.WorkloadExit)).toEqual([{ code: 125 }]);

    const generic = guestHarness({ rootDir: '/newroot' });

    generic.send(FrameType.Boot, CONTROL_STREAM, boot({ rootDir: undefined }));

    expect(generic.spawned).toHaveLength(0);
    expect(controlMessages(generic.frames, FrameType.WorkloadExit)).toEqual([{ code: 125 }]);
  });

  it('does not start the workload when the image root cannot be prepared', () => {
    const guest = guestHarness({
      rootDir: '/newroot',
      pathKind: (path) => (path === '/newroot/proc' ? 'other' : 'directory'),
    });

    guest.send(FrameType.Boot, CONTROL_STREAM, boot());

    expect(guest.spawned).toHaveLength(0);
    expect(guest.logs).toContain('/proc of the image is not a directory');
    expect(controlMessages(guest.frames, FrameType.WorkloadExit)).toEqual([{ code: 125 }]);
  });

  it('reports STATS only when the boot configuration asks for them', () => {
    const quiet = guestHarness({ rootDir: '/newroot' });

    quiet.send(FrameType.Boot, CONTROL_STREAM, boot());
    expect(controlMessages(quiet.frames, FrameType.Stats)).toHaveLength(0);

    const reporting = guestHarness({ rootDir: '/newroot' });

    reporting.send(FrameType.Boot, CONTROL_STREAM, boot({ statsIntervalSeconds: 10 }));
    expect(controlMessages(reporting.frames, FrameType.Stats)).toEqual([
      { memTotal: 2048000 * 1024, memAvailable: 1024000 * 1024, cpuSteal: 0, load1: 0.42 },
    ]);
    reporting.agent.stop();
  });
});

describe('guest statistics', () => {
  it('computes memory, steal ratio and load from /proc', () => {
    const first = computeGuestStats({ meminfo: MEMINFO, stat: STAT_1, loadavg: '1.5 1 1 1/1 1' }, null);
    const second = computeGuestStats({ meminfo: MEMINFO, stat: STAT_2, loadavg: '1.5 1 1 1/1 1' }, first.sample);

    expect(first.stats.cpuSteal).toBe(0);
    expect(second.stats).toEqual({ memTotal: 2097152000, memAvailable: 1048576000, cpuSteal: 0.1, load1: 1.5 });
    expect(parseCpuSample('cpu0 1 2 3\n')).toBeNull();
  });

  it('validates STATS messages on the launcher side', () => {
    expect(parseGuestStats({ memTotal: 10, memAvailable: 20, cpuSteal: 2, load1: -1 })).toEqual({
      memTotal: 10,
      memAvailable: 10,
      cpuSteal: 1,
      load1: 0,
    });
    expect(() => parseGuestStats({ memTotal: 'x' })).toThrow('memTotal');
  });

  it('hands STATS from the guest to the launcher daemon', () => {
    const received: GuestStats[] = [];
    const host = new HostDaemon({
      boot: boot(),
      forwardPorts: [],
      readyTimeoutMs: 1000,
      stopGraceSeconds: 1,
      stdout: (_data, done) => done(),
      stderr: (_data, done) => done(),
      log: () => undefined,
      onStats: (stats) => received.push(stats),
    });
    const transport = new PassThrough();

    host.attachGuest(transport);
    transport.emit(
      'data',
      encodeFrame(
        FrameType.Stats,
        CONTROL_STREAM,
        encodeJson({ memTotal: 100, memAvailable: 40, cpuSteal: 0.25, load1: 0.5 }),
      ),
    );

    expect(received).toEqual([{ memTotal: 100, memAvailable: 40, cpuSteal: 0.25, load1: 0.5 }]);
  });
});
