import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

import { ExecClientIo, runExecClient } from './exec-client';
import { GuestAgent } from './guest-agent';
import { HostDaemon } from './host-daemon';
import { BootConfig } from './messages';

const PTY_HELPER = resolve(
  __dirname,
  '../../../../../../../apps/shared/microvm-launcher/rootfs/usr/lib/agenstra-microvm/pty-helper.py',
);
const hasPython = ((): boolean => {
  try {
    execFileSync('python3', ['-c', 'import pty']);

    return true;
  } catch {
    return false;
  }
})();

interface Harness {
  host: HostDaemon;
  guest: GuestAgent;
  stdout: Buffer[];
  identity: Record<string, string>;
  exitCodes: number[];
  exec: (
    argv: string[],
    options?: { stdin?: string; env?: NodeJS.ProcessEnv; passEnv?: string[] },
  ) => Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>;
  close: () => Promise<void>;
}

const sockets: net.Socket[] = [];
const servers: net.Server[] = [];
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'microvm-bridge-'));
});

afterEach(() => {
  sockets.splice(0).forEach((socket) => socket.destroy());
  servers.splice(0).forEach((server) => server.close());
  rmSync(directory, { recursive: true, force: true });
});

async function listen(server: net.Server, path?: string): Promise<number> {
  servers.push(server);

  await new Promise<void>((done) => (path ? server.listen(path, done) : server.listen(0, '127.0.0.1', done)));

  return path ? 0 : (server.address() as net.AddressInfo).port;
}

async function connectPair(path: string): Promise<[net.Socket, net.Socket]> {
  let accepted: (socket: net.Socket) => void = () => undefined;
  const acceptedSocket = new Promise<net.Socket>((done) => (accepted = done));

  await listen(
    net.createServer((socket) => accepted(socket)),
    path,
  );

  const client = net.connect(path);

  await new Promise((done) => client.once('connect', done));

  const server = await acceptedSocket;

  sockets.push(client, server);

  return [client, server];
}

async function startHarness(boot: Partial<BootConfig> = {}, relayTarget?: string): Promise<Harness> {
  const [hostEnd, guestEnd] = await connectPair(join(directory, 'bridge.sock'));
  const stdout: Buffer[] = [];
  const identity: Record<string, string> = {};
  const exitCodes: number[] = [];
  const host = new HostDaemon({
    boot: {
      argv: ['sh', '-c', 'echo workload-started; exec sleep 30'],
      env: ['PATH=/usr/bin:/bin', 'GREETING=hello'],
      workdir: '/',
      user: '',
      hostname: 'worker-1',
      hosts: '127.0.0.1 localhost\n',
      dnsSearch: 'lab',
      dnsOptions: '',
      loopbackPorts: [],
      ...boot,
    },
    forwardPorts: [],
    readyTimeoutMs: 5000,
    stopGraceSeconds: 1,
    stdout: (data, done) => {
      stdout.push(data);
      done();
    },
    stderr: (_data, done) => done(),
    log: () => undefined,
  });
  const guest = new GuestAgent({
    write: (bytes) => {
      guestEnd.write(bytes);
    },
    readFile: () => 'root:x:0:0:root:/root:/bin/sh\n',
    writeFile: (path, content) => {
      identity[path] = content;
    },
    ids: { uid: 0, gid: 0 },
    ptyHelperPath: PTY_HELPER,
    pythonPath: 'python3',
    relayTarget,
    log: () => undefined,
    onWorkloadExit: (code) => exitCodes.push(code),
  });

  guestEnd.on('data', (chunk: Buffer) => guest.receive(chunk));
  host.attachGuest(hostEnd);
  guest.start();

  const execSocketPath = join(directory, 'exec.sock');

  await listen(
    net.createServer((socket) => host.handleExecClient(socket)),
    execSocketPath,
  );

  const exec: Harness['exec'] = async (argv, options = {}) => {
    const stdin = new PassThrough();
    const out = new PassThrough();
    const err = new PassThrough();
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    out.on('data', (chunk: Buffer) => outChunks.push(chunk));
    err.on('data', (chunk: Buffer) => errChunks.push(chunk));
    stdin.end(options.stdin ?? '');

    const io: ExecClientIo = {
      stdin,
      stdout: out,
      stderr: err,
      env: options.env ?? {},
      onSignal: () => () => undefined,
    };
    const code = await runExecClient(
      net.connect(execSocketPath),
      { user: '', workdir: '', passEnv: options.passEnv ?? [], argv },
      io,
    );

    return { code, stdout: Buffer.concat(outChunks).toString(), stderr: Buffer.concat(errChunks).toString() };
  };

  return {
    host,
    guest,
    stdout,
    identity,
    exitCodes,
    exec,
    close: async () => {
      host.requestStop();
      await waitFor(() => exitCodes.length > 0 || host.workloadExitCode !== null);
      guest.stop();
    },
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }

    await new Promise((done) => setTimeout(done, 20));
  }
}

describe('microVM bridge (launcher daemon <-> guest agent <-> vm-exec)', () => {
  it('starts the workload, relays its output and applies the container identity', async () => {
    const harness = await startHarness();

    await waitFor(() => Buffer.concat(harness.stdout).toString().includes('workload-started'));

    expect(harness.host.isReady).toBe(true);
    expect(harness.identity).toEqual({
      '/etc/resolv.conf': 'nameserver 10.0.2.3\nsearch lab\n',
      '/proc/sys/kernel/hostname': 'worker-1',
      '/etc/hostname': 'worker-1\n',
      '/etc/hosts': '127.0.0.1 localhost\n',
      // The agent protects itself from the guest OOM killer (workload / exec processes get 0, see oom-priority.spec).
      '/proc/self/oom_score_adj': '-1000',
    });

    await harness.close();
  });

  it('runs exec sessions with streams, environment and exit status', async () => {
    const harness = await startHarness();
    const result = await harness.exec(['sh', '-c', 'cat; echo "$GREETING $TOKEN"; echo oops >&2; exit 3'], {
      stdin: 'from-stdin\n',
      env: { TOKEN: 's3cret' },
      passEnv: ['TOKEN'],
    });

    expect(result).toEqual({ code: 3, stdout: 'from-stdin\nhello s3cret\n', stderr: 'oops\n' });

    await harness.close();
  });

  it('passes exec environments larger than one frame', async () => {
    const harness = await startHarness();
    const env: NodeJS.ProcessEnv = {};
    const names: string[] = [];

    for (let index = 0; index < 1500; index += 1) {
      env[`LARGE_${index}`] = 'v'.repeat(100);
      names.push(`LARGE_${index}`);
    }

    const result = await harness.exec(['sh', '-c', 'printf %s "$LARGE_1499"'], { env, passEnv: names });

    expect(result).toEqual({ code: 0, stdout: 'v'.repeat(100), stderr: '' });

    await harness.close();
  });

  it('survives malformed guest frames by tearing the guest connection down', async () => {
    const [hostEnd, guestEnd] = await connectPair(join(directory, 'evil.sock'));
    const logs: string[] = [];
    const host = new HostDaemon({
      boot: {
        argv: ['true'],
        env: [],
        workdir: '/',
        user: '',
        hostname: '',
        hosts: '',
        dnsSearch: '',
        dnsOptions: '',
        loopbackPorts: [],
      },
      forwardPorts: [],
      readyTimeoutMs: 200,
      stopGraceSeconds: 1,
      stdout: (_data, done) => done(),
      stderr: (_data, done) => done(),
      log: (message) => logs.push(message),
    });
    const closed = new Promise((done) => hostEnd.once('close', done));

    host.attachGuest(hostEnd);
    // A DATA frame without a channel byte on the workload stream.
    guestEnd.write(Buffer.from([0, 0, 0, 0, 20, 0, 0, 0, 1]));
    await closed;

    expect(logs.join('\n')).toContain('guest bridge protocol error');
  });

  it('transfers large outputs under flow control and reports missing commands like docker exec', async () => {
    const harness = await startHarness();
    const big = await harness.exec(['sh', '-c', 'head -c 3000000 /dev/zero | tr "\\0" a']);
    const missing = await harness.exec(['/definitely/not/here']);

    expect(big.code).toBe(0);
    expect(big.stdout).toHaveLength(3000000);
    expect(missing.code).toBe(127);
    expect(missing.stderr).toContain('exec failed');

    await harness.close();
  });

  it('tunnels forwarded TCP ports into the guest', async () => {
    const echoPort = await listen(net.createServer((socket) => socket.pipe(socket)));
    const harness = await startHarness();
    const front = net.createServer((socket) => harness.host.handleTcpConnection(socket, echoPort));
    const frontPort = await listen(front);
    const client = net.connect(frontPort, '127.0.0.1');
    const received: Buffer[] = [];

    sockets.push(client);
    client.on('data', (chunk: Buffer) => received.push(chunk));
    client.write('ping through the bridge');

    await waitFor(() => Buffer.concat(received).toString() === 'ping through the bridge');
    client.end();
    await harness.close();
  });

  it('relays guest loopback ports to the container loopback', async () => {
    // In the guest, 127.0.0.1:<port> is relayed to the user-mode gateway (the container loopback); here the
    // container side is played by 127.0.0.2 with the same port number.
    const upstream = net.createServer((socket) => socket.end('proxy-answer'));

    servers.push(upstream);
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.2', done));

    const port = (upstream.address() as net.AddressInfo).port;
    const harness = await startHarness({ loopbackPorts: [port] }, '127.0.0.2');

    await waitFor(() => harness.host.isReady);

    const relayed = await new Promise<string>((done, fail) => {
      const probe = net.connect(port, '127.0.0.1');
      const chunks: Buffer[] = [];

      probe.on('data', (chunk: Buffer) => chunks.push(chunk));
      probe.on('error', fail);
      probe.on('close', () => done(Buffer.concat(chunks).toString()));
    });

    expect(relayed).toBe('proxy-answer');

    await harness.close();
  });

  it('stops the workload on request and reports 128 + SIGTERM', async () => {
    const harness = await startHarness();

    await waitFor(() => harness.host.isReady);
    harness.host.requestStop();
    await waitFor(() => harness.exitCodes.length === 1);

    expect(harness.exitCodes).toEqual([143]);
    expect(harness.host.workloadExitCode).toBe(143);
    harness.guest.stop();
  });

  it('fails exec requests that arrive before the guest is ready once the timeout passes', async () => {
    const [hostEnd] = await connectPair(join(directory, 'silent.sock'));
    const host = new HostDaemon({
      boot: {
        argv: ['true'],
        env: [],
        workdir: '/',
        user: '',
        hostname: '',
        hosts: '',
        dnsSearch: '',
        dnsOptions: '',
        loopbackPorts: [],
      },
      forwardPorts: [],
      readyTimeoutMs: 200,
      stopGraceSeconds: 1,
      stdout: (_data, done) => done(),
      stderr: (_data, done) => done(),
      log: () => undefined,
    });

    host.attachGuest(hostEnd);
    await listen(
      net.createServer((socket) => host.handleExecClient(socket)),
      join(directory, 'exec2.sock'),
    );

    const err = new PassThrough();
    const errChunks: Buffer[] = [];

    err.on('data', (chunk: Buffer) => errChunks.push(chunk));

    const stdin = new PassThrough();

    stdin.end();

    const code = await runExecClient(
      net.connect(join(directory, 'exec2.sock')),
      { user: '', workdir: '', passEnv: [], argv: ['id'] },
      {
        stdin,
        stdout: new PassThrough(),
        stderr: err,
        env: {},
        onSignal: () => () => undefined,
      },
    );

    expect(code).toBe(125);
    expect(Buffer.concat(errChunks).toString()).toContain('did not become ready');
  });

  (hasPython ? it : it.skip)('runs TTY sessions on a pseudo terminal with the requested size', async () => {
    expect(readFileSync(PTY_HELPER, 'utf8')).toContain('TIOCSWINSZ');

    const harness = await startHarness();
    const stdin = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (mode: boolean) => void };
    const stdout = new PassThrough() as PassThrough & { isTTY: boolean; columns: number; rows: number };
    const chunks: Buffer[] = [];

    stdin.isTTY = true;
    stdin.setRawMode = () => undefined;
    stdout.isTTY = true;
    stdout.columns = 132;
    stdout.rows = 43;
    stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    stdin.end();

    const code = await runExecClient(
      net.connect(join(directory, 'exec.sock')),
      { user: '', workdir: '', passEnv: [], argv: ['sh', '-c', 'stty size; test -t 0 && echo is-a-tty'] },
      { stdin, stdout, stderr: new PassThrough(), env: {}, onSignal: () => () => undefined },
    );

    expect(code).toBe(0);
    expect(Buffer.concat(chunks).toString()).toMatch(/43 132\r?\nis-a-tty/);

    await harness.close();
  });
});
