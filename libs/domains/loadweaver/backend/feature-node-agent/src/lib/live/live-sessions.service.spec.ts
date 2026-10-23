import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { Duplex, PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeAgentMessage, type Envelope } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  LiveSessionsService,
  MAX_BUFFERED_BYTES,
  NODE_SHELL_LABEL,
  TERMINAL_IDLE_MS,
  TUNNEL_MAX_MS,
} from './live-sessions.service';

describe('live sessions: files and tunnels', () => {
  let dir: string;
  let server: Server;
  const sent: Envelope[] = [];
  const last = (channel: string) => {
    const decoded = decodeAgentMessage(sent.filter((e) => e.channel === channel).at(-1) as Envelope);

    return decoded.ok ? decoded.message : null;
  };
  const docker = (merged?: string, runtime = 'runc') =>
    ({
      listContainers: async ({ filters }: { filters: { label: string[] } }) =>
        filters.label[0].endsWith('=shop/site/web/0') ? [{ Id: 'c1' }] : [],
      getContainer: () => ({
        inspect: async () => ({
          HostConfig: { Runtime: runtime },
          GraphDriver: merged ? { Data: { MergedDir: merged } } : {},
          NetworkSettings: { Networks: { lw: { IPAddress: '127.0.0.1' } } },
        }),
      }),
    }) as never;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-live-'));
    await writeFile(join(dir, 'app.conf'), 'listen 80;');
    // An echo server standing in for the replica's port.
    server = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("works in the container's merged filesystem and in volumes mounted here", async () => {
    const live = new LiveSessionsService(docker(dir), {
      mountedPath: async (v: string) => (v === 'shop/site/data' ? dir : null),
    } as never);

    live.attach((e) => void sent.push(e));
    await live.file('f1', {
      op: 'read',
      target: { kind: 'replica', replica: 'shop/site/web/0' },
      path: '/app.conf',
      offset: 0,
      length: 100,
    });
    expect(Buffer.from((last('f1')?.payload as { data: string }).data, 'base64').toString()).toBe('listen 80;');

    await live.file('f2', { op: 'list', target: { kind: 'volume', volume: 'shop/site/data' }, path: '/' });
    expect((last('f2')?.payload as { entries: { name: string }[] }).entries.map((e) => e.name)).toEqual(['app.conf']);

    await live.file('f3', { op: 'list', target: { kind: 'volume', volume: 'shop/site/other' }, path: '/' });
    expect(last('f3')?.payload).toMatchObject({
      ok: false,
      error: { code: 'failed', message: expect.stringContaining('not mounted') },
    });

    const sandboxed = new LiveSessionsService(docker(undefined), { mountedPath: async () => null } as never);

    sandboxed.attach((e) => void sent.push(e));
    await sandboxed.file('f4', { op: 'list', target: { kind: 'replica', replica: 'shop/site/web/0' }, path: '/' });
    expect(last('f4')?.payload).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('no browsable filesystem') },
    });

    // gVisor replicas: the merged directory exists, but the sandbox's view of it differs; never browsed.
    const gvisor = new LiveSessionsService(docker(dir, 'runsc-systrap'), { mountedPath: async () => null } as never);

    gvisor.attach((e) => void sent.push(e));
    await gvisor.file('f5', { op: 'list', target: { kind: 'replica', replica: 'shop/site/web/0' }, path: '/' });
    expect(last('f5')?.payload).toMatchObject({
      ok: false,
      error: { message: 'sandboxed replicas are not browsable' },
    });
  });

  it('tunnels bytes to a replica port and closes both ways', async () => {
    const live = new LiveSessionsService(docker(dir), { mountedPath: async () => null } as never);

    live.attach((e) => void sent.push(e));
    await live.openTunnel('x1', 'shop/site/web/0', (server.address() as AddressInfo).port);
    live.tunnelData('x1', Buffer.from('ping').toString('base64'));

    for (let i = 0; i < 50 && !sent.some((e) => e.channel === 'x1'); i++) await new Promise((r) => setTimeout(r, 20));

    expect(Buffer.from((last('x1')?.payload as { data: string }).data, 'base64').toString()).toBe('ping');
    live.closeTunnel('x1');

    await live.openTunnel('x2', 'shop/site/web/0', 1);

    for (let i = 0; i < 50 && !sent.some((e) => e.channel === 'x2'); i++) await new Promise((r) => setTimeout(r, 20));

    expect(last('x2')).toMatchObject({ type: 'tunnelClose', payload: { reason: expect.any(String) } });
  });

  it('closes the sessions of a replica that migrated away with the reason (M7 W10b)', async () => {
    const live = new LiveSessionsService(docker(dir), { mountedPath: async () => null } as never);

    live.attach((e) => void sent.push(e));
    await live.openTunnel('m1', 'shop/site/web/0', (server.address() as AddressInfo).port);

    // A terminal in the replica (the exec itself is covered below): what the session keeps of it.
    const stream = new PassThrough();
    const terminals = (live as unknown as { terminals: Map<string, unknown> }).terminals;

    terminals.set('m2', {
      stream,
      replica: 'shop/site/web/0',
      pending: [],
      pendingBytes: 0,
      timer: null,
      resize: async () => undefined,
      exitCode: async () => null,
      cleanup: async () => undefined,
    });
    terminals.set('m3', {
      stream: new PassThrough(),
      replica: 'shop/site/api/0',
      pending: [],
      pendingBytes: 0,
      timer: null,
      resize: async () => undefined,
      exitCode: async () => null,
      cleanup: async () => undefined,
    });

    await live.closeReplicaSessions('shop/site/web/0', 'replica migrated to n2');

    expect(last('m1')).toMatchObject({ type: 'tunnelClose', payload: { reason: 'replica migrated to n2' } });
    expect(last('m2')).toMatchObject({ type: 'execExit', payload: { code: null, error: 'replica migrated to n2' } });
    expect(stream.destroyed).toBe(true);
    expect(terminals.has('m3')).toBe(true);
  });

  it('ends a tunnel after the longest TTL the control plane grants, and closes all tunnels when the stream drops', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

    try {
      const live = new LiveSessionsService(docker(dir), { mountedPath: async () => null } as never);
      const port = (server.address() as AddressInfo).port;
      const settle = async () => {
        for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      };

      live.attach((e) => void sent.push(e));
      await live.openTunnel('x3', 'shop/site/web/0', port);
      await live.openTunnel('x4', 'shop/site/web/0', port);
      jest.advanceTimersByTime(TUNNEL_MAX_MS);
      await settle();
      expect(last('x3')).toMatchObject({ type: 'tunnelClose', payload: { reason: 'the tunnel expired' } });

      await live.openTunnel('x5', 'shop/site/web/0', port);
      await live.closeAll();
      live.tunnelData('x5', Buffer.from('late').toString('base64'));
      await settle();
      expect(sent.filter((e) => e.channel === 'x5')).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('live sessions: terminals', () => {
  const sent: Envelope[] = [];
  const messages = (channel: string) =>
    sent
      .filter((e) => e.channel === channel)
      .map((e) => decodeAgentMessage(e))
      .flatMap((d) => (d.ok ? [d.message] : []));

  /** A shell's attached stream; `stalled` never acknowledges writes (a shell that doesn't read its input). */
  const shell = (stalled = false) => {
    const written: Buffer[] = [];
    const stream = new Duplex({
      read: () => undefined,
      write: (chunk: Buffer, _encoding, done) => {
        written.push(chunk);

        if (!stalled) done();
      },
    });

    return { stream, written };
  };

  const setup = (stream: Duplex, send: (e: Envelope) => boolean = (e) => (sent.push(e), true)) => {
    const removed: string[] = [];
    const execOptions: Record<string, unknown>[] = [];
    const docker = {
      // Docker's stdio framing without a TTY: 8-byte header (stream, 0, 0, 0, length), then the payload.
      modem: {
        demuxStream: (source: Duplex, stdout: Duplex, stderr: Duplex) => {
          let buffer = Buffer.alloc(0);

          source.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);

            while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32BE(4)) {
              const length = buffer.readUInt32BE(4);

              (buffer[0] === 2 ? stderr : stdout).write(buffer.subarray(8, 8 + length));
              buffer = buffer.subarray(8 + length);
            }
          });
        },
      },
      listContainers: async ({ filters }: { filters: { label: string[] } }) =>
        filters.label[0] === `${NODE_SHELL_LABEL}=true` ? [{ Id: 'helper-1' }] : [{ Id: 'c1' }],
      getContainer: (id: string) => ({
        inspect: async () => ({ Id: id, Config: { Labels: {} } }),
        exec: async (options: Record<string, unknown>) => (
          execOptions.push(options),
          {
            start: async () => stream,
            resize: async () => undefined,
            inspect: async () => ({ ExitCode: 0 }),
          }
        ),
        remove: async () => void removed.push(id),
      }),
    } as never;
    const commands: string[][] = [];
    const live = new LiveSessionsService(
      docker,
      { mountedPath: async () => null } as never,
      {
        run: async (_command: string, args: string[]) => (commands.push(args), { stdout: '', stderr: '' }),
      } as never,
    );

    live.attach(send);

    return { live, removed, commands, execOptions };
  };

  afterEach(() => jest.useRealTimers());

  it('runs machine exec without a TTY: binary stdout / stderr apart, stdin closable, exit code', async () => {
    const { stream, written } = shell();
    const { live, execOptions } = setup(stream);
    const frame = (kind: 1 | 2, data: Buffer) => {
      const header = Buffer.alloc(8);

      header[0] = kind;
      header.writeUInt32BE(data.length, 4);

      return Buffer.concat([header, data]);
    };
    const binary = Buffer.from([0, 1, 2, 0xff, 0xfe, 10, 13]);

    await live.openTerminal('m1', {
      target: { kind: 'replica', replica: 'shop/site/web/0' },
      command: ['cat'],
      cols: 80,
      rows: 24,
      tty: false,
      user: '1000:1000',
      workingDir: '/app',
      env: ['A=1'],
    });
    expect(execOptions.at(-1)).toMatchObject({ Tty: false, User: '1000:1000', WorkingDir: '/app', Env: ['A=1'] });

    live.input('m1', binary.toString('base64'), true);
    expect(Buffer.concat(written)).toEqual(binary);
    expect(stream.writableEnded).toBe(true);

    stream.push(frame(1, binary));
    stream.push(frame(2, Buffer.from('warn')));
    stream.push(null);

    for (let i = 0; i < 50 && messages('m1').at(-1)?.type !== 'execExit'; i++)
      await new Promise((r) => setTimeout(r, 10));

    const out = messages('m1') as { type: string; payload: { data?: string; stream?: string; code?: number } }[];

    expect(
      Buffer.from(out.find((m) => m.type === 'execOutput' && !m.payload.stream)?.payload.data ?? '', 'base64'),
    ).toEqual(binary);
    expect(out.find((m) => m.payload.stream === 'stderr')?.payload.data).toBe(Buffer.from('warn').toString('base64'));
    expect(out.at(-1)).toMatchObject({ type: 'execExit', payload: { code: 0 } });
  });

  it('removes leftover tunnel allowances and node-shell helpers at start', async () => {
    const { live, removed, commands } = setup(shell().stream);

    await live.reset();
    expect(commands).toEqual([['delete', 'table', 'inet', 'lw_live']]);
    expect(removed).toEqual(['helper-1']);
  });

  it('closes a terminal after 30 minutes without input, however much it prints', async () => {
    jest.useFakeTimers();

    const { stream, written } = shell();
    const { live } = setup(stream);

    await live.openTerminal('t1', { target: { kind: 'replica', replica: 'shop/site/web/0' }, cols: 80, rows: 24 });
    await jest.advanceTimersByTimeAsync(TERMINAL_IDLE_MS / 2);
    live.input('t1', Buffer.from('ls\n').toString('base64'));
    expect(Buffer.concat(written).toString()).toBe('ls\n');
    await jest.advanceTimersByTimeAsync(TERMINAL_IDLE_MS / 2);
    stream.push('output keeps coming');
    await jest.advanceTimersByTimeAsync(TERMINAL_IDLE_MS / 2 - 1000);
    expect(messages('t1').map((m) => m.type)).toEqual(['execOutput']);
    await jest.advanceTimersByTimeAsync(1000);
    expect(messages('t1').map((m) => m.type)).toEqual(['execOutput', 'execExit']);
  });

  it('pauses the shell while the control-plane stream is full and resumes when it drains', async () => {
    const { stream } = shell();
    let full = true;
    const { live } = setup(stream, (e) => (sent.push(e), !full));

    await live.openTerminal('t2', { target: { kind: 'replica', replica: 'shop/site/web/0' }, cols: 80, rows: 24 });
    stream.push(Buffer.alloc(64 * 1024, 'x'));
    await new Promise((r) => setImmediate(r));
    expect(stream.isPaused()).toBe(true);

    full = false;
    live.drained();
    expect(stream.isPaused()).toBe(false);
    await live.closeAll();
    expect(messages('t2').at(-1)?.type).toBe('execExit');
  });

  it('closes a terminal whose shell does not read its input before the buffer grows without bound', async () => {
    const { stream } = shell(true);
    const { live } = setup(stream);
    const chunk = Buffer.alloc(256 * 1024, 'y').toString('base64');

    await live.openTerminal('t3', { target: { kind: 'replica', replica: 'shop/site/web/0' }, cols: 80, rows: 24 });

    for (let i = 0; i <= MAX_BUFFERED_BYTES / (256 * 1024); i++) live.input('t3', chunk);

    for (let i = 0; i < 20 && !messages('t3').length; i++) await new Promise((r) => setImmediate(r));

    expect(messages('t3').at(-1)?.type).toBe('execExit');
    expect(stream.destroyed).toBe(true);
  });
});

describe('live sessions: microVM guests and VM consoles', () => {
  const sent: Envelope[] = [];
  const messages = (channel: string) =>
    sent
      .filter((e) => e.channel === channel)
      .map((e) => decodeAgentMessage(e))
      .flatMap((d) => (d.ok ? [d.message] : []));
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  const frame = (kind: 1 | 2, data: Buffer) => {
    const header = Buffer.alloc(8);

    header[0] = kind;
    header.writeUInt32BE(data.length, 4);

    return Buffer.concat([header, data]);
  };

  const setup = (labels: Record<string, string>, extra: Record<string, unknown> = {}) => {
    const execOptions: Record<string, unknown>[] = [];
    const streams: Duplex[] = [];
    const written: Buffer[] = [];
    const resized: unknown[] = [];
    const docker = {
      modem: {
        demuxStream: (source: Duplex, stdout: Duplex, stderr: Duplex) => {
          let buffer = Buffer.alloc(0);

          source.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);

            while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32BE(4)) {
              const length = buffer.readUInt32BE(4);

              (buffer[0] === 2 ? stderr : stdout).write(buffer.subarray(8, 8 + length));
              buffer = buffer.subarray(8 + length);
            }
          });
          source.on('end', () => (stdout.end(), stderr.end()));
        },
      },
      listContainers: async () => [{ Id: 'c1' }],
      getContainer: (id: string) => ({
        inspect: async () => ({ Id: id, Config: { Labels: labels }, State: { Running: true }, ...extra }),
        exec: async (options: Record<string, unknown>) => {
          execOptions.push(options);

          const stream = new Duplex({
            read: () => undefined,
            write: (chunk: Buffer, _encoding, done) => (written.push(chunk), done()),
          });

          streams.push(stream);

          return {
            start: async () => stream,
            resize: async (size: unknown) => void resized.push(size),
            inspect: async () => ({ ExitCode: 0 }),
          };
        },
      }),
    } as never;
    const live = new LiveSessionsService(docker, { mountedPath: async () => null } as never);

    live.attach((e) => void sent.push(e));

    return { live, execOptions, streams, written, resized };
  };
  const replica = { kind: 'replica' as const, replica: 'shop/site/web/0' };
  const vmReplica = { kind: 'replica' as const, replica: 'shop/lw-vm/db1/0' };

  it('runs terminals and machine exec in a microVM through vm-exec, with TTY and resize carried', async () => {
    const { live, execOptions, resized } = setup({ 'loadweaver.com/microvm': 'generic' });

    await live.openTerminal('g1', { target: replica, cols: 120, rows: 40 });
    expect(execOptions[0]).toMatchObject({
      Cmd: [
        '/usr/lib/agenstra-microvm/vm-exec',
        '--pass-env',
        'TERM',
        '--',
        '/bin/sh',
        '-c',
        expect.stringContaining('bash'),
      ],
      User: 'agenstra-vmm',
      Tty: true,
      Env: ['TERM=xterm-256color'],
    });
    expect(resized).toEqual([{ h: 40, w: 120 }]);
    await live.resize('g1', 100, 30);
    expect(resized.at(-1)).toEqual({ h: 30, w: 100 });

    await live.openTerminal('g2', {
      target: replica,
      command: ['cat'],
      cols: 80,
      rows: 24,
      tty: false,
      user: 'app',
      workingDir: '/srv',
      env: ['TOKEN=secret'],
    });
    expect(execOptions[1]).toMatchObject({
      Cmd: [
        '/usr/lib/agenstra-microvm/vm-exec',
        '--user',
        'app',
        '--workdir',
        '/srv',
        '--pass-env',
        'TOKEN',
        '--',
        'cat',
      ],
      User: 'agenstra-vmm',
      Tty: false,
      Env: ['TOKEN=secret'],
    });
    expect(execOptions[1]).not.toHaveProperty('WorkingDir');
    expect(JSON.stringify(execOptions[1]['Cmd'])).not.toContain('secret');
    await live.closeAll();
  });

  it('wraps launcher-labelled (Agenstra) images too, and refuses exec into full VMs', async () => {
    const bundled = setup({ 'io.agenstra.microvm.protocol': '1' });

    await bundled.live.openTerminal('b1', { target: replica, cols: 80, rows: 24 });
    expect((bundled.execOptions[0]['Cmd'] as string[])[0]).toBe('/usr/lib/agenstra-microvm/vm-exec');
    await bundled.live.closeAll();

    const vm = setup({ 'loadweaver.com/vm': 'db1' });

    await vm.live.openTerminal('v1', { target: vmReplica, cols: 80, rows: 24 });
    expect(vm.execOptions).toEqual([]);
    expect(messages('v1').at(-1)).toMatchObject({
      type: 'execExit',
      payload: { code: null, error: expect.stringContaining('serial console') },
    });
  });

  it("browses a generic microVM's guest root and refuses a VM's disks", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-guest-'));

    try {
      await writeFile(join(dir, 'os-release'), 'ID=alpine');

      const { live } = setup(
        { 'loadweaver.com/microvm': 'generic' },
        {
          HostConfig: { Runtime: 'runc' },
          GraphDriver: { Data: { MergedDir: '/nonexistent' } },
          Mounts: [{ Type: 'bind', Source: dir, Destination: '/guest' }],
        },
      );

      await live.file('gf1', { op: 'list', target: replica, path: '/' });
      expect(messages('gf1').at(-1)?.payload).toMatchObject({ ok: true, entries: [{ name: 'os-release' }] });

      const vm = setup({ 'loadweaver.com/vm': 'db1' }, { HostConfig: { Runtime: 'runc' } });

      await vm.live.file('gf2', { op: 'list', target: vmReplica, path: '/' });
      expect(messages('gf2').at(-1)?.payload).toMatchObject({
        ok: false,
        error: { message: 'virtual machine disks are not browsable' },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('opens the serial console of a VM: boot log first, input to the serial line, close ends the session only', async () => {
    const { live, execOptions, streams, written } = setup({ 'loadweaver.com/vm': 'db1' });

    // The collector runs from the VM's start (here: the first console).
    await live.openConsole('s1', { target: vmReplica, kind: 'serial', cols: 80, rows: 24 });
    await settle();
    expect(execOptions[0]).toEqual({
      Cmd: ['/usr/lib/agenstra-microvm/vm-console', 'serial'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    streams[0].push(frame(1, Buffer.from('Debian GNU/Linux 13 db1 ttyS0\r\n')));
    await settle();
    live.input('s1', Buffer.from('root\r').toString('base64'));
    expect(Buffer.concat(written).toString()).toBe('root\r');

    // A second viewer gets the boot log, and shares the line.
    await live.openConsole('s2', { target: vmReplica, kind: 'serial' });
    const replay = messages('s2').find((m) => m.type === 'execOutput')?.payload as { data: string };

    expect(Buffer.from(replay.data, 'base64').toString()).toBe('Debian GNU/Linux 13 db1 ttyS0\r\n');
    expect(execOptions).toHaveLength(1);

    await live.closeTerminal('s1');
    expect(messages('s1').at(-1)).toMatchObject({ type: 'execExit', payload: { code: null } });
    expect(streams[0].destroyed).toBe(false);
    await live.resize('s2', 100, 30);
    await live.closeAll();
    expect(messages('s2').at(-1)?.type).toBe('execExit');
    live.serial.stop();
  });

  it('relays VNC as raw binary RFB without a TTY and without vm-exec', async () => {
    const { live, execOptions, streams, written } = setup({ 'loadweaver.com/vm': 'db1' });
    const rfb = Buffer.from('RFB 003.008\n');

    await live.openConsole('n1', { target: vmReplica, kind: 'vnc' });
    expect(execOptions[0]).toEqual({
      Cmd: ['/usr/lib/agenstra-microvm/vm-console', 'vnc'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    streams[0].push(frame(1, rfb));
    live.input('n1', Buffer.from([0x03, 0x08, 0xff]).toString('base64'));
    expect(Buffer.concat(written)).toEqual(Buffer.from([0x03, 0x08, 0xff]));
    streams[0].push(null);

    for (let i = 0; i < 50 && messages('n1').at(-1)?.type !== 'execExit'; i++)
      await new Promise((r) => setTimeout(r, 10));

    const out = messages('n1') as { type: string; payload: { data?: string; code?: number } }[];

    expect(Buffer.from(out[0].payload.data ?? '', 'base64')).toEqual(rfb);
    expect(out.at(-1)).toMatchObject({ type: 'execExit', payload: { code: 0 } });
  });

  it('opens consoles for full VMs only', async () => {
    const { live, execOptions } = setup({ 'loadweaver.com/microvm': 'generic' });

    await live.openConsole('c1', { target: replica, kind: 'serial' });
    expect(execOptions).toEqual([]);
    expect(messages('c1').at(-1)).toMatchObject({
      type: 'execExit',
      payload: { code: null, error: 'consoles are only available for virtual machines' },
    });
  });
});
