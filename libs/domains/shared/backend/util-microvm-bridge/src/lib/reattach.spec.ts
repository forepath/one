import { mkdtempSync, rmSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { MICROVM_RESYNC_MARKER } from './constants';
import { ExecClientIo, runExecClient } from './exec-client';
import { FrameDecoder, FrameType, encodeFrame } from './frame';
import { GuestAgent } from './guest-agent';
import { HostDaemon } from './host-daemon';
import { BootConfig } from './messages';
import { PortAttachment } from './port-attachment';

const BOOT: BootConfig = {
  argv: ['sh', '-c', 'echo started; exec sleep 30'],
  env: ['PATH=/usr/bin:/bin'],
  workdir: '/',
  user: '',
  hostname: '',
  hosts: '',
  dnsSearch: '',
  dnsOptions: '',
  loopbackPorts: [],
};

const cleanup: (() => void)[] = [];
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'microvm-reattach-'));
});

afterEach(() => {
  cleanup.splice(0).forEach((done) => done());
  rmSync(directory, { recursive: true, force: true });
});

async function pair(name: string): Promise<[net.Socket, net.Socket]> {
  const path = join(directory, name);
  let accepted: (socket: net.Socket) => void = () => undefined;
  const acceptedSocket = new Promise<net.Socket>((done) => (accepted = done));
  const server = net.createServer((socket) => accepted(socket));

  await new Promise<void>((done) => server.listen(path, done));

  const client = net.connect(path);

  await new Promise((done) => client.once('connect', done));

  const other = await acceptedSocket;

  cleanup.push(() => {
    client.destroy();
    other.destroy();
    server.close();
  });

  return [client, other];
}

function daemon(logs: string[], resync = false): HostDaemon {
  return new HostDaemon({
    boot: BOOT,
    forwardPorts: [],
    readyTimeoutMs: 3000,
    stopGraceSeconds: 1,
    stdout: (_data, done) => done(),
    stderr: (_data, done) => done(),
    log: (message) => logs.push(message),
    ...(resync ? { resync: true } : {}),
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');

    await new Promise((done) => setTimeout(done, 20));
  }
}

async function exec(host: HostDaemon, argv: string[]): Promise<{ code: number; stdout: string }> {
  const path = join(directory, `exec-${Math.random().toString(36).slice(2)}.sock`);
  const server = net.createServer((socket) => host.handleExecClient(socket));

  await new Promise<void>((done) => server.listen(path, done));
  cleanup.push(() => server.close());

  const stdin = new PassThrough();
  const out = new PassThrough();
  const chunks: Buffer[] = [];

  out.on('data', (chunk: Buffer) => chunks.push(chunk));
  stdin.end('');

  const io: ExecClientIo = { stdin, stdout: out, stderr: new PassThrough(), env: {}, onSignal: () => () => undefined };
  const code = await runExecClient(net.connect(path), { user: '', workdir: '', passEnv: [], argv }, io);

  return { code, stdout: Buffer.concat(chunks).toString() };
}

describe('bridge re-attach after a live migration (M7 W10b)', () => {
  it('a new daemon skips the torn stream up to the marker and takes over the running workload without a BOOT', async () => {
    const [sourceHost, sourceGuest] = await pair('source.sock');
    const [targetHost, targetGuest] = await pair('target.sock');
    let port: net.Socket = sourceGuest;
    const exits: number[] = [];
    const guest = new GuestAgent({
      write: (bytes) => {
        port.write(bytes);
      },
      readFile: () => 'root:x:0:0:root:/root:/bin/sh\n',
      writeFile: () => undefined,
      ids: { uid: 0, gid: 0 },
      log: () => undefined,
      onWorkloadExit: (code) => exits.push(code),
    });
    const sourceLogs: string[] = [];
    const source = daemon(sourceLogs);

    sourceGuest.on('data', (chunk: Buffer) => guest.receive(chunk));
    source.attachGuest(sourceHost);
    guest.start();
    await waitFor(() => source.isReady);

    // The switch-over: the target daemon first sees the tail of a frame the source never finished, then the marker.
    const targetLogs: string[] = [];
    const target = daemon(targetLogs, true);
    const toGuest = new FrameDecoder();
    let boots = 0;

    targetGuest.on('data', (chunk: Buffer) => {
      boots += toGuest.push(chunk).filter((f) => f.type === FrameType.Boot).length;
      guest.receive(chunk);
    });
    target.attachGuest(targetHost);
    expect(target.isSynced).toBe(false);

    const torn = encodeFrame(FrameType.Data, 1, Buffer.from([1, ...Buffer.from('half a line')]));

    targetGuest.write(torn.subarray(5));
    port = targetGuest;
    guest.reattach();

    await waitFor(() => target.isReady);
    expect(target.isSynced).toBe(true);
    expect(targetLogs.join('\n')).toContain('re-attached');
    expect(boots).toBe(0);
    expect(await exec(target, ['sh', '-c', 'echo still-here'])).toEqual({ code: 0, stdout: 'still-here\n' });

    target.requestStop();
    await waitFor(() => target.workloadExitCode !== null);
    expect(exits).toHaveLength(1);
    guest.stop();
  });

  it('looks for the marker again after a protocol error (a repeated re-attach)', async () => {
    const [hostEnd, guestEnd] = await pair('again.sock');
    const logs: string[] = [];
    const host = daemon(logs, true);
    const hello = encodeFrame(FrameType.Hello, 0, Buffer.from(JSON.stringify({ version: 1, running: true })));

    host.attachGuest(hostEnd);
    guestEnd.write(Buffer.concat([Buffer.from('garbage'), MICROVM_RESYNC_MARKER, hello]));
    await waitFor(() => host.isReady);
    // A second marker inside the frame stream: a protocol error, then the marker is found again.
    guestEnd.write(Buffer.concat([MICROVM_RESYNC_MARKER, hello]));
    await waitFor(() => logs.some((l) => l.includes('protocol error')));
    await waitFor(() => host.isSynced);
    expect(hostEnd.destroyed).toBe(false);
  });

  it('a normal daemon still boots a fresh guest (no running workload)', async () => {
    const [hostEnd, guestEnd] = await pair('fresh.sock');
    const host = daemon([]);
    const frames: number[] = [];

    guestEnd.on('data', (chunk: Buffer) => frames.push(chunk.readUInt8(4)));
    host.attachGuest(hostEnd);
    guestEnd.write(encodeFrame(FrameType.Hello, 0, Buffer.from(JSON.stringify({ version: 1 }))));
    await waitFor(() => frames.includes(FrameType.Boot));
    expect(host.isReady).toBe(false);
  });
});

describe('PortAttachment', () => {
  it('re-attaches only when an established session (or an unanswered re-attach) ended', () => {
    let reattached = 0;
    const port = new PortAttachment(() => reattached++);

    expect(port.ended()).toBe(false);
    port.data();
    expect(port.ended()).toBe(true);
    expect(port.ended()).toBe(true);
    port.data();
    expect(reattached).toBe(2);
  });
});
