import { createHash, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { chmod, chown, lstat, mkdir, open, rename, rm, symlink } from 'node:fs/promises';
import { createConnection, createServer as createUnixServer, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { finished } from 'node:stream/promises';
import { connect, createServer, type PeerCertificate, type Server, type TLSSocket } from 'node:tls';

import type { TransferEndpoint } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import {
  encodeFrame,
  FrameReader,
  listEntries,
  MAX_BATCH_ENTRIES,
  MAX_FILE_BYTES,
  safeLinkEntry,
  safeRelativePath,
  sendBatch,
  TRANSFER_PROTOCOL_VERSION,
  writeChunk,
  type TransferEnd,
  type TransferEntry,
  type TransferHello,
  type TransferResult,
  type TransferSum,
} from './transfer-protocol';

export function transferPort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env['LOADWEAVER_MIGRATION_PORT'] || 7460);
}

/** TLS material of this node (the node certificate issued at join, 3.21) and the cluster it belongs to. */
export interface TransferCredentials {
  clusterId: string;
  privateKeyPem: string;
  certificatePem: string;
  caCertificatePem: string;
}

/** The node identity a peer certificate must carry (URI SAN, see util-pki). */
export function nodeIdentityUri(clusterId: string, node: string): string {
  return `spiffe://${clusterId}.loadweaver/node/${node}`;
}

/** Whether a verified peer certificate is the expected node's. */
export function isNodeCertificate(cert: Pick<PeerCertificate, 'subjectaltname'> | undefined, uri: string): boolean {
  const names = (cert?.subjectaltname ?? '').split(',').map((n) => n.trim());

  return names.includes(`URI:${uri}`);
}

function tokenMatches(expected: string, presented: unknown): boolean {
  if (typeof presented !== 'string') return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(presented);

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The target side of a relay (QEMU live migration, 3.35 / M7.4): where an authenticated relay connection is piped to
 * (the incoming launcher's libvirt session socket, resolved per connection) and what must happen first (e.g. promote
 * the VM's disks: the source has allowed two primaries by the time it connects).
 */
export interface RelayTarget {
  socketPath: () => Promise<string>;
  onConnect?: () => Promise<void>;
  /**
   * Runs once a batch arrived, before the source gets its answer (generic microVM live migration, M7 W10b: a guest
   * tree pass is applied, the volumes are taken over); a failure is the batch's error.
   */
  onBatch?: (batch: string) => Promise<void>;
}

interface ReceiveSession {
  key: string;
  relay?: RelayTarget;
  /** Open relay connections (closed with the attempt). */
  relays: Set<Duplex>;
  token: string;
  peer: string;
  dir: string;
  batches: Set<string>;
  bytes: number;
  waiters: (() => void)[];
  idle: NodeJS.Timeout;
  expiresInMs: number;
  /** Batches of one attempt are received one after another (no link can appear between check and write). */
  queue: Promise<unknown>;
}

const NO_FOLLOW_WRITE = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;

/**
 * Refuses a path any of whose existing components (below `root`, the entry itself included unless `self` is false)
 * is a symlink: the receiver never creates, writes or removes anything through a link (M6 review M2).
 */
export async function assertNoLinkedComponent(root: string, relative: string, self: boolean): Promise<void> {
  const segments = relative.split('/');
  const last = self ? segments.length : segments.length - 1;

  for (let i = 1; i <= last; i++) {
    const info = await lstat(join(root, ...segments.slice(0, i))).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;

      throw error;
    });

    if (!info) return;

    if (info.isSymbolicLink()) throw new Error(`refusing to follow the link at ${segments.slice(0, i).join('/')}`);

    if (i < segments.length && !info.isDirectory())
      throw new Error(`not a directory: ${segments.slice(0, i).join('/')}`);
  }
}

export interface OpenTransfer {
  migration: string;
  attempt: number;
  token: string;
  /** The only node allowed to connect (its certificate must name it). */
  peer: string;
  /** Where the batches land (`<dir>/<batch paths>`). */
  dir: string;
  expiresInSeconds: number;
  /** This node's overlay address the endpoint listens on. */
  address: string;
  credentials: TransferCredentials;
}

const IDLE_SOCKET_MS = 60_000;

/**
 * The node-to-node checkpoint transfer (3.10): the target listens on its overlay address with its node certificate;
 * only the source node of an open attempt (its certificate) presenting the attempt's single-use token may send, and
 * only into that attempt's directory. The endpoint closes when the attempt ends or stays unused for its expiry.
 */
@Injectable()
export class TransferService implements OnModuleDestroy {
  private readonly logger = new Logger(TransferService.name);
  private server: Server | null = null;
  private listening: { address: string; port: number } | null = null;
  private readonly sessions = new Map<string, ReceiveSession>();
  /** Fixed per agent (the firewall allowance names it); `LOADWEAVER_MIGRATION_PORT=0` picks a free one (tests). */
  private readonly port = transferPort();

  private static key(migration: string, attempt: number): string {
    return `${migration}#${attempt}`;
  }

  /**
   * Opens the endpoint for one attempt (idempotent); returns where it listens. With `relay`, the source may also open
   * relay connections (raw bytes to `relay.socketPath()`) besides sending batches.
   */
  async open(request: OpenTransfer, relay?: RelayTarget): Promise<TransferEndpoint> {
    const key = TransferService.key(request.migration, request.attempt);
    const existing = this.sessions.get(key);

    if (existing) {
      existing.idle.refresh();

      return { ...(this.listening as { address: string; port: number }) };
    }

    if (this.listening && this.listening.address !== request.address && this.sessions.size === 0) await this.stop();

    if (!this.server) await this.listen(request.address, request.credentials);

    const expiresInMs = request.expiresInSeconds * 1000;
    const session: ReceiveSession = {
      key,
      ...(relay ? { relay } : {}),
      relays: new Set(),
      token: request.token,
      peer: nodeIdentityUri(request.credentials.clusterId, request.peer),
      dir: request.dir,
      batches: new Set(),
      bytes: 0,
      waiters: [],
      expiresInMs,
      queue: Promise.resolve(),
      idle: setTimeout(() => this.close(request.migration, request.attempt, 'expired'), expiresInMs),
    };

    session.idle.unref?.();
    await mkdir(request.dir, { recursive: true, mode: 0o700 });
    this.sessions.set(key, session);

    return { ...(this.listening as { address: string; port: number }) };
  }

  /** Ends an attempt's endpoint; the listener stops with the last attempt. */
  close(migration: string, attempt: number, reason = 'closed'): void {
    const key = TransferService.key(migration, attempt);
    const session = this.sessions.get(key);

    if (!session) return;

    clearTimeout(session.idle);
    this.sessions.delete(key);
    session.waiters.forEach((w) => w());
    session.relays.forEach((r) => r.destroy());
    this.logger.log(`Transfer endpoint for ${key} ${reason}`);

    if (this.sessions.size === 0) void this.stop();
  }

  received(migration: string, attempt: number): { batches: ReadonlySet<string>; bytes: number } | null {
    const session = this.sessions.get(TransferService.key(migration, attempt));

    return session ? { batches: session.batches, bytes: session.bytes } : null;
  }

  /** Resolves once `batch` arrived (or rejects after `timeoutMs` / when the endpoint closed). */
  async waitFor(migration: string, attempt: number, batch: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const session = this.sessions.get(TransferService.key(migration, attempt));

      if (!session) throw new Error('transfer endpoint closed');

      if (session.batches.has(batch)) return;

      const left = deadline - Date.now();

      if (left <= 0) throw new Error(`checkpoint batch ${batch} did not arrive`);

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(left, 1000));

        session.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const session of this.sessions.values()) clearTimeout(session.idle);

    this.sessions.clear();
    await this.stop();
  }

  private async listen(address: string, credentials: TransferCredentials): Promise<void> {
    const server = createServer(
      {
        key: credentials.privateKeyPem,
        cert: credentials.certificatePem,
        ca: credentials.caCertificatePem,
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
      },
      (socket) => void this.handle(socket),
    );

    server.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, address, () => resolve());
    });

    const bound = server.address();

    this.server = server;
    this.listening = { address, port: typeof bound === 'object' && bound ? bound.port : this.port };
    this.logger.log(`Transfer endpoint listening on ${address}:${this.listening.port}`);
  }

  private async stop(): Promise<void> {
    const server = this.server;

    this.server = null;
    this.listening = null;

    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(socket: TLSSocket): Promise<void> {
    socket.setTimeout(IDLE_SOCKET_MS, () => socket.destroy());
    socket.on('error', () => undefined);

    const reply = async (result: Omit<TransferResult, 'type'>) => {
      await writeChunk(socket, encodeFrame({ type: 'result', ...result })).catch(() => undefined);
      socket.end();
    };

    try {
      const reader = new FrameReader(socket);
      const hello = await reader.frame<TransferHello>();
      const session =
        hello.type === 'hello' && hello.v === TRANSFER_PROTOCOL_VERSION
          ? this.sessions.get(TransferService.key(String(hello.migration), Number(hello.attempt)))
          : undefined;

      // One answer for every refusal: an unknown attempt, a wrong token or a wrong node look the same.
      if (
        !session ||
        !tokenMatches(session.token, hello.token) ||
        !isNodeCertificate(socket.getPeerCertificate(), session.peer) ||
        typeof hello.batch !== 'string' ||
        !safeRelativePath(hello.batch)
      )
        return await reply({ ok: false, error: 'not authorized' });

      session.idle.refresh();

      if (hello.relay === true) {
        if (!session.relay) return await reply({ ok: false, error: 'not authorized' });

        return await this.relay(socket, reader, session, session.relay);
      }

      const received = session.queue.then(async () => {
        const bytes = await this.receive(reader, session);

        await session.relay?.onBatch?.(hello.batch);

        return bytes;
      });

      session.queue = received.catch(() => undefined);

      const bytes = await received;

      session.batches.add(hello.batch);
      session.bytes += bytes;
      session.waiters.splice(0).forEach((w) => w());
      await reply({ ok: true, bytes });
    } catch (error) {
      this.logger.warn(`Transfer failed: ${error instanceof Error ? error.message : String(error)}`);
      await reply({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
    }
  }

  /**
   * A relay connection: after `onConnect` and the local connection, `result { ok }` goes back, then bytes flow both
   * ways until either side closes (or the attempt ends). No idle timeout: libvirt keeps its connection alive itself.
   */
  private async relay(socket: TLSSocket, reader: FrameReader, session: ReceiveSession, target: RelayTarget) {
    socket.setTimeout(0);
    await target.onConnect?.();

    const local = createConnection(await target.socketPath());

    local.on('error', () => undefined);
    await once(local, 'connect');
    await writeChunk(socket, encodeFrame({ type: 'result', ok: true } satisfies TransferResult));
    session.relays.add(socket);
    session.relays.add(local);
    socket.once('close', () => (session.relays.delete(socket), local.destroy()));
    local.once('close', () => (session.relays.delete(local), socket.destroy()));
    pipeRelay(reader, socket, local);
  }

  private async receive(reader: FrameReader, session: ReceiveSession): Promise<number> {
    let bytes = 0;
    let files = 0;

    for (let count = 0; ; count++) {
      if (count > MAX_BATCH_ENTRIES) throw new Error('too many entries');

      const frame = await reader.frame<TransferEntry | TransferEnd>();

      if (frame.type === 'end') {
        if (frame.files !== files || frame.bytes !== bytes) throw new Error('batch incomplete');

        return bytes;
      }

      if (!safeRelativePath(frame.path)) throw new Error('invalid path');

      const target = join(session.dir, frame.path);

      if (frame.type === 'dir') {
        await assertNoLinkedComponent(session.dir, frame.path, true);
        await mkdir(target, { recursive: true, mode: 0o700 });
      } else if (frame.type === 'symlink') {
        if (!safeLinkEntry(frame.path, frame.target)) throw new Error('invalid link');

        // The link itself may be replaced (a re-sent batch), never anything through a link above it.
        await assertNoLinkedComponent(session.dir, frame.path, false);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await rm(target, { force: true });
        await symlink(frame.target, target);
      } else if (frame.type === 'file') {
        if (!Number.isSafeInteger(frame.size) || frame.size < 0 || frame.size > MAX_FILE_BYTES)
          throw new Error('invalid size');

        await assertNoLinkedComponent(session.dir, frame.path, false);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });

        const part = `${target}.part`;
        const out = (await open(part, NO_FOLLOW_WRITE, 0o600)).createWriteStream();
        const hash = createHash('sha256');

        try {
          for await (const chunk of reader.bytes(frame.size)) {
            hash.update(chunk);

            if (!out.write(chunk)) await once(out, 'drain');
          }

          out.end();
          await finished(out);
        } catch (error) {
          out.destroy();
          await rm(part, { force: true });
          throw error;
        }

        const sum = await reader.frame<TransferSum>();

        if (sum.type !== 'sum' || sum.sha256 !== hash.digest('hex')) {
          await rm(part, { force: true });
          throw new Error(`checksum mismatch for ${frame.path}`);
        }

        await rename(part, target);
        bytes += frame.size;
        files++;
      } else {
        throw new Error('unexpected frame');
      }
    }
  }
}

export interface SendRequest {
  endpoint: TransferEndpoint;
  credentials: TransferCredentials;
  /** The target node (its certificate must name it). */
  peer: string;
  token: string;
  migration: string;
  attempt: number;
  batch: string;
  /** Root on this node the paths are relative to. */
  root: string;
  /** Files / directories below `root` to send (same relative paths on the target). */
  paths: string[];
  timeoutMs?: number;
}

/** Sends one batch to a target's transfer endpoint; resolves with the bytes the target confirmed. */
export async function sendCheckpointBatch(request: SendRequest): Promise<number> {
  const entries: TransferEntry[] = [];

  for (const path of request.paths) entries.push(...(await listEntries(request.root, path)));

  const expected = nodeIdentityUri(request.credentials.clusterId, request.peer);
  const socket = connect({
    host: request.endpoint.address,
    port: request.endpoint.port,
    key: request.credentials.privateKeyPem,
    cert: request.credentials.certificatePem,
    ca: request.credentials.caCertificatePem,
    minVersion: 'TLSv1.3',
    // The target is identified by its node certificate, not by a hostname.
    checkServerIdentity: (_host, cert) =>
      isNodeCertificate(cert, expected) ? undefined : new Error(`endpoint is not node ${request.peer}`),
  });
  const timer = setTimeout(() => socket.destroy(new Error('transfer timed out')), request.timeoutMs ?? 600_000);

  try {
    await once(socket, 'secureConnect');
    socket.setTimeout(IDLE_SOCKET_MS, () => socket.destroy(new Error('transfer stalled')));

    const reader = new FrameReader(socket);
    const result = reader.frame<TransferResult>();

    // A refusal can arrive while we are still sending: stop sending (a pending write fails with the reason).
    result.then(
      (answer) => {
        if (!answer.ok) socket.destroy(new Error(`target refused the checkpoint: ${answer.error ?? 'unknown error'}`));
      },
      () => undefined,
    );
    await sendBatch(
      socket,
      { token: request.token, migration: request.migration, attempt: request.attempt, batch: request.batch },
      request.root,
      entries,
    );

    const answer = await result;

    if (!answer.ok) throw new Error(`target refused the checkpoint: ${answer.error ?? 'unknown error'}`);

    return answer.bytes ?? 0;
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}

/**
 * Pipes a relay connection after its handshake: `reader`'s remaining bytes (the TLS side) to `local`, and `local` back
 * to the TLS socket, with backpressure both ways; either side ending ends both.
 */
export function pipeRelay(reader: FrameReader, remote: Duplex, local: Duplex): void {
  const close = () => {
    remote.destroy();
    local.destroy();
  };

  local.pipe(remote);
  local.once('end', close);
  void (async () => {
    try {
      for await (const chunk of reader.remaining()) await writeChunk(local, chunk);
    } catch {
      // either side went away
    }

    close();
  })();
}

export interface RelayRequest {
  endpoint: TransferEndpoint;
  credentials: TransferCredentials;
  /** The target node (its certificate must name it). */
  peer: string;
  token: string;
  migration: string;
  attempt: number;
}

/** Opens one relay connection to the target's endpoint (handshake done); the returned reader holds what follows. */
export async function connectRelay(request: RelayRequest): Promise<{ socket: TLSSocket; reader: FrameReader }> {
  const expected = nodeIdentityUri(request.credentials.clusterId, request.peer);
  const socket = connect({
    host: request.endpoint.address,
    port: request.endpoint.port,
    key: request.credentials.privateKeyPem,
    cert: request.credentials.certificatePem,
    ca: request.credentials.caCertificatePem,
    minVersion: 'TLSv1.3',
    checkServerIdentity: (_host, cert) =>
      isNodeCertificate(cert, expected) ? undefined : new Error(`endpoint is not node ${request.peer}`),
  });

  socket.on('error', () => undefined);

  try {
    await once(socket, 'secureConnect');

    const reader = new FrameReader(socket);

    await writeChunk(
      socket,
      encodeFrame({
        type: 'hello',
        v: TRANSFER_PROTOCOL_VERSION,
        token: request.token,
        migration: request.migration,
        attempt: request.attempt,
        batch: 'relay',
        relay: true,
      } satisfies TransferHello),
    );

    const answer = await reader.frame<TransferResult>();

    if (answer.type !== 'result' || !answer.ok)
      throw new Error(`target refused the relay: ${answer.error ?? 'unknown error'}`);

    return { socket, reader };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export interface RelayListener {
  /** Connections relayed so far. */
  connections(): number;
  /**
   * Holds what the local side sends from now on (buffered, at most `maxBytes`: beyond, the connections fail) until
   * {@link release}: a generic microVM's final migration data stays here until the volumes were handed over (M7 W10b).
   */
  gate(maxBytes: number): void;
  /** Sends what the gate held and lets everything through again. */
  release(): void;
  /** Bytes the gate holds. */
  held(): number;
  close(): Promise<void>;
}

/** The local → remote direction of a source relay connection, with the listener's gate. */
interface RelayGate {
  maxBytes: number | null;
  held: number;
  flushers: Set<() => void>;
}

/**
 * The source side of one relay connection: remote → local as {@link pipeRelay}; local → remote with backpressure,
 * held while the gate is closed. The local end (QEMU finished sending) ends the remote side gracefully once
 * everything held went out, so the target gets the whole stream.
 */
export function pipeGatedRelay(reader: FrameReader, remote: Duplex, local: Duplex, gate: RelayGate): void {
  const queue: Buffer[] = [];
  let ended = false;
  const close = () => {
    gate.held -= queue.reduce((sum, chunk) => sum + chunk.length, 0);
    queue.length = 0;
    gate.flushers.delete(flush);
    remote.destroy();
    local.destroy();
  };
  const flush = () => {
    if (gate.maxBytes !== null) return;

    while (queue.length > 0) {
      const chunk = queue.shift() as Buffer;

      gate.held -= chunk.length;

      if (!remote.write(chunk)) {
        local.pause();
        remote.once('drain', () => (local.resume(), flush()));

        return;
      }
    }

    if (ended) {
      gate.flushers.delete(flush);
      remote.end();
    }
  };

  gate.flushers.add(flush);
  local.on('data', (chunk: Buffer) => {
    if (gate.maxBytes !== null || queue.length > 0) {
      queue.push(chunk);
      gate.held += chunk.length;

      if (gate.maxBytes !== null && gate.held > gate.maxBytes) close();

      return;
    }

    if (!remote.write(chunk)) {
      local.pause();
      remote.once('drain', () => (local.resume(), flush()));
    }
  });
  local.once('end', () => {
    ended = true;
    flush();
  });
  remote.once('close', () => (queue.length > 0 || !ended ? close() : undefined));
  void (async () => {
    try {
      for await (const chunk of reader.remaining()) await writeChunk(local, chunk);
    } catch {
      // either side went away
    }

    // The target closed its side: a local end still being flushed finishes on its own.
    if (!ended) close();
  })();
}

/**
 * The source side of a relay (M7.4): a unix socket in the source launcher's run directory (owned by the VMM user, so
 * its libvirt can connect to it), each connection relayed to the target's endpoint over mTLS + the attempt's token.
 */
export async function listenRelay(
  request: RelayRequest & { socketPath: string; owner?: { uid: number; gid: number } },
): Promise<RelayListener> {
  const open = new Set<Socket | TLSSocket>();
  let count = 0;
  const gate: RelayGate = { maxBytes: null, held: 0, flushers: new Set() };
  const server = createUnixServer((conn) => {
    count++;
    open.add(conn);
    conn.on('error', () => undefined);
    conn.once('close', () => open.delete(conn));
    conn.pause();
    connectRelay(request).then(
      ({ socket, reader }) => {
        open.add(socket);
        socket.once('close', () => open.delete(socket));
        pipeGatedRelay(reader, socket, conn, gate);
        // Paused until the remote side was connected: nothing it sent meanwhile is lost.
        conn.resume();
      },
      () => conn.destroy(),
    );
  });

  await rm(request.socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(request.socketPath, () => resolve());
  });
  await chmod(request.socketPath, 0o600);

  if (request.owner) await chown(request.socketPath, request.owner.uid, request.owner.gid);

  return {
    connections: () => count,
    gate: (maxBytes) => {
      gate.maxBytes = maxBytes;
    },
    release: () => {
      gate.maxBytes = null;
      [...gate.flushers].forEach((flush) => flush());
    },
    held: () => gate.held,
    close: async () => {
      open.forEach((s) => s.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(request.socketPath, { force: true });
    },
  };
}
