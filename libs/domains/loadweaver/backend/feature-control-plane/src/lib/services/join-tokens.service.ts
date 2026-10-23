import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { labelsSchema, resourceNameSchema } from '@forepath/loadweaver/shared/util-model';
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import {
  JOIN_TOKEN_DEFAULT_TTL_MINUTES,
  JOIN_TOKEN_LOOKUP_LENGTH,
  JOIN_TOKEN_MAX_TTL_MINUTES,
  JOIN_TOKEN_PREFIX,
} from '../constants/control-plane.constants';
import type { CreateJoinTokenDto, CreatedJoinTokenDto, JoinTokenResponseDto } from '../dto/join-token.dto';
import { JoinTokenEntity } from '../entities/join-token.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { JoinTokensRepository } from '../repositories/join-tokens.repository';
import { AuditLogService, type AuditActor } from './audit-log.service';

const LOOKUP_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function randomLookup(): string {
  const bytes = randomBytes(JOIN_TOKEN_LOOKUP_LENGTH);

  return Array.from(bytes, (b) => LOOKUP_ALPHABET[b % LOOKUP_ALPHABET.length]).join('');
}

/** `lwj_<lookup>.<secret>` → lookup prefix, or null if the format is wrong. */
export function parseJoinToken(token: string): { prefix: string } | null {
  const match = new RegExp(`^${JOIN_TOKEN_PREFIX}([a-z0-9]{${JOIN_TOKEN_LOOKUP_LENGTH}})\\.[A-Za-z0-9_-]{43}$`).exec(
    token,
  );

  return match ? { prefix: `${JOIN_TOKEN_PREFIX}${match[1]}` } : null;
}

export function toJoinTokenResponse(entity: JoinTokenEntity): JoinTokenResponseDto {
  return {
    id: entity.id,
    tokenPrefix: entity.tokenPrefix,
    description: entity.description,
    site: entity.site,
    labels: entity.labels,
    witness: entity.witness,
    expiresAt: entity.expiresAt.toISOString(),
    usedAt: entity.usedAt?.toISOString() ?? null,
    usedByNode: entity.usedByNode,
    revokedAt: entity.revokedAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
  };
}

/**
 * Short-lived, single-use join tokens (3.21). The plaintext is shown once; only its SHA-256 is stored.
 */
@Injectable()
export class JoinTokensService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: JoinTokensRepository,
    private readonly audit: AuditLogService,
  ) {}

  async create(dto: CreateJoinTokenDto, actor: AuditActor): Promise<CreatedJoinTokenDto> {
    const site = resourceNameSchema.safeParse(dto.site ?? 'default');
    const labels = labelsSchema.safeParse(dto.labels ?? {});
    const ttl = dto.ttlMinutes ?? JOIN_TOKEN_DEFAULT_TTL_MINUTES;

    if (!site.success || !labels.success) throw new BadRequestException('invalid site or labels');

    if (!Number.isInteger(ttl) || ttl < 1 || ttl > JOIN_TOKEN_MAX_TTL_MINUTES) {
      throw new BadRequestException(`ttlMinutes must be between 1 and ${JOIN_TOKEN_MAX_TTL_MINUTES}`);
    }

    return await this.dataSource.transaction(async (manager) => {
      const siteExists = await manager
        .getRepository(ResourceEntity)
        .exists({ where: { kind: 'Site', name: site.data, projectKey: '' } });

      if (!siteExists) throw new BadRequestException(`site ${site.data} does not exist`);

      const prefix = `${JOIN_TOKEN_PREFIX}${randomLookup()}`;
      const token = `${prefix}.${randomBytes(32).toString('base64url')}`;
      const repo = manager.getRepository(JoinTokenEntity);
      const entity = await repo.save(
        repo.create({
          tokenPrefix: prefix,
          tokenHash: hashToken(token),
          description: dto.description?.slice(0, 255) ?? null,
          site: site.data,
          labels: labels.data,
          witness: dto.witness ?? false,
          expiresAt: new Date(Date.now() + ttl * 60_000),
          createdBy: actor.id ?? actor.type,
        }),
      );

      await this.audit.record(manager, {
        actor,
        action: 'join-token.create',
        target: `join-token/${entity.id}`,
        details: {
          tokenPrefix: prefix,
          site: site.data,
          witness: entity.witness,
          expiresAt: entity.expiresAt.toISOString(),
        },
      });

      return { ...toJoinTokenResponse(entity), token };
    });
  }

  async listActive(): Promise<JoinTokenResponseDto[]> {
    return (await this.tokens.findActive()).map(toJoinTokenResponse);
  }

  async revoke(id: string, actor: AuditActor): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(JoinTokenEntity);
      const token = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!token) throw new NotFoundException('join token not found');

      if (token.revokedAt || token.usedAt) return;

      token.revokedAt = new Date();
      await repo.save(token);
      await this.audit.record(manager, {
        actor,
        action: 'join-token.revoke',
        target: `join-token/${id}`,
        details: { tokenPrefix: token.tokenPrefix },
      });
    });
  }

  /**
   * Validates and consumes a token inside the join transaction (row lock prevents double use).
   * Every failure yields the same error so tokens can't be probed.
   */
  async consume(manager: EntityManager, token: string, nodeName: string): Promise<JoinTokenEntity> {
    const parsed = parseJoinToken(token);
    const invalid = new UnauthorizedException('invalid or expired join token');

    if (!parsed) throw invalid;

    const repo = manager.getRepository(JoinTokenEntity);
    const entity = await repo.findOne({ where: { tokenPrefix: parsed.prefix }, lock: { mode: 'pessimistic_write' } });
    const expected = Buffer.from(entity?.tokenHash ?? '0'.repeat(64), 'hex');
    const actual = Buffer.from(hashToken(token), 'hex');
    const matches = timingSafeEqual(expected, actual);

    if (!entity || !matches || entity.usedAt || entity.revokedAt || entity.expiresAt.getTime() <= Date.now())
      throw invalid;

    entity.usedAt = new Date();
    entity.usedByNode = nodeName;

    return await repo.save(entity);
  }
}
