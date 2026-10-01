import {
  applySecretsPatch,
  assertNoCredentialKeysInConfig,
  assertNoV1RootKeys,
  assertOverlayRespectsHeredity,
  assertSecretsRespectLocks,
  composeLayerOverlay,
  computeHeredityMetadata,
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
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OpencodeConfigResponseDto, UpsertOpencodeConfigDto } from '../dto/opencode-config.dto';
import { ClientOpencodeConfigEntity } from '../entities/client-opencode-config.entity';
import { GlobalOpencodeConfigEntity } from '../entities/global-opencode-config.entity';

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
  ) {}

  async getGlobal(): Promise<OpencodeConfigResponseDto> {
    const row = await this.globalRepo.find({ take: 1, order: { updatedAt: 'DESC' } }).then((r) => r[0]);

    return this.toResponse(row?.config, row?.overrides, row?.locks, row?.secrets, row?.updatedAt);
  }

  async putGlobal(dto: UpsertOpencodeConfigDto): Promise<OpencodeConfigResponseDto> {
    this.assertWritableOverlay(dto.config ?? undefined, [], []);
    this.assertWritableOverlay(dto.overrides ?? undefined, [], []);

    let row = await this.globalRepo.find({ take: 1, order: { updatedAt: 'DESC' } }).then((r) => r[0]);

    if (!row) {
      row = this.globalRepo.create({});
    }

    if (dto.config !== undefined) {
      row.config = dto.config ?? {};
    }

    if (dto.overrides !== undefined) {
      row.overrides = dto.overrides ?? {};
    }

    if (dto.locks !== undefined) {
      row.locks = normalizeStoredLocks(dto.locks);
    }

    const nextSecrets = persistSecrets(row.secrets, dto.secrets);

    if (nextSecrets !== undefined) {
      row.secrets = nextSecrets;
    }

    const saved = await this.globalRepo.save(row);

    return this.toResponse(saved.config, saved.overrides, saved.locks, saved.secrets, saved.updatedAt);
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

    this.assertWritableOverlay(dto.config ?? undefined, heredity.lockedPaths, heredity.inheritedAdditive);
    this.assertWritableOverlay(dto.overrides ?? undefined, heredity.lockedPaths, heredity.inheritedAdditive);
    this.assertWritableSecrets(dto.secrets, heredity.lockedPaths);

    let row = await this.clientRepo.findOne({ where: { clientId } });

    if (!row) {
      row = this.clientRepo.create({ clientId });
    }

    if (dto.config !== undefined) {
      row.config = dto.config ?? {};
    }

    if (dto.overrides !== undefined) {
      row.overrides = dto.overrides ?? {};
    }

    if (dto.locks !== undefined) {
      row.locks = normalizeStoredLocks(dto.locks);
    }

    const nextSecrets = persistSecrets(row.secrets, dto.secrets);

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

  /** Worker-ready effective config (V2 migrate + model allow/deny materialization). */
  mergeEffectiveForSync(
    agentConfig: Record<string, unknown> | null | undefined,
    workspaceConfig: Record<string, unknown> | null | undefined,
    globalConfig: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    return prepareConfigForSync(this.mergeEffective(agentConfig, workspaceConfig, globalConfig));
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
