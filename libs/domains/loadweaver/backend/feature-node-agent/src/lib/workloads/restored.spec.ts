import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CheckpointManager,
  externalNetnsOption,
  peerIndex,
  upperdirFromMountCommand,
  upperdirFromMountinfo,
} from './checkpoint.manager';
import { ensureHolder, HOLDER_TARGET, holderElf } from './holder';
import {
  healthCommand,
  holderOptions,
  hostCgroup,
  nextHealth,
  RESTORED_HEALTH_LABEL,
  RESTORED_LABEL,
  RESTORED_RUNTIME_LABEL,
  restoredConfig,
  restoredExecCommand,
  restoredExecProcess,
  restoredHealthCheck,
  restoredKind,
  restoreLockRules,
  sandboxRuntimeOf,
} from './restored-runtime';
import { scrubCommandArgs } from '../host/command-runner';
import { WorkloadManager } from './workload.manager';

describe('placeholder binary (3.10)', () => {
  it('is a minimal static ELF for amd64 and arm64', () => {
    for (const [arch, machine, size] of [
      ['amd64', 62, 129],
      ['arm64', 183, 148],
    ] as const) {
      const elf = holderElf(arch);

      expect(elf.subarray(0, 4).toString('latin1')).toBe('\x7fELF');
      expect(elf.readUInt16LE(16)).toBe(2); // ET_EXEC
      expect(elf.readUInt16LE(18)).toBe(machine);
      expect(elf.readBigUInt64LE(24)).toBe(BigInt(0x400000) + BigInt(120)); // entry right after the headers
      expect(elf.readUInt32LE(68)).toBe(5); // R + X, never writable
      expect(elf.length).toBe(size);
    }
  });

  it('is written once, atomically and executable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-holder-'));

    try {
      const path = await ensureHolder(join(dir, 'bin', 'lw-hold'), 'amd64');

      expect(await readFile(path)).toEqual(holderElf('amd64'));
      expect((await stat(path)).mode & 0o777).toBe(0o755);

      const mtime = (await stat(path)).mtimeMs;

      await ensureHolder(path, 'amd64');
      expect((await stat(path)).mtimeMs).toBe(mtime);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('checkpoint helpers', () => {
  it('finds the writable layer of a running task and of a created container', () => {
    const mountinfo = [
      '308 188 0:53 / / rw,relatime - overlay overlay rw,lowerdir=/var/lib/containerd/s/4/fs:/var/lib/containerd/s/1/fs,upperdir=/var/lib/containerd/s/5/fs,workdir=/var/lib/containerd/s/5/work',
      '310 308 0:62 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw',
    ].join('\n');

    expect(upperdirFromMountinfo(mountinfo)).toBe('/var/lib/containerd/s/5/fs');
    expect(upperdirFromMountinfo('310 308 0:62 / /proc rw - proc proc rw')).toBeNull();
    expect(
      upperdirFromMountCommand(
        'mount -t overlay overlay /x -o workdir=/c/3/work,upperdir=/c/3/fs,lowerdir=/c/2/fs:/c/1/fs,index=off',
      ),
    ).toBe('/c/3/fs');
    expect(peerIndex([{ ifname: 'lo' }, { ifname: 'eth0', link_index: 7 }])).toBe(7);
    expect(externalNetnsOption(4026532512)).toBe('external net[4026532512]:extRootNetNS');
  });

  it('dumps with the network namespace marked external, and restores the CRIU config afterwards', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-criu-'));
    const config = join(dir, 'criu', 'runc.conf');
    const seen: string[] = [];
    const commands = {
      run: jest.fn(async (_cmd: string, args: string[]) => {
        seen.push(await readFile(config, 'utf8'));
        expect(args).toEqual(expect.arrayContaining(['checkpoint', '--tcp-established', '--leave-running']));

        return { stdout: '', stderr: '' };
      }),
    };
    const manager = new CheckpointManager(commands as never, {} as never);
    const source = {
      dockerId: 'c1',
      restored: false,
      containerId: 'c1',
      runtime: 'runc' as const,
      binary: 'runc',
      globalArgs: ['--root', '/run/docker/runtime-runc/moby'],
      pid: process.pid,
      upperdir: null,
      restartPolicy: 'always',
      ociConfig: '/nonexistent/config.json',
    };

    process.env['LOADWEAVER_CRIU_RUNC_CONFIG'] = config;

    try {
      await manager.dump(source, join(dir, 'final'), { parent: '../p2', leaveRunning: true });
      expect(seen[0]).toMatch(/^external net\[\d+\]:extRootNetNS\n$/);
      await expect(stat(config)).rejects.toThrow();
      expect(commands.run.mock.calls[0][1]).toEqual(expect.arrayContaining(['--parent-path', '../p2']));

      // An administrator's own CRIU options stay.
      await writeFile(config, 'log-file /var/log/criu.log\n');
      await manager.dump(source, join(dir, 'final'), { parent: null, leaveRunning: true });
      expect(seen[1]).toMatch(/^log-file \/var\/log\/criu.log\nexternal net\[\d+\]/);
      expect(await readFile(config, 'utf8')).toBe('log-file /var/log/criu.log\n');
    } finally {
      delete process.env['LOADWEAVER_CRIU_RUNC_CONFIG'];
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('restored replicas (agent-managed runc)', () => {
  it('maps OCI cgroup paths to the host cgroup v2 tree', () => {
    expect(hostCgroup('system.slice:docker:abc')).toBe('system.slice/docker-abc.scope');
    expect(hostCgroup('machine-lw.slice:docker:abc')).toBe('machine.slice/machine-lw.slice/docker-abc.scope');
    expect(hostCgroup('/docker/abc')).toBe('docker/abc');
  });

  it('restores into the placeholder: its network namespace, a child of its cgroup, without the placeholder binary', () => {
    const config = restoredConfig(
      {
        root: { path: '/var/lib/docker/rootfs/overlayfs/abc' },
        mounts: [{ destination: '/proc' }, { destination: HOLDER_TARGET }, { destination: '/data', type: 'bind' }],
        linux: { namespaces: [{ type: 'mount' }, { type: 'network' }, { type: 'pid' }], cgroupsPath: 'x:y:z' },
      },
      4242,
      'system.slice/docker-abc.scope',
    );

    expect(config.mounts?.map((m) => m.destination)).toEqual(['/proc', '/data']);
    expect(config.linux?.namespaces).toEqual([
      { type: 'mount' },
      { type: 'network', path: '/proc/4242/ns/net' },
      { type: 'pid' },
    ]);
    expect(config.linux?.cgroupsPath).toBe('/system.slice/docker-abc.scope/app');
    expect(config.root?.path).toBe('/var/lib/docker/rootfs/overlayfs/abc');
  });

  it('creates the placeholder from the replica options: holder entrypoint, no restarts, runc, labelled', () => {
    const options = holderOptions(
      {
        name: 'lw-x',
        Image: 'img',
        Cmd: ['app'],
        Labels: { a: 'b' },
        HostConfig: { Runtime: 'runsc-systrap', RestartPolicy: { Name: 'always' }, Mounts: [] },
      },
      'm-1',
      '/var/lib/loadweaver/bin/lw-hold',
    );

    expect(options).toMatchObject({
      Entrypoint: [HOLDER_TARGET],
      Cmd: [],
      Labels: { a: 'b', [RESTORED_LABEL]: 'm-1' },
      HostConfig: {
        Runtime: 'runc',
        RestartPolicy: { Name: 'no' },
        Mounts: [{ Type: 'bind', Source: '/var/lib/loadweaver/bin/lw-hold', Target: HOLDER_TARGET, ReadOnly: true }],
      },
    });
    expect(restoredExecCommand('a'.repeat(64), ['sh'], true)).toEqual([
      'runc',
      '--root',
      '/run/loadweaver/runc',
      'exec',
      '-t',
      '--env',
      'TERM=xterm-256color',
      `lwr-${'a'.repeat(32)}`,
      'sh',
    ]);
  });
});

describe('restored gVisor replicas (3.10 stop-and-copy)', () => {
  const ms = 1_000_000;

  it('runs a gVisor replica on a runc placeholder without Docker health check, the agent runs it', () => {
    const options = holderOptions(
      {
        name: 'lw-x',
        Image: 'img',
        Healthcheck: { Test: ['CMD-SHELL', 'wget -q localhost'], Interval: 5_000 * ms, Retries: 2 },
        HostConfig: { Runtime: 'runsc-systrap', Mounts: [] },
      },
      'm-1',
      '/hold',
    );

    expect(options.HostConfig?.Runtime).toBe('runc');
    expect(options.Healthcheck).toEqual({ Test: ['NONE'] });
    expect(options.Labels?.[RESTORED_RUNTIME_LABEL]).toBe('runsc');
    expect(restoredKind(options.Labels)).toBe('runsc');
    expect(JSON.parse(options.Labels?.[RESTORED_HEALTH_LABEL] ?? '')).toEqual({
      test: ['CMD-SHELL', 'wget -q localhost'],
      intervalMs: 5_000,
      timeoutMs: 30_000,
      retries: 2,
      startPeriodMs: 0,
    });

    // The image's health check when the service has none; runc placeholders keep Docker's.
    const fromImage = holderOptions({ Image: 'img', HostConfig: { Runtime: 'runsc-systrap' } }, 'm', '/h', {
      Test: ['CMD', 'true'],
    });

    expect(JSON.parse(fromImage.Labels?.[RESTORED_HEALTH_LABEL] ?? '')).toMatchObject({ test: ['CMD', 'true'] });

    const runc = holderOptions({ Image: 'img', Healthcheck: { Test: ['CMD', 'true'] }, HostConfig: {} }, 'm', '/h');

    expect(runc.Healthcheck).toEqual({ Test: ['CMD', 'true'] });
    expect(runc.Labels?.[RESTORED_RUNTIME_LABEL]).toBe('runc');
    expect(runc.Labels?.[RESTORED_HEALTH_LABEL]).toBeUndefined();
    expect(restoredKind({})).toBe('runc');
  });

  it('keeps traffic away from the addresses while the placeholder holds them (no resets before the restore)', () => {
    const rules = restoreLockRules('lw_restore_abc', ['10.244.1.30', 'fd00::5', '10.244.1.30', 'bad; flush ruleset']);

    expect(rules).toContain('table inet lw_restore_abc {');
    expect(rules).toContain('type filter hook forward priority -400;');
    expect(rules).toContain('type filter hook output priority -400;');
    expect(rules?.match(/ip daddr \{ 10\.244\.1\.30 \} drop/g)).toHaveLength(2);
    expect(rules?.match(/ip6 daddr \{ fd00::5 \} drop/g)).toHaveLength(2);
    expect(rules).not.toContain('flush');
    expect(restoreLockRules('t', [])).toBeNull();
  });

  it('converts health checks with Docker defaults and semantics', () => {
    expect(restoredHealthCheck({ Test: ['NONE'] })).toBeNull();
    expect(restoredHealthCheck(undefined)).toBeNull();
    expect(healthCommand(['CMD', 'curl', '-f', 'x'])).toEqual(['curl', '-f', 'x']);
    expect(healthCommand(['CMD-SHELL', 'curl -f x || exit 1'])).toEqual(['/bin/sh', '-c', 'curl -f x || exit 1']);

    const check = { retries: 2, startPeriodMs: 10_000 };
    const starting = { status: 'starting' as const, failures: 0, startedAt: 0 };

    // Failures in the start period don't count; after it, `retries` failures in a row make it unhealthy.
    expect(nextHealth(starting, check, false, 5_000)).toEqual({ status: 'starting', failures: 0 });
    expect(nextHealth(starting, check, false, 11_000)).toEqual({ status: 'starting', failures: 1 });
    expect(nextHealth({ ...starting, failures: 1 }, check, false, 12_000)).toEqual({
      status: 'unhealthy',
      failures: 2,
    });
    expect(nextHealth({ status: 'unhealthy', failures: 5, startedAt: 0 }, check, true, 13_000)).toEqual({
      status: 'healthy',
      failures: 0,
    });
  });

  it('restores with the sandbox runtime Docker uses (gVisor network stack only)', () => {
    expect(
      sandboxRuntimeOf({
        'runsc-systrap': { path: '/usr/local/lib/agenstra-gvisor/x/runsc', runtimeArgs: ['--platform=systrap'] },
        'runsc-systrap-hostnet': { path: 'runsc', runtimeArgs: ['--platform=systrap', '--network=host'] },
      }),
    ).toEqual({ binary: '/usr/local/lib/agenstra-gvisor/x/runsc', args: ['--platform=systrap'] });
    expect(sandboxRuntimeOf({ 'runsc-systrap-hostnet': { runtimeArgs: ['--network=host'] } })).toBeNull();
    expect(sandboxRuntimeOf({ runc: { path: 'runc' } })).toBeNull();
    expect(restoredExecCommand('b'.repeat(64), ['sh'], true, 'runsc')).toEqual([
      'runsc',
      '--root',
      '/run/loadweaver/runsc',
      'exec',
      '--env',
      'TERM=xterm-256color',
      `lwr-${'b'.repeat(32)}`,
      'sh',
    ]);
  });
});

describe('WorkloadManager with live migration', () => {
  const spec = {
    id: 'shop/web/api/0',
    specHash: 'aaaaaaaaaaaaaaaa',
    kind: 'service',
    restart: 'always',
    image: 'img',
  };
  const container = (id: string, labels: Record<string, string>, state = 'running') => ({
    Id: id,
    State: state,
    Labels: {
      'loadweaver.com/managed': 'true',
      'loadweaver.com/workload': spec.id,
      'loadweaver.com/spec-hash': spec.specHash,
      ...labels,
    },
  });

  const setup = (containers: unknown[], runc: Map<string, boolean>, protectedReplicas: string[] = []) => {
    const calls: string[] = [];
    const docker = {
      listContainers: async () => containers,
      listNetworks: async () => [],
      getContainer: (id: string) => ({
        start: async () => void calls.push(`start ${id}`),
        stop: async () => void calls.push(`stop ${id}`),
        remove: async () => void calls.push(`remove ${id}`),
        inspect: async () => ({
          Id: id,
          Config: { Labels: (containers as { Id: string; Labels: object }[]).find((c) => c.Id === id)?.Labels },
          State: { Running: true },
        }),
      }),
    };
    const sessions = {
      protectedReplicas: () => new Set(protectedReplicas),
      activeReplicas: () => new Set(protectedReplicas),
      adopted: jest.fn(),
    };
    const restored = {
      list: async () => runc,
      stopReplica: jest.fn(async (id: string) => void calls.push(`stop-restored ${id}`)),
    };
    const scanner = { track: () => undefined };
    const manager = new WorkloadManager(
      docker as never,
      {} as never,
      scanner as never,
      sessions as never,
      restored as never,
    );

    jest
      .spyOn(manager as never, 'create' as never)
      .mockImplementation((async (s: { id: string }) => void calls.push(`create ${s.id}`)) as never);

    return { manager, calls, restored, sessions };
  };

  it('never touches a replica under a migration session (frozen source, restored target before cut-over)', async () => {
    const { manager, calls } = setup([container('c1', {}, 'paused')], new Map(), [spec.id]);

    // Desired (source, frozen): not restarted. Not desired (target before the cut-over): not removed.
    await manager.apply([spec as never], []);
    await manager.apply([], []);
    expect(calls).toEqual([]);
  });

  it('adopts a restored replica while its process runs, and returns it to Docker once it ended', async () => {
    const holder = container('h'.repeat(64), { [RESTORED_LABEL]: 'm-1' });
    const running = setup([holder], new Map([[`lwr-${'h'.repeat(32)}`, true]]));

    expect(await running.manager.apply([spec as never], [])).toBe(false);
    expect(running.calls).toEqual([]);
    expect(running.sessions.adopted).toHaveBeenCalledWith(spec.id);
    running.manager.onModuleDestroy();

    const ended = setup([holder], new Map([[`lwr-${'h'.repeat(32)}`, false]]));

    expect(await ended.manager.apply([spec as never], [])).toBe(true);
    expect(ended.calls).toEqual([`stop-restored ${'h'.repeat(64)}`, `create ${spec.id}`]);
  });
});

describe('machine exec in restored replicas without secrets on command lines (M6 review L2)', () => {
  const base = {
    terminal: false,
    user: { uid: 0, gid: 0, additionalGids: [10] },
    args: ['/lw-hold'],
    env: ['PATH=/usr/bin', 'MODE=prod'],
    cwd: '/app',
    capabilities: { bounding: ['CAP_CHOWN'] },
    apparmorProfile: 'docker-default',
  };

  it('puts command, user, working directory and environment into the process spec', () => {
    expect(
      restoredExecProcess(base, ['/bin/sh', '-c', 'echo $TOKEN'], {
        user: '1000:1001',
        workingDir: '/work',
        env: ['TOKEN=s3cret', 'MODE=dev'],
      }),
    ).toEqual({
      ...base,
      args: ['/bin/sh', '-c', 'echo $TOKEN'],
      env: ['PATH=/usr/bin', 'TOKEN=s3cret', 'MODE=dev'],
      cwd: '/work',
      user: { uid: 1000, gid: 1001, additionalGids: [10] },
    });
    expect(restoredExecProcess(base, ['id'], { user: '33' })).toMatchObject({ user: { uid: 33, gid: 0 }, cwd: '/app' });
    expect(() => restoredExecProcess(base, ['id'], { user: 'www-data' })).toThrow('numeric user');
  });

  it('passes only the process file on the command line', () => {
    const argv = restoredExecCommand('c'.repeat(64), ['secret-arg'], false, 'runc', undefined, {
      processFile: '/var/lib/loadweaver/restored-exec/x.json',
    });

    expect(argv).toEqual([
      'runc',
      '--root',
      '/run/loadweaver/runc',
      'exec',
      '--process',
      '/var/lib/loadweaver/restored-exec/x.json',
      `lwr-${'c'.repeat(32)}`,
    ]);
    expect(restoredExecCommand('c'.repeat(64), ['x'], false, 'runsc', undefined, { processFile: '/p.json' })).toContain(
      '--process',
    );
  });

  it('scrubs environment values from failed commands', () => {
    expect(scrubCommandArgs(['exec', '--env', 'TOKEN=s3cret', '-e', 'A=b=c', '--env=K=v', '-e', 'script'])).toEqual([
      'exec',
      '--env',
      'TOKEN=***',
      '-e',
      'A=***',
      '--env=K=***',
      '-e',
      'script',
    ]);
  });
});
