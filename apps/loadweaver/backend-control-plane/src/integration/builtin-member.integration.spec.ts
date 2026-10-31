import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import {
  BuiltinMemberService,
  MasterKeyService,
  sopsIdentityAad,
} from '@forepath/loadweaver/backend/feature-control-plane';
import { ageRecipientOf, envelopeDecrypt, generateSealKeyPair } from '@forepath/loadweaver/shared/util-secrets';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';

/**
 * Built-in control-plane member (3.39) against a real Postgres, no nodes / VMs: a control plane without any node seals
 * the master key to its built-in member (SOPS works), unseals locally after a restart, keeps an in-sync standby copy
 * once a real member holds the key, does NOT take over while that member is registered but unreachable, and takes
 * over again once the member is removed. `off` keeps the old "no holder" error.
 *
 * A "restart" drops the key layer's process state (the unsealed key, the loaded seal key) and re-reads the seal key
 * file, like a new process would: a second Nest app in the same Jest process can't reconnect its BullMQ workers.
 */
const API_KEY = 'integration-test-api-key';
const NO_HOLDER = 'no control-plane member can hold a master-key share yet';

describe('built-in control-plane member (3.39)', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'lw-it-builtin-'));
  let app: INestApplication;
  let baseUrl = '';
  let recipient = '';

  const api = async (method: string, path: string): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, { method, headers: { authorization: `Bearer ${API_KEY}` } });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  const sql = async (query: string, params: unknown[] = []): Promise<any[]> =>
    await app.get(DataSource).query(query, params);

  const masterKey = () => app.get(MasterKeyService);

  /** A new process' view of the key layer: nothing unsealed, the seal key read again from the state directory. */
  const restart = async (mode: 'auto' | 'off' = 'auto') => {
    process.env['LOADWEAVER_BUILTIN_MEMBER'] = mode;

    const key = masterKey() as unknown as Record<string, unknown>;
    const builtin = app.get(BuiltinMemberService) as unknown as Record<string, unknown>;

    Object.assign(key, { key: null, unsealing: null, unsealTimeoutMs: 3_000 });
    Object.assign(builtin, { initializing: null, privateKey: null, publicKey: null, reason: null });
    await app.get(BuiltinMemberService).ready();
  };

  /** Proves an unseal: the master key opens the stored SOPS identity, which matches the public recipient. */
  const sopsOpens = async (): Promise<string> => {
    const key = await masterKey().current();
    const [row] = await sql('SELECT id, key_id, wrapped_key, ciphertext, recipient FROM lw_git_sops_keys');

    expect(row.key_id).toBe(key.id);

    const identity = envelopeDecrypt(
      key.value,
      { wrappedKey: row.wrapped_key, ciphertext: row.ciphertext },
      sopsIdentityAad(row.id),
    ).toString('utf8');

    expect(ageRecipientOf(identity)).toBe(row.recipient);

    return row.recipient;
  };

  beforeAll(async () => {
    Object.assign(process.env, { LOADWEAVER_BUILTIN_MEMBER: 'off', LOADWEAVER_BUILTIN_MEMBER_DIR: stateDir });
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('`off`: no node, no holder — the old error', async () => {
    const res = await api('GET', '/git/sops/recipient');

    expect(res.status).toBe(409);
    expect(res.json.message).toContain(NO_HOLDER);
    expect(await sql('SELECT 1 FROM lw_builtin_members')).toHaveLength(0);
    expect((await api('GET', '/cluster')).json.controlPlane.builtin).toMatchObject({ mode: 'off', role: 'off' });
  });

  it('0 nodes: the built-in member is the sole holder, SOPS works, and the cluster summary shows it', async () => {
    await restart();

    const res = await api('GET', '/git/sops/recipient');

    expect(res.status).toBe(200);
    expect(res.json.recipient).toMatch(/^age1/);
    recipient = res.json.recipient;
    expect(await sopsOpens()).toBe(recipient);

    const cluster = await api('GET', '/cluster');

    expect(cluster.json.controlPlane.builtin).toMatchObject({
      mode: 'auto',
      state: 'ok',
      role: 'active',
      holder: true,
      standby: false,
      realMembers: 0,
    });
    expect(cluster.json.controlPlane.masterKey).toMatchObject({
      state: 'unsealed',
      threshold: 1,
      holders: ['@control-plane'],
      builtinStandby: false,
    });

    // Seal key: 0600 file on the state volume, only the public half in the database.
    const keyFile = join(stateDir, 'builtin-seal.key');
    const privateKey = readFileSync(keyFile, 'utf8').trim();

    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(await sql('SELECT * FROM lw_builtin_members'))).not.toContain(privateKey);
    expect(JSON.stringify(await sql('SELECT * FROM lw_master_keys'))).not.toContain(privateKey);
    expect(JSON.stringify(await sql('SELECT * FROM lw_audit_events'))).not.toContain(privateKey);
  });

  it('unseals locally after a restart', async () => {
    await restart();
    expect(masterKey().unsealed).toBe(false);
    expect(await sopsOpens()).toBe(recipient);
  });

  it('a real member joins: the threshold uses it only, the standby copy follows; unreachable = no takeover', async () => {
    const member = generateSealKeyPair();

    await sql(
      `INSERT INTO lw_nodes (name, site, control_plane, wireguard_public_key, seal_public_key, joined_at)
       VALUES ('n1', 'fra1', true, 'wg', $1, now())`,
      [member.publicKey],
    );
    expect(await masterKey().reshare()).toBe(true);

    const cluster = await api('GET', '/cluster');

    expect(cluster.json.controlPlane.builtin).toMatchObject({
      role: 'standby',
      holder: false,
      standby: true,
      realMembers: 1,
    });
    expect(cluster.json.controlPlane.masterKey).toMatchObject({ threshold: 1, holders: ['n1'], builtinStandby: true });
    expect(await sopsOpens()).toBe(recipient);

    // Restart while n1 is registered but has no agent connected: the standby copy is not used → sealed.
    await restart();
    await expect(masterKey().current()).rejects.toThrow(/master key is sealed/);
    expect((await api('GET', '/cluster')).json.controlPlane.masterKey.state).toBe('sealed');
    // The built-in member never answered for the member's key.
    expect(await sql(`SELECT 1 FROM lw_unseal_shares WHERE node = '@control-plane'`)).toHaveLength(0);
  });

  it('the member is removed: the built-in member takes over from its standby copy', async () => {
    await sql(`DELETE FROM lw_nodes WHERE name = 'n1'`);
    await restart();

    expect(await sopsOpens()).toBe(recipient);

    const cluster = await api('GET', '/cluster');

    expect(cluster.json.controlPlane.builtin).toMatchObject({ role: 'active', holder: true, realMembers: 0 });
    expect(cluster.json.controlPlane.masterKey).toMatchObject({ holders: ['@control-plane'], builtinStandby: false });
    // Retired keys keep no standby copy.
    expect(await sql('SELECT 1 FROM lw_master_keys WHERE NOT active AND builtin_standby IS NOT NULL')).toHaveLength(0);
  });

  it('inbox: the sole-holder warning for cluster roles', async () => {
    const overview = await api('GET', '/overview');

    expect(overview.status).toBe(200);
    expect(overview.json.inbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'master-key',
          severity: 'warning',
          title: expect.stringContaining('only one key holder'),
        }),
      ]),
    );
  });
});
