import {
  IdentityAppAuthorizationCodeEntity,
  IdentityAppEntity,
  IdentityAppGrantEntity,
  IdentityAppSessionEntity,
  UserEntity,
} from '@forepath/identity/backend';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

export interface IdentityAppGrantWithRelations {
  grant: IdentityAppGrantEntity;
  app: IdentityAppEntity;
  user: UserEntity;
  sessionCount: number;
  lastSessionUsedAt: Date | null;
}

/**
 * Persistence for apps, grants, sessions and authorization codes.
 * Every app lookup is tenant-scoped; grants/sessions/codes are reached through their app.
 */
@Injectable()
export class IdentityAppsRepository {
  constructor(
    @InjectRepository(IdentityAppEntity)
    private readonly apps: Repository<IdentityAppEntity>,
    @InjectRepository(IdentityAppGrantEntity)
    private readonly grants: Repository<IdentityAppGrantEntity>,
    @InjectRepository(IdentityAppSessionEntity)
    private readonly sessions: Repository<IdentityAppSessionEntity>,
    @InjectRepository(IdentityAppAuthorizationCodeEntity)
    private readonly codes: Repository<IdentityAppAuthorizationCodeEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  // --- apps ---

  async createApp(data: Partial<IdentityAppEntity>): Promise<IdentityAppEntity> {
    return this.apps.save(this.apps.create(data));
  }

  async saveApp(app: IdentityAppEntity): Promise<IdentityAppEntity> {
    return this.apps.save(app);
  }

  async findAppForTenant(id: string, tenantId: string): Promise<IdentityAppEntity | null> {
    return this.apps.findOne({ where: { id, tenantId } });
  }

  async findAppById(id: string): Promise<IdentityAppEntity | null> {
    return this.apps.findOne({ where: { id } });
  }

  async listAppsForTenant(tenantId: string): Promise<IdentityAppEntity[]> {
    return this.apps.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  async deleteApp(id: string): Promise<void> {
    await this.apps.delete({ id });
  }

  async countGrantsByApp(appIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    if (appIds.length === 0) {
      return counts;
    }

    const rows = await this.grants
      .createQueryBuilder('grant')
      .select('grant.appId', 'appId')
      .addSelect('COUNT(*)', 'count')
      .where('grant.appId IN (:...appIds)', { appIds })
      .groupBy('grant.appId')
      .getRawMany<{ appId: string; count: string }>();

    for (const row of rows) {
      counts.set(row.appId, Number(row.count));
    }

    return counts;
  }

  // --- grants ---

  async findGrant(appId: string, userId: string): Promise<IdentityAppGrantEntity | null> {
    return this.grants.findOne({ where: { appId, userId } });
  }

  async findGrantById(id: string): Promise<IdentityAppGrantEntity | null> {
    return this.grants.findOne({ where: { id } });
  }

  /** Insert or replace the consented scopes for (app, user). */
  async upsertGrant(data: {
    appId: string;
    userId: string;
    tenantId: string;
    scopes: string[];
  }): Promise<IdentityAppGrantEntity> {
    const existing = await this.findGrant(data.appId, data.userId);

    if (existing) {
      existing.scopes = [...data.scopes];

      return this.grants.save(existing);
    }

    try {
      return await this.grants.save(this.grants.create(data));
    } catch (error) {
      // Concurrent consent for the same (app, user): the unique index won, update that row instead.
      const raced = await this.findGrant(data.appId, data.userId);

      if (!raced) {
        throw error;
      }

      raced.scopes = [...data.scopes];

      return this.grants.save(raced);
    }
  }

  async deleteGrant(id: string): Promise<boolean> {
    const result = await this.grants.delete({ id });

    return (result.affected ?? 0) > 0;
  }

  async deleteGrantsByApp(appId: string): Promise<number> {
    const result = await this.grants.delete({ appId });

    return result.affected ?? 0;
  }

  async touchGrantLastUsed(id: string, at: Date): Promise<void> {
    await this.grants.update({ id }, { lastUsedAt: at });
  }

  async listGrantsForApp(appId: string): Promise<IdentityAppGrantWithRelations[]> {
    const grants = await this.grants.find({ where: { appId }, order: { createdAt: 'DESC' } });

    return this.withRelations(grants);
  }

  async listGrantsForUser(userId: string, tenantId: string): Promise<IdentityAppGrantWithRelations[]> {
    const grants = await this.grants.find({ where: { userId, tenantId }, order: { createdAt: 'DESC' } });

    return this.withRelations(grants);
  }

  private async withRelations(grants: IdentityAppGrantEntity[]): Promise<IdentityAppGrantWithRelations[]> {
    if (grants.length === 0) {
      return [];
    }

    const appIds = [...new Set(grants.map((grant) => grant.appId))];
    const userIds = [...new Set(grants.map((grant) => grant.userId))];
    const grantIds = grants.map((grant) => grant.id);
    const [apps, users, sessionRows] = await Promise.all([
      this.apps.createQueryBuilder('app').where('app.id IN (:...appIds)', { appIds }).getMany(),
      this.users.createQueryBuilder('user').where('user.id IN (:...userIds)', { userIds }).getMany(),
      this.sessions
        .createQueryBuilder('session')
        .select('session.grantId', 'grantId')
        .addSelect('COUNT(*)', 'count')
        .addSelect('MAX(session.lastUsedAt)', 'lastUsedAt')
        .where('session.grantId IN (:...grantIds)', { grantIds })
        .groupBy('session.grantId')
        .getRawMany<{ grantId: string; count: string; lastUsedAt: Date | string | null }>(),
    ]);
    const appsById = new Map(apps.map((app) => [app.id, app]));
    const usersById = new Map(users.map((user) => [user.id, user]));
    const sessionsByGrant = new Map(sessionRows.map((row) => [row.grantId, row]));
    const result: IdentityAppGrantWithRelations[] = [];

    for (const grant of grants) {
      const app = appsById.get(grant.appId);
      const user = usersById.get(grant.userId);

      if (!app || !user) {
        continue;
      }

      const sessions = sessionsByGrant.get(grant.id);

      result.push({
        grant,
        app,
        user,
        sessionCount: sessions ? Number(sessions.count) : 0,
        lastSessionUsedAt: sessions?.lastUsedAt ? new Date(sessions.lastUsedAt) : null,
      });
    }

    return result;
  }

  // --- authorization codes ---

  async createCode(data: Partial<IdentityAppAuthorizationCodeEntity>): Promise<IdentityAppAuthorizationCodeEntity> {
    return this.codes.save(this.codes.create(data));
  }

  async findCodeByHash(codeHash: string): Promise<IdentityAppAuthorizationCodeEntity | null> {
    return this.codes.findOne({ where: { codeHash } });
  }

  /** Atomically mark a code consumed; false when it was already consumed (replay). */
  async consumeCode(id: string, at: Date): Promise<boolean> {
    const result = await this.codes.update({ id, consumedAt: IsNull() }, { consumedAt: at });

    return (result.affected ?? 0) > 0;
  }

  async setCodeSession(id: string, sessionId: string): Promise<void> {
    await this.codes.update({ id }, { sessionId });
  }

  async deleteExpiredCodes(before: Date): Promise<void> {
    await this.codes.createQueryBuilder().delete().where('expires_at < :before', { before }).execute();
  }

  // --- sessions ---

  async createSession(data: Partial<IdentityAppSessionEntity>): Promise<IdentityAppSessionEntity> {
    return this.sessions.save(this.sessions.create(data));
  }

  async findSessionById(id: string): Promise<IdentityAppSessionEntity | null> {
    return this.sessions.findOne({ where: { id } });
  }

  async findSessionByRefreshHash(refreshTokenHash: string): Promise<IdentityAppSessionEntity | null> {
    return this.sessions.findOne({ where: { refreshTokenHash } });
  }

  async findSessionByPreviousRefreshHash(previousRefreshTokenHash: string): Promise<IdentityAppSessionEntity | null> {
    return this.sessions.findOne({ where: { previousRefreshTokenHash } });
  }

  /** Atomically rotate the refresh token; false when another request rotated it first. */
  async rotateSessionRefreshToken(id: string, expectedHash: string, nextHash: string, at: Date): Promise<boolean> {
    const result = await this.sessions.update(
      { id, refreshTokenHash: expectedHash },
      { refreshTokenHash: nextHash, previousRefreshTokenHash: expectedHash, refreshedAt: at, lastUsedAt: at },
    );

    return (result.affected ?? 0) > 0;
  }

  async deleteSession(id: string): Promise<void> {
    await this.sessions.delete({ id });
  }

  async touchSessionLastUsed(id: string, at: Date): Promise<void> {
    await this.sessions.update({ id }, { lastUsedAt: at });
  }
}
