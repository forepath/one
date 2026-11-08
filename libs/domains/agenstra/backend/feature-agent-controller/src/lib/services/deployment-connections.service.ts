import { createPrivateKey } from 'crypto';

import {
  defaultDeploymentProviderAuthType,
  deploymentProviderSupportsAuthType,
  isDeploymentProvider,
  type ConnectionAuthType,
  type ConnectionTestResult,
  type DeploymentConnectionOption,
  type DeploymentConnectionSummary,
  type DeploymentProvider,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientEntity } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  CreateDeploymentConnectionDto,
  UpdateDeploymentConnectionDto,
} from '../dto/deployments/deployment-connection.dto';
import { DeploymentConnectionEntity, type DeploymentConnectionSecrets } from '../entities/deployment-connection.entity';
import { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';
import {
  normalizeDeploymentBaseUrl,
  sanitizeDeploymentProviderMessage,
} from '../providers/deployment/deployment-http.util';
import type {
  DeploymentPipelineProvider,
  DeploymentProviderConnection,
} from '../providers/deployment/deployment-provider.interface';
import { DeploymentProviderRegistry } from '../providers/deployment/deployment-provider.registry';
import { mapDeploymentConnectionToSearchDocument } from '../search/agenstra-search-document.mapper';
import { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';
import {
  applyAgenstraSearchIlike,
  hydrateEntitiesBySearchIds,
  sanitizeListSearch,
  tryAgenstraSearchIds,
} from '../search/agenstra-search-list.util';

const TEST_MESSAGE_MAX_LENGTH = 512;
const LIST_LIMIT_MAX = 100;

export const DEPLOYMENT_CONNECTION_NOT_AVAILABLE_MESSAGE = 'Connection not available for this workspace';

type ConnectionInput = CreateDeploymentConnectionDto | UpdateDeploymentConnectionDto;

function nonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length ? trimmed : undefined;
}

/**
 * Instance-wide CI/CD connections (admin managed). Secrets (`token`, `privateKey`) live JSON-encoded in the encrypted
 * `credentials` column and are never returned, logged or indexed. Also the access gate workspaces go through before
 * they may build workflows on / trigger runs with a connection.
 */
@Injectable()
export class DeploymentConnectionsService {
  private readonly logger = new Logger(DeploymentConnectionsService.name);

  constructor(
    @InjectRepository(DeploymentConnectionEntity)
    private readonly repo: Repository<DeploymentConnectionEntity>,
    @InjectRepository(DeploymentWorkflowEntity)
    private readonly workflowsRepo: Repository<DeploymentWorkflowEntity>,
    @InjectRepository(ClientEntity)
    private readonly clientsRepo: Repository<ClientEntity>,
    private readonly providers: DeploymentProviderRegistry,
    private readonly searchIndex: AgenstraSearchIndexService,
  ) {}

  toSummary(row: DeploymentConnectionEntity): DeploymentConnectionSummary {
    return {
      id: row.id,
      label: row.label,
      provider: row.provider,
      baseUrl: row.baseUrl ?? null,
      authType: row.authType,
      appId: row.appId ?? null,
      installationId: row.installationId ?? null,
      username: row.username ?? null,
      workspaceAccess: row.workspaceAccess,
      allowedClientIds: [...(row.allowedClientIds ?? [])],
      lastTestStatus: row.lastTestStatus ?? 'untested',
      lastTestMessage: row.lastTestMessage ?? null,
      lastTestedAt: row.lastTestedAt ? new Date(row.lastTestedAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  async findAll(limit = 10, offset = 0, search?: string, provider?: string): Promise<DeploymentConnectionSummary[]> {
    const take = Math.min(Math.max(1, Math.floor(limit) || 10), LIST_LIMIT_MAX);
    const skip = Math.max(0, Math.floor(offset) || 0);
    const providerFilter = nonEmpty(provider);

    if (providerFilter !== undefined && !isDeploymentProvider(providerFilter)) {
      throw new BadRequestException('Unknown provider');
    }

    const sanitized = sanitizeListSearch(search);
    let rows: DeploymentConnectionEntity[];

    if (sanitized) {
      const openSearchIds = await tryAgenstraSearchIds(
        this.searchIndex,
        {
          entityType: 'deployment-connections',
          query: sanitized,
          instanceScoped: true,
          additionalFilters: providerFilter ? { provider: providerFilter } : undefined,
          limit: take,
          offset: skip,
        },
        this.logger,
      );
      const hydrated = await hydrateEntitiesBySearchIds(this.repo, openSearchIds);

      if (hydrated) {
        rows = providerFilter ? hydrated.items.filter((r) => r.provider === providerFilter) : hydrated.items;
      } else {
        const qb = this.repo.createQueryBuilder('c').orderBy('c.created_at', 'DESC');

        if (providerFilter) {
          qb.andWhere('c.provider = :provider', { provider: providerFilter });
        }

        applyAgenstraSearchIlike(qb, 'deployment-connections', 'c', sanitized);
        qb.take(take).skip(skip);
        rows = await qb.getMany();
      }
    } else {
      rows = await this.repo.find({
        where: providerFilter ? { provider: providerFilter as DeploymentProvider } : {},
        order: { createdAt: 'DESC' },
        take,
        skip,
      });
    }

    return rows.map((r) => this.toSummary(r));
  }

  async findOne(id: string): Promise<DeploymentConnectionSummary> {
    return this.toSummary(await this.findEntityOrThrow(id));
  }

  async findEntity(id: string): Promise<DeploymentConnectionEntity | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async findEntityOrThrow(id: string): Promise<DeploymentConnectionEntity> {
    const row = await this.findEntity(id);

    if (!row) {
      throw new NotFoundException('Connection not found');
    }

    return row;
  }

  async create(
    dto: CreateDeploymentConnectionDto,
    createdByUserId?: string | null,
  ): Promise<DeploymentConnectionSummary> {
    if (!isDeploymentProvider(dto.provider)) {
      throw new BadRequestException('Unknown provider');
    }

    const row = this.repo.create({
      label: this.requireLabel(dto.label),
      provider: dto.provider,
      baseUrl: null,
      authType: defaultDeploymentProviderAuthType(dto.provider),
      appId: null,
      installationId: null,
      username: null,
      credentials: '{}',
      workspaceAccess: 'all',
      allowedClientIds: [],
      lastTestStatus: 'untested',
      lastTestMessage: null,
      lastTestedAt: null,
      createdByUserId: createdByUserId ?? null,
    });

    row.baseUrl = this.resolveBaseUrl(dto.provider, dto.baseUrl, null);
    this.applyAuth(row, dto, true);
    await this.applyWorkspaceAccess(row, dto);

    const saved = await this.repo.save(row);

    void this.searchIndex.upsertSafe('deployment-connections', mapDeploymentConnectionToSearchDocument(saved));

    return this.toSummary(saved);
  }

  async update(id: string, dto: UpdateDeploymentConnectionDto): Promise<DeploymentConnectionSummary> {
    const row = await this.findEntityOrThrow(id);
    const before = this.credentialFingerprint(row);

    if (
      (dto as { provider?: unknown }).provider !== undefined &&
      (dto as { provider?: unknown }).provider !== row.provider
    ) {
      throw new BadRequestException('Provider cannot be changed');
    }

    if (dto.label !== undefined) {
      row.label = this.requireLabel(dto.label);
    }

    if (dto.baseUrl !== undefined) {
      row.baseUrl = this.resolveBaseUrl(row.provider, dto.baseUrl, null);
    } else if (row.provider === 'jenkins' && !row.baseUrl) {
      throw new BadRequestException('Jenkins connections require a base URL');
    }

    this.applyAuth(row, dto, false);
    await this.applyWorkspaceAccess(row, dto);

    if (this.credentialFingerprint(row) !== before) {
      row.lastTestStatus = 'untested';
      row.lastTestMessage = null;
      row.lastTestedAt = null;
    }

    const saved = await this.repo.save(row);

    void this.searchIndex.upsertSafe('deployment-connections', mapDeploymentConnectionToSearchDocument(saved));

    return this.toSummary(saved);
  }

  async delete(id: string): Promise<void> {
    await this.findEntityOrThrow(id);

    const used = await this.workflowsRepo.count({ where: { connectionId: id } });

    if (used > 0) {
      throw new ConflictException(`Connection is used by ${used} deployment workflows`);
    }

    const res = await this.repo.delete(id);

    if (!res.affected) {
      throw new NotFoundException('Connection not found');
    }

    void this.searchIndex.deleteSafe('deployment-connections', id);
  }

  /** Runs the provider connection test and persists the outcome (message sanitized, ≤ 512 chars). */
  async test(id: string): Promise<ConnectionTestResult> {
    const row = await this.findEntityOrThrow(id);
    const connection = this.resolveProviderConnection(row);
    let ok = false;
    let rawMessage: string | undefined;

    try {
      const result = await this.providers.get(row.provider).testConnection(connection);

      ok = result.ok;
      rawMessage = result.message;
    } catch (error) {
      ok = false;
      rawMessage = error instanceof HttpException ? error.message : 'Connection test failed';
    }

    const message = rawMessage
      ? sanitizeDeploymentProviderMessage(
          rawMessage,
          [connection.secrets.token, connection.secrets.privateKey],
          TEST_MESSAGE_MAX_LENGTH,
        )
      : undefined;
    const testedAt = new Date();

    await this.repo.update(
      { id: row.id },
      { lastTestStatus: ok ? 'ok' : 'failed', lastTestMessage: message ?? null, lastTestedAt: testedAt },
    );

    row.lastTestStatus = ok ? 'ok' : 'failed';
    row.lastTestMessage = message ?? null;
    row.lastTestedAt = testedAt;
    void this.searchIndex.upsertSafe('deployment-connections', mapDeploymentConnectionToSearchDocument(row));

    return { ok, ...(message ? { message } : {}), testedAt: testedAt.toISOString() };
  }

  /** Decrypted connection material for a provider adapter (never leaves the controller). */
  resolveProviderConnection(entity: DeploymentConnectionEntity): DeploymentProviderConnection {
    return {
      id: entity.id,
      provider: entity.provider,
      baseUrl: entity.baseUrl ? entity.baseUrl.replace(/\/+$/, '') : null,
      authType: entity.authType,
      appId: entity.appId ?? null,
      installationId: entity.installationId ?? null,
      username: entity.username ?? null,
      secrets: this.readSecrets(entity),
    };
  }

  /** Adapter + decrypted connection for one entity. */
  providerFor(entity: DeploymentConnectionEntity): {
    provider: DeploymentPipelineProvider;
    connection: DeploymentProviderConnection;
  } {
    return { provider: this.providers.get(entity.provider), connection: this.resolveProviderConnection(entity) };
  }

  isUsableByClient(entity: DeploymentConnectionEntity, clientId: string): boolean {
    if (entity.workspaceAccess === 'all') {
      return true;
    }

    return (entity.allowedClientIds ?? []).includes(clientId);
  }

  /** 403 when the workspace may not (or may no longer) use the connection. */
  assertUsableByClient(entity: DeploymentConnectionEntity, clientId: string): void {
    if (!this.isUsableByClient(entity, clientId)) {
      throw new ForbiddenException(DEPLOYMENT_CONNECTION_NOT_AVAILABLE_MESSAGE);
    }
  }

  /** 404 when missing, 403 when not usable by the workspace. */
  async findUsableOrThrow(clientId: string, connectionId: string): Promise<DeploymentConnectionEntity> {
    const row = await this.findEntityOrThrow(connectionId);

    this.assertUsableByClient(row, clientId);

    return row;
  }

  /** Connections a workspace may build workflows on (non-secret option view). */
  async listOptionsForClient(clientId: string): Promise<DeploymentConnectionOption[]> {
    const rows = await this.repo
      .createQueryBuilder('c')
      .where(`(c.workspace_access = 'all' OR c.allowed_client_ids @> CAST(:clientIds AS jsonb))`, {
        clientIds: JSON.stringify([clientId]),
      })
      .orderBy('c.label', 'ASC')
      .getMany();

    return rows
      .filter((r) => this.isUsableByClient(r, clientId))
      .map((r) => ({ id: r.id, label: r.label, provider: r.provider, lastTestStatus: r.lastTestStatus ?? 'untested' }));
  }

  private readSecrets(entity: DeploymentConnectionEntity): DeploymentConnectionSecrets {
    try {
      const parsed = JSON.parse(entity.credentials || '{}') as unknown;

      if (!parsed || typeof parsed !== 'object') {
        return {};
      }

      const o = parsed as Record<string, unknown>;

      return {
        ...(typeof o['token'] === 'string' ? { token: o['token'] } : {}),
        ...(typeof o['privateKey'] === 'string' ? { privateKey: o['privateKey'] } : {}),
      };
    } catch {
      this.logger.warn(`Deployment connection ${entity.id} has unreadable credentials`);

      return {};
    }
  }

  private requireLabel(label: string | undefined): string {
    const value = nonEmpty(label);

    if (!value) {
      throw new BadRequestException('Label is required');
    }

    return value;
  }

  private resolveBaseUrl(
    provider: DeploymentProvider,
    raw: string | null | undefined,
    fallback: string | null,
  ): string | null {
    const value = nonEmpty(raw ?? undefined);
    const normalized = value ? normalizeDeploymentBaseUrl(value) : fallback;

    if (provider === 'jenkins' && !normalized) {
      throw new BadRequestException('Jenkins connections require a base URL');
    }

    return normalized;
  }

  /**
   * Applies auth type, non-secret identifiers and secrets. Omitted secrets keep the stored ones unless the auth type
   * changes (then the new type's secrets are required).
   */
  private applyAuth(row: DeploymentConnectionEntity, dto: ConnectionInput, isCreate: boolean): void {
    const provider = row.provider;
    const authType: ConnectionAuthType = dto.authType ?? row.authType ?? defaultDeploymentProviderAuthType(provider);

    if (!deploymentProviderSupportsAuthType(provider, authType)) {
      throw new BadRequestException(`Auth type '${authType}' is not supported for ${provider} connections`);
    }

    const switching = !isCreate && authType !== row.authType;
    const stored = isCreate || switching ? {} : this.readSecrets(row);
    const token = nonEmpty(dto.token);
    const privateKey = nonEmpty(dto.privateKey);

    if (authType === 'app') {
      const appId = nonEmpty(dto.appId) ?? (switching ? undefined : (row.appId ?? undefined));
      const installationId =
        nonEmpty(dto.installationId) ?? (switching ? undefined : (row.installationId ?? undefined));
      const key = privateKey ?? stored.privateKey;

      if (!appId || !installationId) {
        throw new BadRequestException('GitHub App connections require appId and installationId');
      }

      if (!key) {
        throw new BadRequestException('GitHub App connections require a privateKey');
      }

      if (privateKey) {
        this.assertValidPrivateKey(privateKey);
      }

      row.appId = appId;
      row.installationId = installationId;
      row.username = null;
      row.credentials = JSON.stringify({ privateKey: key } satisfies DeploymentConnectionSecrets);
    } else {
      const secret = token ?? stored.token;

      if (!secret) {
        throw new BadRequestException('Token connections require a token');
      }

      if (provider === 'jenkins') {
        const username = nonEmpty(dto.username) ?? (switching ? undefined : (row.username ?? undefined));

        if (!username) {
          throw new BadRequestException('Jenkins connections require a username');
        }

        row.username = username;
      } else {
        row.username = null;
      }

      row.appId = null;
      row.installationId = null;
      row.credentials = JSON.stringify({ token: secret } satisfies DeploymentConnectionSecrets);
    }

    row.authType = authType;
  }

  private assertValidPrivateKey(pem: string): void {
    try {
      const key = createPrivateKey(pem.replace(/\\n/g, '\n'));

      if (key.asymmetricKeyType !== 'rsa') {
        throw new Error('not rsa');
      }
    } catch {
      throw new BadRequestException('privateKey must be a PEM encoded RSA private key');
    }
  }

  private async applyWorkspaceAccess(row: DeploymentConnectionEntity, dto: ConnectionInput): Promise<void> {
    if (dto.workspaceAccess !== undefined) {
      row.workspaceAccess = dto.workspaceAccess;
    }

    if (dto.allowedClientIds !== undefined) {
      const ids = [...new Set(dto.allowedClientIds)];

      if (ids.length) {
        const found = await this.clientsRepo.count({ where: { id: In(ids) } });

        if (found !== ids.length) {
          throw new BadRequestException('allowedClientIds contains unknown workspaces');
        }
      }

      row.allowedClientIds = ids;
    }

    if (row.workspaceAccess === 'selected' && !(row.allowedClientIds ?? []).length) {
      throw new BadRequestException('Select at least one workspace or allow all workspaces');
    }
  }

  /** Changes of these invalidate the last test result. */
  private credentialFingerprint(row: DeploymentConnectionEntity): string {
    return JSON.stringify([
      row.baseUrl ?? null,
      row.authType,
      row.appId,
      row.installationId,
      row.username,
      row.credentials,
    ]);
  }
}
