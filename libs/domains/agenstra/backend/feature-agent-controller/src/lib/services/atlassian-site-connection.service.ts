import type { ConnectionAuthType } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AtlassianAuthService, sanitizeAtlassianTestMessage } from '../context-import/atlassian-auth.service';
import { normalizeAtlassianBaseUrl } from '../context-import/atlassian-rest.util';
import {
  AtlassianConnectionTestResultDto,
  AtlassianSiteConnectionResponseDto,
} from '../dto/context-import/atlassian-site-connection-response.dto';
import { CreateAtlassianSiteConnectionDto } from '../dto/context-import/create-atlassian-site-connection.dto';
import { UpdateAtlassianSiteConnectionDto } from '../dto/context-import/update-atlassian-site-connection.dto';
import { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';
import { mapAtlassianConnectionToSearchDocument } from '../search/agenstra-search-document.mapper';
import { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';
import {
  applyAgenstraSearchIlike,
  hydrateEntitiesBySearchIds,
  sanitizeListSearch,
  tryAgenstraSearchIds,
} from '../search/agenstra-search-list.util';

@Injectable()
export class AtlassianSiteConnectionService {
  private readonly logger = new Logger(AtlassianSiteConnectionService.name);

  constructor(
    @InjectRepository(AtlassianSiteConnectionEntity)
    private readonly repo: Repository<AtlassianSiteConnectionEntity>,
    private readonly searchIndex: AgenstraSearchIndexService,
    private readonly atlassianAuth: AtlassianAuthService,
  ) {}

  /**
   * Maps entity to API DTO; never includes `apiToken` / `oauthClientSecret` (decrypted only in-process for import
   * HTTP calls).
   */
  private map(row: AtlassianSiteConnectionEntity): AtlassianSiteConnectionResponseDto {
    const authType = row.authType ?? 'token';

    return {
      id: row.id,
      label: row.label ?? null,
      baseUrl: row.baseUrl,
      authType,
      accountEmail: authType === 'token' ? (row.accountEmail ?? null) : null,
      oauthClientId: authType === 'app' ? (row.oauthClientId ?? null) : null,
      cloudId: row.cloudId ?? null,
      lastTestStatus: row.lastTestStatus ?? 'untested',
      lastTestMessage: row.lastTestMessage ?? null,
      lastTestedAt: row.lastTestedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findAll(limit = 10, offset = 0, search?: string): Promise<AtlassianSiteConnectionResponseDto[]> {
    const sanitized = sanitizeListSearch(search);
    let rows: AtlassianSiteConnectionEntity[];

    if (sanitized) {
      const openSearchIds = await tryAgenstraSearchIds(
        this.searchIndex,
        {
          entityType: 'atlassian-connections',
          query: sanitized,
          instanceScoped: true,
          limit,
          offset,
        },
        this.logger,
      );
      const hydrated = await hydrateEntitiesBySearchIds(this.repo, openSearchIds);

      if (hydrated) {
        rows = hydrated.items;
      } else {
        const qb = this.repo.createQueryBuilder('c').orderBy('c.created_at', 'DESC');

        applyAgenstraSearchIlike(qb, 'atlassian-connections', 'c', sanitized);
        qb.take(limit).skip(offset);
        rows = await qb.getMany();
      }
    } else {
      rows = await this.repo.find({
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });
    }

    return rows.map((r) => this.map(r));
  }

  async findOne(id: string): Promise<AtlassianSiteConnectionResponseDto> {
    const row = await this.repo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Connection not found');
    }

    return this.map(row);
  }

  async findEntity(id: string): Promise<AtlassianSiteConnectionEntity | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async create(dto: CreateAtlassianSiteConnectionDto): Promise<AtlassianSiteConnectionResponseDto> {
    const baseUrl = this.normalizeBaseUrl(dto.baseUrl);
    const row = this.repo.create({
      label: dto.label ?? null,
      baseUrl,
      authType: dto.authType ?? 'app',
      lastTestStatus: 'untested',
    });

    this.applyCredentials(row, row.authType, dto, true);

    const saved = await this.repo.save(row);

    void this.searchIndex.upsertSafe('atlassian-connections', mapAtlassianConnectionToSearchDocument(saved));

    return this.map(saved);
  }

  async update(id: string, dto: UpdateAtlassianSiteConnectionDto): Promise<AtlassianSiteConnectionResponseDto> {
    const row = await this.repo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Connection not found');
    }

    const previousAuthType: ConnectionAuthType = row.authType ?? 'token';
    const nextAuthType: ConnectionAuthType = dto.authType ?? previousAuthType;
    const switching = nextAuthType !== previousAuthType;
    let credentialsChanged = switching;

    if (dto.label !== undefined) {
      row.label = dto.label;
    }

    if (dto.baseUrl !== undefined) {
      const baseUrl = this.normalizeBaseUrl(dto.baseUrl);

      if (baseUrl !== row.baseUrl) {
        row.baseUrl = baseUrl;
        // Cloud id belongs to the site; resolve it again on next use.
        row.cloudId = null;
        credentialsChanged = true;
      }
    }

    credentialsChanged = this.applyCredentials(row, nextAuthType, dto, switching) || credentialsChanged;
    row.authType = nextAuthType;

    if (credentialsChanged) {
      row.lastTestStatus = 'untested';
      row.lastTestMessage = null;
      row.lastTestedAt = null;
    }

    const saved = await this.repo.save(row);

    this.atlassianAuth.invalidate(id);
    void this.searchIndex.upsertSafe('atlassian-connections', mapAtlassianConnectionToSearchDocument(saved));

    return this.map(saved);
  }

  /** Persists the outcome of `POST connections/:id/test` (message sanitized and bounded). */
  async recordTestResult(
    id: string,
    result: { ok: boolean; message?: string },
  ): Promise<AtlassianConnectionTestResultDto> {
    const testedAt = new Date();
    const message = sanitizeAtlassianTestMessage(result.message);
    const row = await this.repo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Connection not found');
    }

    // Explicit `updatedAt` keeps the admin edit timestamp (and the OAuth token cache key) unchanged.
    await this.repo.update(
      { id },
      {
        lastTestStatus: result.ok ? 'ok' : 'failed',
        lastTestMessage: message,
        lastTestedAt: testedAt,
        updatedAt: row.updatedAt,
      },
    );

    return { ok: result.ok, ...(message ? { message } : {}), testedAt: testedAt.toISOString() };
  }

  private normalizeBaseUrl(raw: string): string {
    try {
      return normalizeAtlassianBaseUrl(raw);
    } catch {
      throw new BadRequestException('baseUrl must be an absolute http(s) URL');
    }
  }

  /**
   * Applies the credentials of `authType` from the DTO and clears those of the other type.
   * `requireSecrets`: create or auth type switch; every credential field of the type must be present.
   * Otherwise omitted fields keep stored values. Returns whether stored credentials changed.
   */
  private applyCredentials(
    row: AtlassianSiteConnectionEntity,
    authType: ConnectionAuthType,
    dto: CreateAtlassianSiteConnectionDto | UpdateAtlassianSiteConnectionDto,
    requireSecrets: boolean,
  ): boolean {
    let changed = false;
    const trimmedOrUndefined = (value: string | undefined): string | undefined => {
      if (value === undefined) {
        return undefined;
      }

      const t = value.trim();

      return t.length ? t : undefined;
    };

    if (authType === 'token') {
      const email = trimmedOrUndefined(dto.accountEmail);
      const token = trimmedOrUndefined(dto.apiToken);

      if (requireSecrets && (!email || !token)) {
        throw new BadRequestException('accountEmail and apiToken are required for authType "token"');
      }

      if (email !== undefined && email !== row.accountEmail) {
        row.accountEmail = email;
        changed = true;
      }

      if (token !== undefined) {
        row.apiToken = token;
        changed = true;
      }

      if (!row.accountEmail || !row.apiToken) {
        throw new BadRequestException('accountEmail and apiToken are required for authType "token"');
      }

      row.oauthClientId = null;
      row.oauthClientSecret = null;
      row.cloudId = null;
    } else {
      const clientId = trimmedOrUndefined(dto.oauthClientId);
      const secret = trimmedOrUndefined(dto.oauthClientSecret);

      if (requireSecrets && (!clientId || !secret)) {
        throw new BadRequestException('oauthClientId and oauthClientSecret are required for authType "app"');
      }

      if (clientId !== undefined && clientId !== row.oauthClientId) {
        row.oauthClientId = clientId;
        changed = true;
      }

      if (secret !== undefined) {
        row.oauthClientSecret = secret;
        changed = true;
      }

      if (!row.oauthClientId || !row.oauthClientSecret) {
        throw new BadRequestException('oauthClientId and oauthClientSecret are required for authType "app"');
      }

      row.accountEmail = null;
      row.apiToken = null;
    }

    return changed;
  }

  async delete(id: string): Promise<void> {
    const res = await this.repo.delete(id);

    if (!res.affected) {
      throw new NotFoundException('Connection not found');
    }

    this.atlassianAuth.invalidate(id);
    void this.searchIndex.deleteSafe('atlassian-connections', id);
  }
}
