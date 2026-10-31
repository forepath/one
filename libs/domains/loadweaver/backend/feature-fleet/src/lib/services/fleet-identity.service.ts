import { createPrivateKey, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';

import { UserEntity } from '@forepath/identity/backend';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FleetSigningKeyEntity, type FleetSigningKeyState } from '../entities/fleet-signing-key.entity';
import type { FleetCaller, FleetClusterAccess } from '../utils/fleet-access.utils';
import { fleetKeyFingerprint, mintFleetClaim, type FleetClaimInput } from '../utils/fleet-identity-claims';
import { FleetAuditService } from './fleet-audit.service';

const KEY_CACHE_MS = 30_000;
const USER_CACHE_MS = 60_000;

export interface FleetIdentityKeyDto {
  kid: string;
  state: FleetSigningKeyState;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
}

/** What a cluster registers under "trusted fleets" (2026-10-29): the issuer, a name and the keys that may sign. */
export interface FleetRegistration {
  issuer: string;
  name: string;
  /** The active key first, then a `next` key waiting for activation (registered ahead, so activating breaks nothing). */
  keys: { kid: string; publicKey: string; fingerprint: string }[];
}

/** Subject of the fleet's own claims when nobody triggered them (automatic trust after a health check). */
export const FLEET_SYSTEM_SUBJECT = 'fleet-system';

/** What a cluster admin registers under "trusted fleets": the issuer and the public keys. */
export interface FleetIdentityDto {
  issuer: string;
  keys: FleetIdentityKeyDto[];
}

function toKeyDto(k: FleetSigningKeyEntity): FleetIdentityKeyDto {
  return {
    kid: k.kid,
    state: k.state,
    publicKey: k.publicKey,
    fingerprint: fleetKeyFingerprint(k.publicKey),
    createdAt: k.createdAt.toISOString(),
    activatedAt: k.activatedAt?.toISOString() ?? null,
    retiredAt: k.retiredAt?.toISOString() ?? null,
  };
}

function newKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/**
 * The fleet's signing identity (3.24): Ed25519 keys (created on first use, private keys sealed), rotation (a `next`
 * key to register in the clusters, then activate it), and the per-request identity claims of fleet users.
 */
@Injectable()
export class FleetIdentityService {
  private readonly logger = new Logger(FleetIdentityService.name);
  private active: { at: number; kid: string; issuer: string; key: KeyObject } | null = null;
  private readonly users = new Map<string, { at: number; email: string | null; verified: boolean }>();

  constructor(
    @InjectRepository(FleetSigningKeyEntity) private readonly keys: Repository<FleetSigningKeyEntity>,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    private readonly audit: FleetAuditService,
  ) {}

  /** The fleet's issuer id: `FLEET_IDENTITY_ISSUER`, else the one of the first key (`fleet-<uuid>`). */
  async issuer(): Promise<string> {
    return (await this.signingKey()).issuer;
  }

  /** The active key (created on first use; a concurrent first use on another replica wins, this one re-reads). */
  private async signingKey(): Promise<{ kid: string; issuer: string; key: KeyObject }> {
    if (this.active && Date.now() - this.active.at < KEY_CACHE_MS) return this.active;

    let row = await this.keys.findOne({ where: { state: 'active' } });

    if (!row) {
      const pair = newKeyPair();
      const existing = await this.keys.findOne({ where: {}, order: { createdAt: 'ASC' } });
      const issuer = existing?.issuer ?? process.env['FLEET_IDENTITY_ISSUER']?.trim() ?? `fleet-${randomUUID()}`;

      try {
        row = await this.keys.save(
          this.keys.create({
            kid: randomUUID(),
            issuer: issuer || `fleet-${randomUUID()}`,
            ...pair,
            state: 'active',
            activatedAt: new Date(),
            retiredAt: null,
          }),
        );
        this.logger.log(`Created the fleet identity key ${row.kid} (issuer ${row.issuer})`);
      } catch {
        row = await this.keys.findOne({ where: { state: 'active' } });
      }
    }

    if (!row) throw new Error('no fleet identity key');

    this.active = { at: Date.now(), kid: row.kid, issuer: row.issuer, key: createPrivateKey(row.privateKey) };

    return this.active;
  }

  async describe(): Promise<FleetIdentityDto> {
    const { issuer } = await this.signingKey();
    const rows = await this.keys.find({ order: { createdAt: 'ASC' } });

    return { issuer, keys: rows.map(toKeyDto) };
  }

  /** Creates the `next` key (to register in the clusters before it is activated). */
  async createNext(caller: FleetCaller): Promise<FleetIdentityDto> {
    const { issuer } = await this.signingKey();

    if (await this.keys.exists({ where: { state: 'next' } }))
      throw new ConflictException('a next key exists already: activate it first');

    const row = await this.keys.save(
      this.keys.create({
        kid: randomUUID(),
        issuer,
        ...newKeyPair(),
        state: 'next',
        activatedAt: null,
        retiredAt: null,
      }),
    );

    await this.audit.record(caller, 'identity.key-created', `identity/key/${row.kid}`, {
      fingerprint: fleetKeyFingerprint(row.publicKey),
    });

    return await this.describe();
  }

  /** The `next` key signs from now on; the previous active key is retired (clusters may drop it afterwards). */
  async activate(caller: FleetCaller, kid: string): Promise<FleetIdentityDto> {
    const next = await this.keys.findOne({ where: { kid } });

    if (!next || next.state !== 'next') throw new NotFoundException('no such next key');

    const now = new Date();

    await this.keys.manager.transaction(async (manager) => {
      const repo = manager.getRepository(FleetSigningKeyEntity);

      await repo.update({ state: 'active' }, { state: 'retired', retiredAt: now });
      await repo.update({ kid }, { state: 'active', activatedAt: now });
    });
    this.active = null;
    await this.audit.record(caller, 'identity.key-activated', `identity/key/${kid}`, {
      fingerprint: fleetKeyFingerprint(next.publicKey),
    });

    return await this.describe();
  }

  /**
   * The fleet's own registration in a cluster (2026-10-29): issuer, name (`FLEET_IDENTITY_NAME`, default
   * "Loadweaver fleet") and the keys that sign now or next — always this fleet's keys from its own store, never
   * anything a browser sent.
   */
  async registration(): Promise<FleetRegistration> {
    const { issuer } = await this.signingKey();
    const rows = await this.keys.find({ order: { createdAt: 'ASC' } });
    const pick = (state: FleetSigningKeyState) => rows.filter((k) => k.state === state);

    return {
      issuer,
      name: process.env['FLEET_IDENTITY_NAME']?.trim().slice(0, 255) || 'Loadweaver fleet',
      keys: [...pick('active'), ...pick('next')].map((k) => ({
        kid: k.kid,
        publicKey: k.publicKey.trim(),
        fingerprint: fleetKeyFingerprint(k.publicKey),
      })),
    };
  }

  /**
   * The proof for registering this fleet in a cluster (2026-10-29): a claim signed with the active key (which is
   * among the registered ones), bound to the cluster, `PUT /api/trusted-fleets/<issuer>` and the exact body, with
   * the acting fleet admin (or {@link FLEET_SYSTEM_SUBJECT}) as the person the cluster audits.
   */
  async registrationClaim(caller: FleetCaller | null, audience: string, url: string, body: Buffer): Promise<string> {
    const { kid, issuer, key } = await this.signingKey();
    const user = caller?.userId && !caller.isApiKey ? await this.userEmail(caller.userId) : null;

    return mintFleetClaim(key, kid, {
      issuer,
      audience,
      subject: caller?.userId && !caller.isApiKey ? caller.userId : FLEET_SYSTEM_SUBJECT,
      email: user?.email ?? null,
      emailVerified: user?.verified ?? false,
      role: 'admin',
      method: 'PUT',
      url,
      body,
    });
  }

  /** The caller's email as the fleet knows it, and whether it was confirmed (or comes from the identity provider). */
  private async userEmail(userId: string): Promise<{ email: string | null; verified: boolean }> {
    const cached = this.users.get(userId);

    if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached;

    const user = await this.userRepo.findOne({ where: { id: userId } });
    const entry = {
      at: Date.now(),
      email: user?.email?.trim().toLowerCase() || null,
      verified: !!user && (!!user.emailConfirmedAt || !!user.keycloakSub),
    };

    this.users.set(userId, entry);

    return entry;
  }

  /** The acting person's id at a cluster that trusts this fleet. */
  async personFor(caller: FleetCaller): Promise<string | null> {
    return caller.userId ? `fleet:${await this.issuer()}:${caller.userId}` : null;
  }

  /**
   * A claim for one relayed request of a user (none for the static API key: there is no person), bound to the
   * cluster (`audience` = its `clusterId`), the request and its body; the fleet grant goes along (the cluster caps
   * it by its service user's roles).
   */
  async claimFor(
    caller: FleetCaller,
    access: FleetClusterAccess,
    request: Pick<FleetClaimInput, 'audience' | 'method' | 'url' | 'body' | 'bodyBinding'>,
  ): Promise<string | null> {
    if (!caller.userId || caller.isApiKey) return null;

    const { kid, issuer, key } = await this.signingKey();
    const { email, verified } = await this.userEmail(caller.userId);

    return mintFleetClaim(key, kid, {
      ...request,
      issuer,
      subject: caller.userId,
      email,
      emailVerified: verified,
      role: access.clusterRole,
      projects: Object.fromEntries(access.projects),
    });
  }

  /** The fleet's own probe claim for `GET /api/fleet-identity` (feature detection + trust check). */
  async probeClaim(audience: string): Promise<string> {
    const { kid, issuer, key } = await this.signingKey();

    return mintFleetClaim(key, kid, {
      issuer,
      audience,
      subject: 'fleet-probe',
      role: 'viewer',
      method: 'GET',
      url: '/api/fleet-identity',
    });
  }
}
