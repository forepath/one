import {
  applySecretsPatch,
  assertNoCredentialKeysInConfig,
  assertNoV1RootKeys,
  assertOverlayRespectsHeredity,
  assertSecretsRespectLocks,
  buildAllowDenyContext,
  composeLayerOverlay,
  computeHeredityMetadata,
  enforceAllowDenyOnOverlay,
  mergeConfigs,
  mergeSecrets as mergeSecretMaps,
  migrateConfigV1ToV2,
  normalizeStoredLocks,
  OpencodeConfigValidationError,
  prepareConfigForSync,
  type HeredityParentLayer,
  type InheritedAdditiveEntry,
  type JsonObject,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  collectMcpRegistryClaims,
  stripUnverifiedMcpRegistryClaims,
  type OpencodeBuiltinMcpServer,
} from '@forepath/agenstra/shared/util-opencode-mcp-servers';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OpencodeConfigResponseDto, UpsertOpencodeConfigDto } from '../dto/opencode-config.dto';
import { ClientOpencodeConfigEntity } from '../entities/client-opencode-config.entity';
import { GlobalOpencodeConfigEntity } from '../entities/global-opencode-config.entity';
import { OpencodeMcpServersCatalogService } from './opencode-mcp-servers-catalog.service';

function parseSecrets(raw: string | null | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const out: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        out[key] = value;
      }
    }

    return out;
  } catch {
    return {};
  }
}

function toBadRequest(error: unknown): never {
  if (error instanceof OpencodeConfigValidationError) {
    throw new BadRequestException(error.message);
  }

  throw error;
}

function persistSecrets(
  currentRaw: string | null | undefined,
  patch: Record<string, string> | null | undefined,
): string | null | undefined {
  if (patch === undefined) {
    return undefined;
  }

  const next = applySecretsPatch(parseSecrets(currentRaw), patch) ?? {};

  return Object.keys(next).length ? JSON.stringify(next) : null;
}

function asOverlay(value: Record<string, unknown> | null | undefined): JsonObject {
  return migrateConfigV1ToV2((value as JsonObject) ?? {});
}

/**
 * Three-layer OpenCode config merge (later layers win for replace semantics):
 * environment (agent) < workspace (client) < admin (global).
 * Each layer is composed as merge(config, overrides) before cross-layer merge.
 */
@Injectable()
export class OpencodeConfigService {
  constructor(
    @InjectRepository(GlobalOpencodeConfigEntity)
    private readonly globalRepo: Repository<GlobalOpencodeConfigEntity>,
    @InjectRepository(ClientOpencodeConfigEntity)
    private readonly clientRepo: Repository<ClientOpencodeConfigEntity>,
    private readonly mcpCatalog: OpencodeMcpServersCatalogService,
  ) {}

  async getGlobal(): Promise<OpencodeConfigResponseDto> {
    const row = await this.globalRepo.find({ take: 1, order: { updatedAt: 'DESC' } }).then((r) => r[0]);
    const response = this.toResponse(row?.config, row?.overrides, row?.locks, row?.secrets, row?.updatedAt);
    // Owning (global) layer still needs `effective` for draft-lock display fallbacks.
    response.effective = this.composeStoredLayer(row?.config, row?.overrides);

    return response;
  }

  async putGlobal(dto: UpsertOpencodeConfigDto): Promise<OpencodeConfigResponseDto> {
    let row = await this.globalRepo.find({ take: 1, order: { updatedAt: 'DESC' } }).then((r) => r[0]);

    const sanitized = await this.sanitizeUpsertAgainstAllowDeny(dto, {
      parentOverlaysLowToHigh: [],
      inheritedAdditive: [],
      existingConfig: row?.config,
      existingOverrides: row?.overrides,
    });

    this.assertWritableOverlay(sanitized.config ?? undefined, [], []);
    this.assertWritableOverlay(sanitized.overrides ?? undefined, [], []);

    if (!row) {
      row = this.globalRepo.create({});
    }

    if (sanitized.config !== undefined) {
      row.config = sanitized.config ?? {};
    }

    if (sanitized.overrides !== undefined) {
      row.overrides = sanitized.overrides ?? {};
    }

    if (sanitized.locks !== undefined) {
      row.locks = normalizeStoredLocks(sanitized.locks);
    }

    const nextSecrets = persistSecrets(row.secrets, sanitized.secrets);

    if (nextSecrets !== undefined) {
      row.secrets = nextSecrets;
    }

    const saved = await this.globalRepo.save(row);
    const response = this.toResponse(saved.config, saved.overrides, saved.locks, saved.secrets, saved.updatedAt);

    response.effective = this.composeStoredLayer(saved.config, saved.overrides);

    return response;
  }

  async getClient(clientId: string): Promise<OpencodeConfigResponseDto> {
    const row = await this.clientRepo.findOne({ where: { clientId } });
    const globalRow = await this.globalRepo.find({ take: 1, order: { updatedAt: 'DESC' } }).then((r) => r[0]);
    const overlay = this.composeStoredLayer(row?.config, row?.overrides);
    const globalLayer = this.toHeredityParent(globalRow);
    const heredity = computeHeredityMetadata(globalLayer);
    const response = this.toResponse(row?.config, row?.overrides, row?.locks, row?.secrets, row?.updatedAt);

    response.effective = this.mergeEffective(null, overlay, globalLayer.overlay);
    response.lockedPaths = heredity.lockedPaths;
    response.inheritedAdditive = heredity.inheritedAdditive;

    return response;
  }

  async putClient(clientId: string, dto: UpsertOpencodeConfigDto): Promise<OpencodeConfigResponseDto> {
    const globalRow = await this.globalRepo.find({ take: 1, order: { updatedAt: 'DESC' } }).then((r) => r[0]);
    const globalLayer = this.toHeredityParent(globalRow);
    const heredity = computeHeredityMetadata(globalLayer);

    let row = await this.clientRepo.findOne({ where: { clientId } });

    const sanitized = await this.sanitizeUpsertAgainstAllowDeny(dto, {
      parentOverlaysLowToHigh: [globalLayer.overlay ?? {}],
      inheritedAdditive: heredity.inheritedAdditive,
      existingConfig: row?.config,
      existingOverrides: row?.overrides,
    });

    this.assertWritableOverlay(sanitized.config ?? undefined, heredity.lockedPaths, heredity.inheritedAdditive);
    this.assertWritableOverlay(sanitized.overrides ?? undefined, heredity.lockedPaths, heredity.inheritedAdditive);
    this.assertWritableSecrets(sanitized.secrets, heredity.lockedPaths);

    if (!row) {
      row = this.clientRepo.create({ clientId });
    }

    if (sanitized.config !== undefined) {
      row.config = sanitized.config ?? {};
    }

    if (sanitized.overrides !== undefined) {
      row.overrides = sanitized.overrides ?? {};
    }

    if (sanitized.locks !== undefined) {
      row.locks = normalizeStoredLocks(sanitized.locks);
    }

    const nextSecrets = persistSecrets(row.secrets, sanitized.secrets);

    if (nextSecrets !== undefined) {
      row.secrets = nextSecrets;
    }

    const saved = await this.clientRepo.save(row);
    const overlay = this.composeStoredLayer(saved.config, saved.overrides);
    const response = this.toResponse(saved.config, saved.overrides, saved.locks, saved.secrets, saved.updatedAt);

    response.effective = this.mergeEffective(null, overlay, globalLayer.overlay);
    response.lockedPaths = heredity.lockedPaths;
    response.inheritedAdditive = heredity.inheritedAdditive;

    return response;
  }

  /**
   * Merge layers low → high: agent → workspace → global.
   * Each argument should already be a composed layer overlay (config + overrides).
   * Returns the editor-facing merge (keeps platform keys such as `model_allow`).
   * Worker sync must run {@link prepareConfigForSync} on the result.
   */
  mergeEffective(
    agentConfig: Record<string, unknown> | null | undefined,
    workspaceConfig: Record<string, unknown> | null | undefined,
    globalConfig: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    return mergeConfigs(
      (agentConfig as JsonObject) ?? {},
      (workspaceConfig as JsonObject) ?? {},
      (globalConfig as JsonObject) ?? {},
    );
  }

  /**
   * Worker-ready effective config:
   * merge layers → strip unverified MCP registry claims (catalog transport proof) →
   * prepareConfigForSync (model/MCP allow-deny materialization + OpenCode wire).
   */
  async mergeEffectiveForSync(
    agentConfig: Record<string, unknown> | null | undefined,
    workspaceConfig: Record<string, unknown> | null | undefined,
    globalConfig: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown>> {
    const merged = this.mergeEffective(agentConfig, workspaceConfig, globalConfig) as JsonObject;
    const catalogByName = await this.loadMcpCatalogByNames(collectMcpRegistryClaims(merged));
    const stripped = stripUnverifiedMcpRegistryClaims(merged, catalogByName) as JsonObject;

    return prepareConfigForSync(stripped);
  }

  mergeSecrets(
    agentSecrets: Record<string, string>,
    workspaceSecrets: Record<string, string>,
    globalSecrets: Record<string, string>,
  ): Record<string, string> {
    return mergeSecretMaps(agentSecrets, workspaceSecrets, globalSecrets);
  }

  computeHeredity(...parents: Array<HeredityParentLayer | null | undefined>): {
    lockedPaths: string[];
    inheritedAdditive: InheritedAdditiveEntry[];
  } {
    return computeHeredityMetadata(...parents);
  }

  composeStoredLayer(
    config: Record<string, unknown> | null | undefined,
    overrides: Record<string, unknown> | null | undefined,
  ): JsonObject {
    return composeLayerOverlay(asOverlay(config), asOverlay(overrides));
  }

  async getLayerConfigs(clientId?: string): Promise<{
    global: Record<string, unknown>;
    workspace: Record<string, unknown>;
  }> {
    const layers = await this.getLayerParents(clientId);

    return {
      global: layers.global.overlay ?? {},
      workspace: layers.workspace.overlay ?? {},
    };
  }

  async getLayerParents(clientId?: string): Promise<{
    global: HeredityParentLayer;
    workspace: HeredityParentLayer;
  }> {
    const globalRow = await this.globalRepo.find({ take: 1, order: { updatedAt: 'DESC' } }).then((r) => r[0]);
    const workspaceRow = clientId ? await this.clientRepo.findOne({ where: { clientId } }) : null;

    return {
      global: this.toHeredityParent(globalRow),
      workspace: this.toHeredityParent(workspaceRow),
    };
  }

  async getLayerSecrets(clientId?: string): Promise<{
    global: Record<string, string>;
    workspace: Record<string, string>;
  }> {
    const globalRow = await this.globalRepo.find({ take: 1, order: { updatedAt: 'DESC' } }).then((r) => r[0]);
    const workspaceRow = clientId ? await this.clientRepo.findOne({ where: { clientId } }) : null;

    return {
      global: parseSecrets(globalRow?.secrets),
      workspace: parseSecrets(workspaceRow?.secrets),
    };
  }

  private toHeredityParent(
    row:
      | { config?: Record<string, unknown> | null; overrides?: Record<string, unknown> | null; locks?: string[] | null }
      | null
      | undefined,
  ): HeredityParentLayer {
    return {
      overlay: this.composeStoredLayer(row?.config, row?.overrides),
      locks: normalizeStoredLocks(row?.locks),
    };
  }

  /**
   * Force allow/deny constraints onto an upsert DTO before persist.
   * Strips unverified MCP `registry` claims (catalog transport must match), then
   * deletes prohibited local map entries and writes `{ disabled: true }` stubs for prohibited inherited keys.
   * Clears prohibited default models and model allow/deny refs whose provider is outside provider lists.
   */
  async sanitizeUpsertAgainstAllowDeny(
    dto: UpsertOpencodeConfigDto,
    options: {
      parentOverlaysLowToHigh: JsonObject[];
      inheritedAdditive: InheritedAdditiveEntry[];
      existingConfig?: Record<string, unknown> | null;
      existingOverrides?: Record<string, unknown> | null;
    },
  ): Promise<UpsertOpencodeConfigDto> {
    // Always sanitize the composed layer (incoming patch or stored rows) so partial PUTs
    // and legacy/poisoned MCP registry claims are healed on every write.
    const claimedNames = [
      ...collectMcpRegistryClaims(dto.config as JsonObject | undefined),
      ...collectMcpRegistryClaims(dto.overrides as JsonObject | undefined),
      ...collectMcpRegistryClaims(options.existingConfig as JsonObject | undefined),
      ...collectMcpRegistryClaims(options.existingOverrides as JsonObject | undefined),
    ];
    const catalogByName = await this.loadMcpCatalogByNames(claimedNames);

    const verifiedConfig = stripUnverifiedMcpRegistryClaims(
      (dto.config !== undefined ? dto.config : options.existingConfig) as JsonObject,
      catalogByName,
    ) as JsonObject;
    const verifiedOverrides = stripUnverifiedMcpRegistryClaims(
      (dto.overrides !== undefined ? dto.overrides : options.existingOverrides) as JsonObject,
      catalogByName,
    ) as JsonObject;

    const nextConfig = asOverlay(verifiedConfig);
    const nextOverrides = asOverlay(verifiedOverrides);
    const composed = this.composeStoredLayer(nextConfig, nextOverrides);
    const effective = mergeConfigs(composed, ...options.parentOverlaysLowToHigh);
    const context = buildAllowDenyContext(effective, options.inheritedAdditive);

    return {
      ...dto,
      config: enforceAllowDenyOnOverlay(verifiedConfig, context, {
        seedMissingInheritedDisables: true,
      }),
      overrides: enforceAllowDenyOnOverlay(verifiedOverrides, context, {
        seedMissingInheritedDisables: false,
      }),
    };
  }

  private async loadMcpCatalogByNames(names: readonly string[]): Promise<Record<string, OpencodeBuiltinMcpServer>> {
    const rows = await this.mcpCatalog.getServersByNames(names);
    const byName: Record<string, OpencodeBuiltinMcpServer> = {};

    for (const row of rows) {
      byName[row.name] = {
        name: row.name,
        title: row.title,
        description: row.description,
        version: row.version,
        status: row.status,
        websiteUrl: row.websiteUrl,
        packages: Array.isArray(row.packages) ? (row.packages as OpencodeBuiltinMcpServer['packages']) : [],
        remotes: Array.isArray(row.remotes) ? (row.remotes as OpencodeBuiltinMcpServer['remotes']) : [],
      };
    }

    return byName;
  }

  private assertWritableOverlay(
    config: Record<string, unknown> | null | undefined,
    lockedPaths: string[],
    inheritedAdditive: InheritedAdditiveEntry[],
  ): void {
    try {
      assertNoCredentialKeysInConfig(config as JsonObject | undefined);
      assertNoV1RootKeys(config as JsonObject | undefined);
      assertOverlayRespectsHeredity(config as JsonObject | undefined, lockedPaths, inheritedAdditive);
    } catch (error) {
      toBadRequest(error);
    }
  }

  private assertWritableSecrets(secrets: Record<string, string> | null | undefined, lockedPaths: string[]): void {
    if (secrets === undefined || secrets === null) {
      return;
    }

    try {
      assertSecretsRespectLocks(secrets, lockedPaths);
    } catch (error) {
      toBadRequest(error);
    }
  }

  private toResponse(
    config: Record<string, unknown> | null | undefined,
    overrides: Record<string, unknown> | null | undefined,
    locks: string[] | null | undefined,
    secretsRaw: string | null | undefined,
    updatedAt?: Date,
  ): OpencodeConfigResponseDto {
    const secrets = parseSecrets(secretsRaw);

    return {
      config: asOverlay(config),
      overrides: asOverlay(overrides),
      locks: normalizeStoredLocks(locks),
      secretKeys: Object.keys(secrets),
      updatedAt,
    };
  }
}
