import { once } from 'node:events';
import { access, mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection as createUnixConnection, createServer as createUnixServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { connect } from 'node:tls';

import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
} from '@forepath/loadweaver/shared/util-pki';

import { MigrationSessions } from './migration-sessions';
import { transferRuleArgs } from './transfer-firewall';
import {
  encodeFrame,
  FrameReader,
  safeLinkEntry,
  safeLinkTarget,
  safeRelativePath,
  sendBatch,
  type TransferEntry,
} from './transfer-protocol';
import {
  connectRelay,
  isNodeCertificate,
  listenRelay,
  nodeIdentityUri,
  sendCheckpointBatch,
  TransferService,
  type TransferCredentials,
} from './transfer.service';

const MIGRATION = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const TOKEN = 'A'.repeat(43);

describe('transfer protocol (3.10)', () => {
  it('accepts only plain relative paths and CRIU parent links', () => {
    expect(safeRelativePath('p1/pages-1.img')).toBe(true);
    expect(safeRelativePath('upper.tar')).toBe(true);
    for (const bad of ['', '/etc/passwd', '../x', 'p1/../../x', 'p1//x', './x', 'p1/x y', 'p1/.']) {
      expect(safeRelativePath(bad)).toBe(false);
    }

    expect(safeLinkTarget('../p2')).toBe(true);
    for (const bad of ['/etc', '../../etc', 'p2', '../..', '../p2/x']) expect(safeLinkTarget(bad)).toBe(false);

    // Only CRIU's `parent` link inside an image dir (M6 review M2).
    expect(safeLinkEntry('p2/parent', '../p1')).toBe(true);
    expect(safeLinkEntry('l', '../other-migration')).toBe(false);
    expect(safeLinkEntry('p2/l', '../p1')).toBe(false);
    expect(safeLinkEntry('final/x/parent', '../p1')).toBe(false);
  });

  it('frames metadata and streams file bytes in between, split across arbitrary chunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lw-transfer-'));

    try {
      await mkdir(join(root, 'p2'));
      await writeFile(join(root, 'p2', 'pages-1.img'), Buffer.alloc(300_000, 7));
      await symlink('../p1', join(root, 'p2', 'parent'));

      const wire = new PassThrough();
      const chunks: Buffer[] = [];

      wire.on('data', (c: Buffer) => chunks.push(c));

      const entries: TransferEntry[] = [
        { type: 'dir', path: 'p2', mode: 0o700 },
        { type: 'file', path: 'p2/pages-1.img', size: 300_000, mode: 0o600 },
        { type: 'symlink', path: 'p2/parent', target: '../p1' },
      ];
      const bytes = await sendBatch(
        wire,
        { token: TOKEN, migration: MIGRATION, attempt: 1, batch: 'p2' },
        root,
        entries,
      );

      wire.end();
      expect(bytes).toBe(300_000);

      // Re-chunk into 1000-byte pieces: frames must survive any split.
      const all = Buffer.concat(chunks);
      const pieces = Array.from({ length: Math.ceil(all.length / 1000) }, (_, i) =>
        all.subarray(i * 1000, (i + 1) * 1000),
      );
      const reader = new FrameReader(
        (async function* () {
          yield* pieces;
        })(),
      );

      expect(await reader.frame()).toMatchObject({ type: 'hello', v: 1, batch: 'p2', attempt: 1 });
      expect(await reader.frame()).toEqual(entries[0]);
      expect(await reader.frame()).toEqual(entries[1]);

      let received = 0;

      for await (const part of reader.bytes(300_000)) received += part.length;

      expect(received).toBe(300_000);
      expect(await reader.frame()).toMatchObject({ type: 'sum', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(await reader.frame()).toEqual(entries[2]);
      expect(await reader.frame()).toEqual({ type: 'end', files: 1, bytes: 300_000 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses oversized frames', async () => {
    const header = Buffer.alloc(4);

    header.writeUInt32BE(10 * 1024 * 1024, 0);

    const reader = new FrameReader(
      (async function* () {
        yield header;
      })(),
    );

    await expect(reader.frame()).rejects.toThrow('too large');
    expect(() => encodeFrame({ big: 'x'.repeat(70_000) })).toThrow('too large');
  });
});

describe('transfer endpoint (mutual TLS + single-use token)', () => {
  let ca: { certificatePem: string; privateKeyPem: string };
  const creds: Record<string, TransferCredentials> = {};
  let root: string;

  const nodeCredentials = async (name: string): Promise<TransferCredentials> => {
    const keys = await generateKeyPair();
    const issued = await issueCertificate({
      ca,
      csrPem: await createCsr(keys, name),
      clusterId: 'lab',
      kind: 'node',
      name,
      validityHours: 1,
    });

    return {
      clusterId: 'lab',
      privateKeyPem: keys.privateKeyPem,
      certificatePem: issued.certificatePem,
      caCertificatePem: ca.certificatePem,
    };
  };

  beforeAll(async () => {
    process.env['LOADWEAVER_MIGRATION_PORT'] = '0';
    ca = await createCertificateAuthority({ commonName: 'lab', validityDays: 1 });
    creds['n1'] = await nodeCredentials('n1');
    creds['n2'] = await nodeCredentials('n2');
    creds['n3'] = await nodeCredentials('n3');
    root = await mkdtemp(join(tmpdir(), 'lw-transfer-tls-'));
    await mkdir(join(root, 'src', 'p1'), { recursive: true });
    await writeFile(join(root, 'src', 'p1', 'pages-1.img'), Buffer.alloc(1_000_000, 3));
    await mkdir(join(root, 'src', 'p2'));
    await writeFile(join(root, 'src', 'p2', 'pages-1.img'), 'dirty');
    await symlink('../p1', join(root, 'src', 'p2', 'parent'));
  });

  afterAll(async () => {
    delete process.env['LOADWEAVER_MIGRATION_PORT'];
    await rm(root, { recursive: true, force: true });
  });

  it('names nodes by their certificate URI', () => {
    const uri = nodeIdentityUri('lab', 'n1');

    expect(isNodeCertificate({ subjectaltname: `URI:${uri}, IP Address:10.0.0.1` }, uri)).toBe(true);
    expect(isNodeCertificate({ subjectaltname: `URI:${uri}x` }, uri)).toBe(false);
    expect(isNodeCertificate(undefined, uri)).toBe(false);
  });

  it('receives batches from the expected source only, verifies them and closes with the attempt', async () => {
    const server = new TransferService();
    const dir = join(root, 'dst');
    const endpoint = await server.open({
      migration: MIGRATION,
      attempt: 1,
      token: TOKEN,
      peer: 'n1',
      dir,
      expiresInSeconds: 60,
      address: '127.0.0.1',
      credentials: creds['n2'],
    });
    const send = (from: string, overrides: Partial<Parameters<typeof sendCheckpointBatch>[0]> = {}) =>
      sendCheckpointBatch({
        endpoint,
        credentials: creds[from],
        peer: 'n2',
        token: TOKEN,
        migration: MIGRATION,
        attempt: 1,
        batch: 'p1',
        root: join(root, 'src'),
        paths: ['p1'],
        timeoutMs: 20_000,
        ...overrides,
      });

    try {
      expect(await send('n1')).toBe(1_000_000);
      expect(await send('n1', { batch: 'p2', paths: ['p2'] })).toBe(5);
      expect(server.received(MIGRATION, 1)?.batches).toEqual(new Set(['p1', 'p2']));
      expect((await readFile(join(dir, 'p1', 'pages-1.img'))).length).toBe(1_000_000);
      expect(await readlink(join(dir, 'p2', 'parent'))).toBe('../p1');
      await expect(server.waitFor(MIGRATION, 1, 'p2', 100)).resolves.toBeUndefined();

      // Another node (valid cluster certificate), a wrong token, another attempt: refused alike.
      await expect(send('n3')).rejects.toThrow();
      await expect(send('n1', { token: 'B'.repeat(43) })).rejects.toThrow();
      await expect(send('n1', { attempt: 2 })).rejects.toThrow();
      // The source checks the target's certificate too.
      await expect(send('n1', { peer: 'n3' })).rejects.toThrow('not node n3');
    } finally {
      server.close(MIGRATION, 1);
    }

    await expect(send('n1')).rejects.toThrow();
    expect(server.received(MIGRATION, 1)).toBeNull();
    await server.onModuleDestroy();
  });
  it('relays raw bytes between the source launcher and the target libvirt socket (M7.4)', async () => {
    const server = new TransferService();
    const dir = join(root, 'relay');
    const libvirt = join(root, 'libvirt.sock');
    const echo = createUnixServer((c) => c.on('data', (d: Buffer) => c.write(d.toString().toUpperCase())));
    const onConnect = jest.fn(async () => undefined);

    await new Promise<void>((resolve) => echo.listen(libvirt, resolve));

    const endpoint = await server.open(
      {
        migration: MIGRATION,
        attempt: 1,
        token: TOKEN,
        peer: 'n1',
        dir,
        expiresInSeconds: 60,
        address: '127.0.0.1',
        credentials: creds['n2'],
      },
      { socketPath: async () => libvirt, onConnect },
    );
    const request = { endpoint, peer: 'n2', token: TOKEN, migration: MIGRATION, attempt: 1 };
    const relay = await listenRelay({ ...request, credentials: creds['n1'], socketPath: join(root, 'peer.sock') });

    try {
      const client = createUnixConnection(join(root, 'peer.sock'));
      const answer = once(client, 'data');

      client.write('qemu rpc');
      expect(String((await answer)[0])).toBe('QEMU RPC');
      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(relay.connections()).toBe(1);

      // Wrong node or token: refused like batches; the attempt's end closes open relays.
      await expect(connectRelay({ ...request, credentials: creds['n3'] })).rejects.toThrow();
      await expect(connectRelay({ ...request, credentials: creds['n1'], token: 'B'.repeat(43) })).rejects.toThrow(
        'target refused the relay',
      );

      const closed = once(client, 'close');

      server.close(MIGRATION, 1);
      await closed;
    } finally {
      await relay.close();
      echo.close();
      await server.onModuleDestroy();
    }
  });

  it('holds a microVM migration stream at the gate, delivers it whole, and applies batches before answering (W10b)', async () => {
    const server = new TransferService();
    const incoming = join(root, 'incoming.sock');
    const received: Buffer[] = [];
    let ended: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (ended = resolve));
    // QEMU's incoming side: reads until the source closes (no return path).
    const qemu = createUnixServer((c) => {
      c.on('data', (d: Buffer) => received.push(d));
      c.on('end', () => ended());
    });
    const applied: string[] = [];

    await new Promise<void>((resolve) => qemu.listen(incoming, resolve));

    const endpoint = await server.open(
      {
        migration: MIGRATION,
        attempt: 3,
        token: TOKEN,
        peer: 'n1',
        dir: join(root, 'gated'),
        expiresInSeconds: 60,
        address: '127.0.0.1',
        credentials: creds['n2'],
      },
      {
        socketPath: async () => incoming,
        onBatch: async (batch) => {
          if (batch === 'handover-fails') throw new Error('mount failed');

          applied.push(batch);
        },
      },
    );
    const request = { endpoint, peer: 'n2', token: TOKEN, migration: MIGRATION, attempt: 3 };
    const relay = await listenRelay({ ...request, credentials: creds['n1'], socketPath: join(root, 'gate.sock') });

    try {
      // A batch is applied before the source gets its answer; a failing apply is the batch's error.
      await sendCheckpointBatch({ ...request, credentials: creds['n1'], batch: 'handover', root, paths: [] });
      expect(applied).toEqual(['handover']);
      await expect(
        sendCheckpointBatch({ ...request, credentials: creds['n1'], batch: 'handover-fails', root, paths: [] }),
      ).rejects.toThrow('mount failed');

      const source = createUnixConnection(join(root, 'gate.sock'));

      await once(source, 'connect');
      source.write('ram-');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(Buffer.concat(received).toString()).toBe('ram-');

      // Gated: QEMU's last data waits here (it may even finish and close) until the gate opens.
      relay.gate(1024);
      source.end('device-state');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(Buffer.concat(received).toString()).toBe('ram-');
      expect(relay.held()).toBe('device-state'.length);

      relay.release();
      await done;
      expect(Buffer.concat(received).toString()).toBe('ram-device-state');
      expect(relay.held()).toBe(0);
    } finally {
      await relay.close();
      qemu.close();
      await server.onModuleDestroy();
    }
  });

  it('refuses relays for attempts opened without one', async () => {
    const server = new TransferService();
    const endpoint = await server.open({
      migration: MIGRATION,
      attempt: 2,
      token: TOKEN,
      peer: 'n1',
      dir: join(root, 'no-relay'),
      expiresInSeconds: 60,
      address: '127.0.0.1',
      credentials: creds['n2'],
    });

    try {
      await expect(
        connectRelay({
          endpoint,
          credentials: creds['n1'],
          peer: 'n2',
          token: TOKEN,
          migration: MIGRATION,
          attempt: 2,
        }),
      ).rejects.toThrow('target refused the relay: not authorized');
    } finally {
      await server.onModuleDestroy();
    }
  });

  it('refuses links outside CRIU parent links and anything written through a received link (M6 review M2)', async () => {
    const server = new TransferService();
    const base = join(root, 'escape');
    const dir = join(base, 'mine');
    const sibling = join(base, 'other');

    await mkdir(sibling, { recursive: true });
    // Source tree for the raw sender: `l/pages-1.img` and `p2/parent/pages-1.img` exist as plain files there.
    await mkdir(join(root, 'raw', 'l'), { recursive: true });
    await mkdir(join(root, 'raw', 'p2', 'parent'), { recursive: true });
    await writeFile(join(root, 'raw', 'l', 'pages-1.img'), 'evil');
    await writeFile(join(root, 'raw', 'p2', 'parent', 'pages-1.img'), 'evil');

    const endpoint = await server.open({
      migration: MIGRATION,
      attempt: 3,
      token: TOKEN,
      peer: 'n1',
      dir,
      expiresInSeconds: 60,
      address: '127.0.0.1',
      credentials: creds['n2'],
    });
    // A hostile source with a valid certificate and token sends hand-made entries.
    const raw = async (batch: string, entries: TransferEntry[]) => {
      const socket = connect({
        host: endpoint.address,
        port: endpoint.port,
        key: creds['n1'].privateKeyPem,
        cert: creds['n1'].certificatePem,
        ca: creds['n1'].caCertificatePem,
        checkServerIdentity: () => undefined,
      });

      try {
        await once(socket, 'secureConnect');

        const result = new FrameReader(socket).frame<{ ok: boolean; error?: string }>();

        await sendBatch(
          socket,
          { token: TOKEN, migration: MIGRATION, attempt: 3, batch },
          join(root, 'raw'),
          entries,
        ).catch(() => undefined);

        return await result;
      } finally {
        socket.destroy();
      }
    };

    try {
      expect(
        await raw('l', [
          { type: 'symlink', path: 'l', target: '../other' },
          { type: 'file', path: 'l/pages-1.img', size: 4, mode: 0o600 },
        ]),
      ).toMatchObject({ ok: false, error: 'invalid link' });
      expect(await raw('p2', [{ type: 'symlink', path: 'p2/parent', target: '../p1' }])).toMatchObject({ ok: true });
      expect(await raw('final', [{ type: 'file', path: 'p2/parent/pages-1.img', size: 4, mode: 0o600 }])).toMatchObject(
        { ok: false, error: expect.stringContaining('refusing to follow the link at p2/parent') },
      );
      expect(await raw('final', [{ type: 'dir', path: 'p2/parent', mode: 0o700 }])).toMatchObject({
        ok: false,
        error: expect.stringContaining('refusing to follow'),
      });
      await expect(access(join(dir, 'p1'))).rejects.toThrow();
      await expect(access(join(sibling, 'pages-1.img'))).rejects.toThrow();
      expect(await readlink(join(dir, 'p2', 'parent'))).toBe('../p1');
    } finally {
      server.close(MIGRATION, 3);
      await server.onModuleDestroy();
    }
  });
});

describe('transfer firewall', () => {
  it('marks exactly the peer and port, outbound only for the agent (uid 0)', () => {
    expect(transferRuleArgs('input', '10.93.0.1', 7460, MIGRATION).join(' ')).toBe(
      `add rule inet lw_migration input ip saddr 10.93.0.1 tcp dport 7460 meta mark set 0x4c570002 comment "migration:${MIGRATION}"`,
    );
    expect(transferRuleArgs('output', 'fd00::2', 7460, MIGRATION).join(' ')).toBe(
      `add rule inet lw_migration output ip6 daddr fd00::2 tcp dport 7460 meta skuid 0 meta mark set 0x4c570002 comment "migration:${MIGRATION}"`,
    );
  });
});

describe('MigrationSessions', () => {
  it('protects replicas under a session and restored ones until their desired state arrives', () => {
    const sessions = new MigrationSessions();
    let now = 1_000;

    sessions.now = () => now;
    sessions.begin('p/d/web/0');
    expect(sessions.protectedReplicas()).toEqual(new Set(['p/d/web/0']));
    sessions.end('p/d/web/0', true);
    expect(sessions.activeReplicas()).toEqual(new Set());
    expect(sessions.protectedReplicas()).toEqual(new Set(['p/d/web/0']));
    sessions.adopted('p/d/web/0');
    expect(sessions.protectedReplicas()).toEqual(new Set());

    sessions.begin('p/d/api/0');
    sessions.end('p/d/api/0', true);
    now += 10 * 60_000;
    expect(sessions.protectedReplicas()).toEqual(new Set());
  });
});
