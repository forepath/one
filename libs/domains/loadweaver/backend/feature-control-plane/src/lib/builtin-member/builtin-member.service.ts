import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

import { generateSealKeyPair, openSealed, sealPublicKey } from '@forepath/loadweaver/shared/util-secrets';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { databaseTarget } from '../database-handover/database-target.runtime';
import { BuiltinMemberEntity } from '../entities/builtin-member.entity';
import { MasterKeyEntity } from '../entities/master-key.entity';
import {
  BUILTIN_HOLDER,
  BUILTIN_MEMBER_ID,
  builtinMemberMode,
  builtinSealKeyPath,
  type BuiltinMemberMode,
} from '../utils/builtin-member.utils';

/**
 * - `ok`: this process holds the registered seal key;
 * - `off`: `LOADWEAVER_BUILTIN_MEMBER=off` (old behaviour; member CPs on nodes always run with `off`);
 * - `key-mismatch`: the key file differs from the registered key while that key holds the master key (never replaced
 *   silently: mount the original state volume);
 * - `missing-key`: the operator-managed `LOADWEAVER_BUILTIN_SEAL_KEY_FILE` doesn't exist / can't be read;
 * - `error`: the state directory isn't writable / the key can't be loaded.
 */
export type BuiltinMemberState = 'ok' | 'off' | 'key-mismatch' | 'missing-key' | 'error';

export interface BuiltinMemberStatus {
  mode: BuiltinMemberMode;
  state: BuiltinMemberState;
  /** Why the state isn't `ok` (no paths to key material beyond the configured file name). */
  reason: string | null;
  instance: string | null;
  lastSeenAt: string | null;
}

/** The public key the cluster seals the built-in holder's share / standby copy to, and the mode it was registered in. */
export interface BuiltinSealTarget {
  publicKey: string;
  mode: BuiltinMemberMode;
}

const HEARTBEAT_MS = 60_000;

/**
 * The built-in control-plane member (3.39): an X25519 seal key in a file on the control-plane state volume
 * (`LOADWEAVER_BUILTIN_MEMBER_DIR`, 0600 in a 0700 directory) or an operator-managed file
 * (`LOADWEAVER_BUILTIN_SEAL_KEY_FILE`); only the public key is registered (`lw_builtin_members`). `MasterKeyService`
 * decides when it holds a share or the standby copy; this service only owns the key and opens what was sealed to it.
 */
@Injectable()
export class BuiltinMemberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BuiltinMemberService.name);
  private initializing: Promise<void> | null = null;
  private privateKey: string | null = null;
  private publicKey: string | null = null;
  private mode: BuiltinMemberMode = 'off';
  private state: BuiltinMemberState = 'off';
  private reason: string | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  /**
   * A registration (or the `off` mark) the cluster database couldn't take because it was read-only (3.43 fallback):
   * kept in memory, so the member stays available (takeover, master key), and written on the first heartbeat once the
   * database takes writes again.
   */
  private pending: 'register' | 'off' | null = null;
  /** Heartbeats while `pending` / read-only (the row's `last_seen_at` can't be written then). */
  private lastSeenInMemory: Date | null = null;

  /** Configuration source (tests replace it before the first `ready()`). */
  env: NodeJS.ProcessEnv = process.env;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ready();

    if (this.state === 'ok' || this.pending) {
      this.heartbeat = setInterval(() => void this.touch().catch(() => undefined), HEARTBEAT_MS);
      this.heartbeat.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  /** Loads / generates the key and registers it (once); safe to await from anything that needs the master key. */
  async ready(): Promise<void> {
    this.initializing ??= this.init().catch((error: unknown) => {
      this.state = 'error';
      this.reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Built-in control-plane member unavailable: ${this.reason}`);
    });

    await this.initializing;
  }

  private async init(): Promise<void> {
    this.mode = builtinMemberMode(this.env);

    const { file, managed } = builtinSealKeyPath(this.env);

    if (this.mode === 'off') {
      this.state = 'off';
      // The owner of a registered key switched it off: mark the row so no replica seals to it any more. Member CPs on
      // nodes (also `off`) have no key file, so they never touch the standalone control plane's row.
      const existing = await this.readKey(file).catch(() => null);

      if (existing) {
        this.privateKey = existing;
        this.publicKey = sealPublicKey(existing);
        await this.writeOrDefer('off', async () => await this.markOff());
      }

      return;
    }

    let key = await this.readKey(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;

      throw error;
    });

    if (!key) {
      if (managed) {
        this.state = 'missing-key';
        this.reason = 'the seal key file set in LOADWEAVER_BUILTIN_SEAL_KEY_FILE does not exist';
        this.logger.error(`Built-in control-plane member: ${this.reason}`);

        return;
      }

      key = await this.generate(file);
    }

    this.privateKey = key;
    this.publicKey = sealPublicKey(key);
    await this.register();
  }

  private async readKey(file: string): Promise<string> {
    const info = await stat(file);

    if ((info.mode & 0o077) !== 0)
      this.logger.warn(`The built-in member's seal key file is readable by group / others; it should be 0600`);

    const text = (await readFile(file, 'utf8')).trim();

    // Validates the key (throws on garbage) without logging it.
    sealPublicKey(text);

    return text;
  }

  /** Written atomically: 0700 directory, 0600 temp file, rename. */
  private async generate(file: string): Promise<string> {
    const dir = dirname(file);
    const pair = generateSealKeyPair();
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => undefined);

    try {
      await writeFile(tmp, `${pair.privateKey}\n`, { mode: 0o600, flag: 'wx' });
      await chmod(tmp, 0o600);
      await rename(tmp, file);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }

    this.logger.log('Generated the built-in control-plane member seal key');

    return pair.privateKey;
  }

  private async markOff(): Promise<void> {
    await this.dataSource
      .getRepository(BuiltinMemberEntity)
      .update(
        { id: BUILTIN_MEMBER_ID, sealPublicKey: this.publicKey as string },
        { mode: 'off', lastSeenAt: new Date() },
      );
  }

  /**
   * Runs a write, or — while the cluster database can't take writes (3.43 read-only fallback, also a write refused
   * as read-only in a race) — remembers it for the next heartbeat. False: deferred.
   */
  private async writeOrDefer(kind: 'register' | 'off', write: () => Promise<void>): Promise<boolean> {
    if (databaseTarget.writesBlocked()) return this.defer(kind);

    try {
      await write();

      return true;
    } catch (error) {
      if (isReadOnlyError(error)) return this.defer(kind);

      throw error;
    }
  }

  private defer(kind: 'register' | 'off'): false {
    if (!this.pending)
      this.logger.log(
        `Built-in control-plane member: the cluster database is read-only; ${kind === 'off' ? 'the off mark' : 'its registration'} is kept in memory until it takes writes again`,
      );

    this.pending = kind;
    this.lastSeenInMemory = new Date();

    return false;
  }

  /**
   * Registers the public key. A different registered key is never replaced while it holds the active master key (as
   * share or standby copy): that would lock the key out. Then the state is `key-mismatch` (critical inbox item).
   * While the cluster database is read-only the decision is made from what can be read and the write waits
   * (`pending`): the member stays `ok`, its key opens what was sealed to it (3.39 rules unchanged).
   */
  private async register(): Promise<void> {
    if (databaseTarget.writesBlocked()) return await this.registerReadOnly();

    try {
      await this.registerWritable();
    } catch (error) {
      if (!isReadOnlyError(error)) throw error;

      await this.registerReadOnly();
    }
  }

  private async registerReadOnly(): Promise<void> {
    const publicKey = this.publicKey as string;
    const row = await this.dataSource
      .getRepository(BuiltinMemberEntity)
      .findOne({ where: { id: BUILTIN_MEMBER_ID } })
      .catch(() => null);

    if (
      row &&
      row.sealPublicKey !== publicKey &&
      (await keyInUse(this.dataSource.manager, row.sealPublicKey).catch(() => false))
    ) {
      this.mismatch();

      return;
    }

    this.state = 'ok';
    this.reason = null;
    this.defer('register');
  }

  private mismatch(): void {
    this.state = 'key-mismatch';
    this.reason = 'the seal key on the state volume differs from the registered one, which holds the master key';
    this.logger.error(
      `Built-in control-plane member: ${this.reason}. Mount the original control-plane state volume (or the original LOADWEAVER_BUILTIN_SEAL_KEY_FILE); the registered key is kept.`,
    );
  }

  private async registerWritable(): Promise<void> {
    const publicKey = this.publicKey as string;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(BuiltinMemberEntity);
      const row = await repo.findOne({ where: { id: BUILTIN_MEMBER_ID } });
      const now = new Date();

      if (!row) {
        await repo.insert({
          id: BUILTIN_MEMBER_ID,
          sealPublicKey: publicKey,
          mode: this.mode,
          instance: hostname(),
          lastSeenAt: now,
        });
        this.state = 'ok';

        return;
      }

      if (row.sealPublicKey !== publicKey && (await keyInUse(manager, row.sealPublicKey))) {
        this.mismatch();

        return;
      }

      if (row.sealPublicKey !== publicKey)
        this.logger.warn('Built-in control-plane member: registered a new seal key (the old one held no master key)');

      await repo.update(
        { id: BUILTIN_MEMBER_ID },
        { sealPublicKey: publicKey, mode: this.mode, instance: hostname(), lastSeenAt: now },
      );
      this.state = 'ok';
    });
  }

  /** The heartbeat: `last_seen_at`, in memory while read-only; a deferred registration is written first. */
  async touch(): Promise<void> {
    if (!this.publicKey) return;

    if (databaseTarget.writesBlocked()) {
      if (this.state === 'ok' || this.pending) this.lastSeenInMemory = new Date();

      return;
    }

    if (this.pending) {
      const kind = this.pending;

      this.pending = null;

      try {
        if (kind === 'off') await this.writeOrDefer('off', async () => await this.markOff());
        else await this.register();
      } catch (error) {
        this.pending = kind;
        throw error;
      }

      if (!this.pending) {
        this.lastSeenInMemory = null;
        this.logger.log(`Built-in control-plane member: ${kind === 'off' ? 'off mark' : 'registration'} written`);
      }

      return;
    }

    if (this.state !== 'ok') return;

    await this.dataSource
      .getRepository(BuiltinMemberEntity)
      .update({ id: BUILTIN_MEMBER_ID, sealPublicKey: this.publicKey }, { lastSeenAt: new Date() })
      .catch((error: unknown) => {
        if (!isReadOnlyError(error)) throw error;

        this.lastSeenInMemory = new Date();
      });
  }

  /**
   * The key the cluster seals to: the registered row unless it was switched off. Any replica can seal to it (also one
   * without the private key, e.g. on a mismatch the original key keeps receiving the copy until the volume is back).
   */
  async sealTarget(manager: EntityManager = this.dataSource.manager): Promise<BuiltinSealTarget | null> {
    await this.ready();

    // The key's owner switched it off. (A member CP on a node is `off` without a key file: it follows the registered
    // row, so a re-share it runs keeps the standby copy in sync although it can't open anything.)
    if (this.mode === 'off' && this.publicKey !== null) return null;

    const row = await manager.getRepository(BuiltinMemberEntity).findOne({ where: { id: BUILTIN_MEMBER_ID } });

    if (!row || row.mode === 'off') return null;

    return { publicKey: row.sealPublicKey, mode: row.mode === 'always' ? 'always' : 'auto' };
  }

  /** Whether this process can open what was sealed to `publicKey`. */
  canOpen(publicKey: string | undefined): boolean {
    return !!this.privateKey && !!publicKey && publicKey === this.publicKey;
  }

  /** Opens a share / standby copy sealed to this member (in memory only; the caller zeroes it). */
  open(sealed: string, aad: string): Buffer {
    if (!this.privateKey) throw new Error('the built-in control-plane member has no seal key');

    return openSealed(this.privateKey, Buffer.from(sealed, 'base64'), aad);
  }

  async status(): Promise<BuiltinMemberStatus> {
    await this.ready();

    const row = await this.dataSource
      .getRepository(BuiltinMemberEntity)
      .findOne({ where: { id: BUILTIN_MEMBER_ID } })
      .catch(() => null);

    const seen = [row?.lastSeenAt ?? null, this.lastSeenInMemory].filter((d): d is Date => !!d);
    const lastSeen = seen.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null;

    return {
      mode: this.mode,
      state: this.state,
      reason: this.reason,
      instance: row?.instance ?? (this.pending ? hostname() : null),
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
    };
  }
}

/** Postgres' refusal in a read-only transaction / on the read-only external copy (SQLSTATE 25006). */
export function isReadOnlyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const driverCode = (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;

  return (
    code === '25006' ||
    driverCode === '25006' ||
    /read-only transaction/.test(error instanceof Error ? error.message : String(error))
  );
}

/** Whether the active master key has a share or standby copy sealed to `publicKey`. */
async function keyInUse(manager: EntityManager, publicKey: string): Promise<boolean> {
  const active = await manager.getRepository(MasterKeyEntity).findOne({ where: { active: true } });

  if (!active) return false;

  return (
    active.builtinStandby?.publicKey === publicKey ||
    active.holders.some((h) => h.node === BUILTIN_HOLDER && (!h.publicKey || h.publicKey === publicKey))
  );
}
