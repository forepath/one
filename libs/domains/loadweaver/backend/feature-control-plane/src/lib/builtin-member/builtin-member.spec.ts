import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateSealKeyPair, openSealed, sealTo } from '@forepath/loadweaver/shared/util-secrets';
import type { DataSource } from 'typeorm';

import { DR_ENVELOPE_ENV_KEYS } from '../backups/dr-envelope';
import { databaseTarget } from '../database-handover/database-target.runtime';
import { BuiltinMemberEntity } from '../entities/builtin-member.entity';
import { MasterKeyEntity } from '../entities/master-key.entity';
import { NodeEntity } from '../entities/node.entity';
import { masterKeyInboxItems } from '../health/overview.service';
import type { MasterKeyKmsRegistry } from '../kms/master-key-kms';
import type { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import type { AuditLogService } from '../services/audit-log.service';
import { MasterKeyService } from '../services/master-key.service';
import { REPLICATED_CONTROL_PLANE_ENV } from '../services/network-state.service';
import {
  BUILTIN_HOLDER,
  builtinHolderPlan,
  builtinMemberMode,
  builtinSealKeyPath,
} from '../utils/builtin-member.utils';
import { BuiltinMemberService, isReadOnlyError } from './builtin-member.service';
import { FAKE_KEYS, FakeDataSource } from './builtin-member.testing';

describe('builtinHolderPlan (3.39, user decision 2026-10-29)', () => {
  it.each([
    [0, 'auto', { share: true, standby: false, role: 'active' }],
    [1, 'auto', { share: false, standby: true, role: 'standby' }],
    [3, 'auto', { share: false, standby: true, role: 'standby' }],
    [0, 'always', { share: true, standby: false, role: 'active' }],
    [2, 'always', { share: true, standby: true, role: 'participant' }],
    [0, 'off', { share: false, standby: false, role: 'off' }],
    [2, null, { share: false, standby: false, role: 'off' }],
  ] as const)('%i real members, %s', (members, mode, plan) => {
    expect(builtinHolderPlan(members, mode)).toEqual(plan);
  });

  it('parses the mode and the key file location', () => {
    expect(builtinMemberMode({})).toBe('auto');
    expect(builtinMemberMode({ LOADWEAVER_BUILTIN_MEMBER: 'OFF' })).toBe('off');
    expect(() => builtinMemberMode({ LOADWEAVER_BUILTIN_MEMBER: 'yes' })).toThrow('auto, always or off');
    expect(builtinSealKeyPath({})).toEqual({
      file: '/var/lib/loadweaver-control-plane/builtin-seal.key',
      managed: false,
    });
    expect(builtinSealKeyPath({ LOADWEAVER_BUILTIN_SEAL_KEY_FILE: '/run/secrets/seal' })).toEqual({
      file: '/run/secrets/seal',
      managed: true,
    });
  });

  it('never replicates the built-in member settings to member CPs or into the DR envelope', () => {
    for (const key of [
      'LOADWEAVER_BUILTIN_MEMBER',
      'LOADWEAVER_BUILTIN_MEMBER_DIR',
      'LOADWEAVER_BUILTIN_SEAL_KEY_FILE',
    ]) {
      expect(REPLICATED_CONTROL_PLANE_ENV as readonly string[]).not.toContain(key);
      expect(DR_ENVELOPE_ENV_KEYS as readonly string[]).not.toContain(key);
    }
  });
});

describe('built-in control-plane member', () => {
  let dir: string;
  let data: FakeDataSource;
  let sent: { node: string; payload: Record<string, string> }[];
  const agentKeys = new Map<string, { privateKey: string; publicKey: string }>();
  const reachable = new Set<string>();

  const sessions = {
    get: (node: string) =>
      reachable.has(node)
        ? {
            send: (message: { payload: Uint8Array }) =>
              sent.push({ node, payload: JSON.parse(new TextDecoder().decode(message.payload)) }),
          }
        : undefined,
  } as unknown as AgentSessionRegistry;
  const audit = { record: jest.fn(), recordStandalone: jest.fn() } as unknown as AuditLogService;
  const kms = { configured: () => null } as unknown as MasterKeyKmsRegistry;

  async function boot(env: NodeJS.ProcessEnv = { LOADWEAVER_BUILTIN_MEMBER_DIR: dir }) {
    const builtin = new BuiltinMemberService(data as unknown as DataSource);

    builtin.env = env;
    await builtin.ready();

    const masterKey = new MasterKeyService(data as unknown as DataSource, sessions, audit, kms, builtin);

    masterKey.unsealTimeoutMs = 300;

    return { builtin, masterKey };
  }

  /** What an agent does on `unsealShareRequest` (agent-connection.service.ts `unsealShare`). */
  async function answerAgents(masterKey: MasterKeyService): Promise<void> {
    for (const { node, payload } of sent.splice(0)) {
      const keys = agentKeys.get(node) as { privateKey: string };
      const share = openSealed(
        keys.privateKey,
        Buffer.from(payload['encryptedShare'], 'base64'),
        `master-key/${payload['keyId']}/${node}`,
      );

      await masterKey.accept(node, {
        requestId: payload['requestId'],
        keyId: payload['keyId'],
        sealedShare: sealTo(payload['requesterPublicKey'], share, `unseal/${payload['requestId']}`).toString('base64'),
      });
    }
  }

  /** Unseals while "agents" answer the relayed requests (the relay normally runs on `lw_unseal`). */
  async function unsealWithAgents(masterKey: MasterKeyService) {
    const pending = masterKey.unseal();
    let done = false;

    void pending.finally(() => (done = true)).catch(() => undefined);

    while (!done) {
      for (const request of data.rows({ name: 'UnsealRequestEntity' }))
        await masterKey.relay(request['id'] as string).catch(() => undefined);
      await answerAgents(masterKey);
      await new Promise((r) => setTimeout(r, 20));
    }

    return await pending;
  }

  function addMember(name: string, controlPlane = true): void {
    const keys = generateSealKeyPair();

    agentKeys.set(name, keys);
    reachable.add(name);
    data.rows(NodeEntity).push({ name, controlPlane, lifecycle: 'active', sealPublicKey: keys.publicKey });
  }

  function activeKey() {
    return data.rows(MasterKeyEntity).find((r) => r['active']) as unknown as MasterKeyEntity;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lw-builtin-'));
    data = new FakeDataSource(FAKE_KEYS);
    sent = [];
    agentKeys.clear();
    reachable.clear();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('generates its seal key 0600 in a 0700 directory and registers only the public key', async () => {
    const { builtin } = await boot({ LOADWEAVER_BUILTIN_MEMBER_DIR: join(dir, 'state') });
    const file = join(dir, 'state', 'builtin-seal.key');
    const privateKey = readFileSync(file, 'utf8').trim();

    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'state')).mode & 0o777).toBe(0o700);
    expect((await builtin.status()).state).toBe('ok');

    const [row] = data.rows(BuiltinMemberEntity);

    expect(row).toMatchObject({ id: 'control-plane', mode: 'auto' });
    expect(JSON.stringify(data.rows(BuiltinMemberEntity))).not.toContain(privateKey);

    // Reused on the next start (same key, no new file).
    const again = await boot({ LOADWEAVER_BUILTIN_MEMBER_DIR: join(dir, 'state') });

    expect((await again.builtin.status()).state).toBe('ok');
    expect(data.rows(BuiltinMemberEntity)[0]['sealPublicKey']).toBe(row['sealPublicKey']);
  });

  it('0 members: seals to the built-in member alone and unseals locally after a restart', async () => {
    const { masterKey } = await boot();
    const created = await masterKey.current();

    expect(activeKey()).toMatchObject({ threshold: 1, builtinStandby: null });
    expect(activeKey().holders).toEqual([expect.objectContaining({ node: BUILTIN_HOLDER, kind: 'builtin' })]);
    expect((await masterKey.builtinRole()).role).toBe('active');

    const restarted = await boot();

    expect((await restarted.masterKey.current()).value.equals(created.value)).toBe(true);
  });

  it('1 real member joins: the threshold uses the member only, the standby copy follows, the built-in member stays silent', async () => {
    const { masterKey } = await boot();

    await masterKey.current();
    addMember('n1');
    expect(await masterKey.reshare()).toBe(true);

    const row = activeKey();

    expect(row.holders.map((h) => h.node)).toEqual(['n1']);
    expect(row.threshold).toBe(1);
    expect(row.builtinStandby).toMatchObject({ holder: BUILTIN_HOLDER });
    expect((await masterKey.builtinRole()).role).toBe('standby');

    // After a restart the member unseals; the built-in member doesn't answer (it holds no share).
    const restarted = await boot();
    const value = await unsealWithAgents(restarted.masterKey);

    expect(value.id).toBe(row.id);
    expect(data.rows({ name: 'UnsealShareEntity' }).some((s) => s['node'] === BUILTIN_HOLDER)).toBe(false);

    // A second member: re-keyed to 2 of 2, the standby re-sealed to the new key.
    addMember('n2');
    restarted.masterKey['key'] = value;
    expect(await restarted.masterKey.reshare()).toBe(true);
    expect(activeKey()).toMatchObject({ threshold: 2 });
    expect(activeKey().builtinStandby).not.toBeNull();
    expect(activeKey().builtinStandby?.sealedKey).not.toBe(row.builtinStandby?.sealedKey);
    // Retired keys drop their standby copy.
    expect(data.rows(MasterKeyEntity).filter((r) => !r['active'] && r['builtinStandby'])).toHaveLength(0);
  });

  it('members registered but unreachable: no takeover, stays sealed', async () => {
    const { masterKey } = await boot();

    await masterKey.current();
    addMember('n1');
    await masterKey.reshare();
    reachable.clear();

    const restarted = await boot();

    await expect(unsealWithAgents(restarted.masterKey)).rejects.toThrow('master key is sealed');
  });

  it('members deregistered to 0: the built-in member takes over from its standby copy and becomes the sole holder', async () => {
    const { masterKey } = await boot();
    const original = await masterKey.current();

    addMember('n1');
    await masterKey.reshare();
    const held = await masterKey.current();

    // Abrupt loss of every member, then the CP restarts (no graceful re-share could run).
    data.rows(NodeEntity).splice(0);

    const restarted = await boot();
    const opened = await restarted.masterKey.unseal();

    expect(opened.value.equals(held.value)).toBe(true);
    expect(opened.value.equals(original.value)).toBe(false);

    await restarted.masterKey.current();
    // `current()` re-shared to the built-in member as the sole holder.
    expect(activeKey().holders.map((h) => h.node)).toEqual([BUILTIN_HOLDER]);
    expect(activeKey().builtinStandby).toBeNull();
  });

  it('a member marked `left` counts as deregistered too', async () => {
    const { masterKey } = await boot();

    await masterKey.current();
    addMember('n1');
    await masterKey.reshare();
    data.rows(NodeEntity)[0]['lifecycle'] = 'left';

    const restarted = await boot();

    await expect(restarted.masterKey.unseal()).resolves.toMatchObject({ id: activeKey().id });
  });

  it('adds the standby copy to a key the members already held (no re-key)', async () => {
    addMember('n1');
    const off = await boot({ LOADWEAVER_BUILTIN_MEMBER: 'off', LOADWEAVER_BUILTIN_MEMBER_DIR: dir });
    const key = await off.masterKey.current();

    expect(activeKey().builtinStandby).toBeNull();

    const { masterKey } = await boot();

    masterKey['key'] = key;
    expect(await masterKey.reshare()).toBe(false);
    expect(activeKey().id).toBe(key.id);
    expect(activeKey().builtinStandby).toMatchObject({ holder: BUILTIN_HOLDER });
  });

  it('`always`: a share holder next to the members, plus the standby copy', async () => {
    addMember('n1');
    addMember('n2');
    const { masterKey } = await boot({ LOADWEAVER_BUILTIN_MEMBER: 'always', LOADWEAVER_BUILTIN_MEMBER_DIR: dir });

    await masterKey.current();
    expect(
      activeKey()
        .holders.map((h) => h.node)
        .sort(),
    ).toEqual([BUILTIN_HOLDER, 'n1', 'n2']);
    expect(activeKey()).toMatchObject({ threshold: 2 });
    expect(activeKey().builtinStandby).not.toBeNull();
    expect((await masterKey.builtinRole()).role).toBe('participant');
  });

  it('`off` keeps the old behaviour: no holder without members', async () => {
    const { masterKey, builtin } = await boot({ LOADWEAVER_BUILTIN_MEMBER: 'off', LOADWEAVER_BUILTIN_MEMBER_DIR: dir });

    await expect(masterKey.current()).rejects.toThrow('no control-plane member can hold a master-key share yet');
    expect((await builtin.status()).state).toBe('off');
    expect(data.rows(BuiltinMemberEntity)).toHaveLength(0);
  });

  it('never replaces a registered key that holds the master key (key-mismatch guard)', async () => {
    const { masterKey } = await boot();

    await masterKey.current();
    const registered = data.rows(BuiltinMemberEntity)[0]['sealPublicKey'];

    // The state volume was replaced: a new key file.
    writeFileSync(join(dir, 'builtin-seal.key'), `${generateSealKeyPair().privateKey}\n`, { mode: 0o600 });

    const replaced = await boot();

    expect((await replaced.builtin.status()).state).toBe('key-mismatch');
    expect(data.rows(BuiltinMemberEntity)[0]['sealPublicKey']).toBe(registered);
    await expect(replaced.masterKey.current()).rejects.toThrow('master key is sealed');
    expect(
      masterKeyInboxItems(await replaced.builtin.status(), await replaced.masterKey.builtinRole(), false)[0],
    ).toMatchObject({ severity: 'critical', kind: 'master-key' });
  });

  it('re-registers a new key when the old one held nothing', async () => {
    await boot();
    writeFileSync(join(dir, 'builtin-seal.key'), `${generateSealKeyPair().privateKey}\n`, { mode: 0o600 });

    const { builtin } = await boot();

    expect((await builtin.status()).state).toBe('ok');
  });

  it('reports a missing operator-managed key file instead of generating one', async () => {
    const { builtin } = await boot({ LOADWEAVER_BUILTIN_SEAL_KEY_FILE: join(dir, 'missing.key') });

    expect((await builtin.status()).state).toBe('missing-key');
    expect(data.rows(BuiltinMemberEntity)).toHaveLength(0);
  });

  describe('while the cluster database is read-only (3.43 fallback)', () => {
    afterEach(() => databaseTarget.reset());

    it('stays available with its registration in memory and writes it once the database takes writes', async () => {
      databaseTarget.setFallback(true);

      const { builtin } = await boot();
      const status = await builtin.status();

      expect(status.state).toBe('ok');
      expect(status.lastSeenAt).not.toBeNull();
      expect(data.rows(BuiltinMemberEntity)).toHaveLength(0);

      // The heartbeat only touches memory while read-only.
      await builtin.touch();
      expect(data.rows(BuiltinMemberEntity)).toHaveLength(0);

      databaseTarget.setFallback(false);
      await builtin.touch();
      expect(data.rows(BuiltinMemberEntity)).toEqual([
        expect.objectContaining({ id: 'control-plane', mode: 'auto', sealPublicKey: expect.any(String) }),
      ]);
      expect((await builtin.status()).state).toBe('ok');
    });

    it('defers a write Postgres refuses as read-only (race with the fallback) instead of becoming unavailable', async () => {
      await boot();
      const repo = data.getRepository(BuiltinMemberEntity);
      const update = repo.update.bind(repo);

      repo.update = async () => {
        throw Object.assign(new Error('cannot execute UPDATE in a read-only transaction'), { code: '25006' });
      };

      const { builtin } = await boot();

      expect((await builtin.status()).state).toBe('ok');

      repo.update = update;
      await builtin.touch();
      expect((await builtin.status()).state).toBe('ok');
    });

    it('keeps the key-mismatch guard from what it can read, and 0 members still unseal from the built-in key', async () => {
      const first = await boot();
      const created = await first.masterKey.current();

      databaseTarget.setFallback(true);

      // Same key: the r = 0 rule (3.39) unseals through the built-in member although nothing can be written.
      const restarted = await boot();

      expect((await restarted.builtin.status()).state).toBe('ok');
      expect((await restarted.masterKey.current()).value.equals(created.value)).toBe(true);

      writeFileSync(join(dir, 'builtin-seal.key'), `${generateSealKeyPair().privateKey}\n`, { mode: 0o600 });

      const replaced = await boot();

      expect((await replaced.builtin.status()).state).toBe('key-mismatch');
    });

    it('recognizes read-only refusals', () => {
      expect(isReadOnlyError(Object.assign(new Error('x'), { code: '25006' }))).toBe(true);
      expect(isReadOnlyError(new Error('cannot execute INSERT in a read-only transaction'))).toBe(true);
      expect(isReadOnlyError(new Error('connection refused'))).toBe(false);
    });
  });

  it('never writes the private seal key into the database', async () => {
    const { masterKey } = await boot();

    await masterKey.current();
    addMember('n1');
    await masterKey.reshare();

    const privateKey = readFileSync(join(dir, 'builtin-seal.key'), 'utf8').trim();
    const everything = JSON.stringify([...data.tables.values()].map((t) => t.rows));

    expect(everything).not.toContain(privateKey);
  });

  it('inbox: warning as sole holder, quiet info while on standby, nothing with a KMS', () => {
    const ok = { state: 'ok' as const };

    expect(masterKeyInboxItems(ok, { role: 'active', holder: true, standby: false, realMembers: 0 }, false)).toEqual([
      expect.objectContaining({ severity: 'warning', title: expect.stringContaining('only one key holder') }),
    ]);
    expect(masterKeyInboxItems(ok, { role: 'standby', holder: false, standby: true, realMembers: 2 }, false)).toEqual([
      expect.objectContaining({ severity: 'info', title: expect.stringContaining('standby copy') }),
    ]);
    expect(masterKeyInboxItems(ok, { role: 'active', holder: false, standby: false, realMembers: 0 }, true)).toEqual(
      [],
    );
  });
});
