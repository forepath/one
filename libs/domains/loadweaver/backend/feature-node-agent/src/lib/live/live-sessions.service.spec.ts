import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { Duplex } from 'node:stream';
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
