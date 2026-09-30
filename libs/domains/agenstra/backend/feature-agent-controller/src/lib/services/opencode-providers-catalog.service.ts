import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';

import { OPENCODE_PROVIDERS_MODELS_DEV_URL } from '../constants/opencode-providers.constants';
import { OpencodeProviderDto, OpencodeProviderModelDto } from '../dto/opencode-providers.dto';
import { OpencodeProviderEntity } from '../entities/opencode-provider.entity';

interface ModelsDevProviderEntry {
  id?: unknown;
  name?: unknown;
  env?: unknown;
  npm?: unknown;
  api?: unknown;
  models?: unknown;
}

export interface OpencodeProvidersRefreshResult {
  upserted: number;
  removed: number;
}

/**
 * DB-backed catalog of OpenCode LLM providers sourced from models.dev.
 */
@Injectable()
export class OpencodeProvidersCatalogService {
  private readonly logger = new Logger(OpencodeProvidersCatalogService.name);

  constructor(
    @InjectRepository(OpencodeProviderEntity)
    private readonly providersRepository: Repository<OpencodeProviderEntity>,
  ) {}

  async count(): Promise<number> {
    return await this.providersRepository.count();
  }

  async isEmpty(): Promise<boolean> {
    return (await this.count()) === 0;
  }

  /** True when providers exist but every row has an empty models list (stale bootstrap). */
  async hasOnlyEmptyModels(): Promise<boolean> {
    const count = await this.count();

    if (count === 0) {
      return false;
    }

    const withModels = await this.providersRepository
      .createQueryBuilder('p')
      .where(`jsonb_typeof(p.models) = 'array'`)
      .andWhere(`jsonb_array_length(p.models) > 0`)
      .getCount();

    return withModels === 0;
  }

  async listProviders(): Promise<OpencodeProviderDto[]> {
    const rows = await this.providersRepository.find({
      order: { name: 'ASC', id: 'ASC' },
    });

    return rows.map((row) => this.toDto(row));
  }

  /**
   * Fetches models.dev and upserts the catalog; removes stale ids not present upstream.
   */
  async refreshFromModelsDev(): Promise<OpencodeProvidersRefreshResult> {
    const url = process.env.OPENCODE_PROVIDERS_MODELS_DEV_URL?.trim() || OPENCODE_PROVIDERS_MODELS_DEV_URL;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as Record<string, ModelsDevProviderEntry>;
    const mapped = Object.values(payload)
      .map((entry) => this.mapEntry(entry))
      .filter((entry): entry is OpencodeProviderDto => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    if (mapped.length === 0) {
      throw new Error(`models.dev catalog at ${url} contained no valid providers`);
    }

    const now = new Date();
    const rows = mapped.map((provider) =>
      this.providersRepository.create({
        id: provider.id,
        name: provider.name,
        env: provider.env,
        models: provider.models,
        npm: provider.npm ?? null,
        api: provider.api ?? null,
        updatedAt: now,
      }),
    );

    await this.providersRepository.upsert(rows, {
      conflictPaths: ['id'],
      skipUpdateIfNoValuesChanged: false,
    });

    const keepIds = mapped.map((provider) => provider.id);
    const deleteResult = await this.providersRepository
      .createQueryBuilder()
      .delete()
      .where('id NOT IN (:...keepIds)', { keepIds })
      .execute();

    const removed = deleteResult.affected ?? 0;

    this.logger.log(`Refreshed OpenCode providers catalog: upserted=${mapped.length} removed=${removed}`);

    return { upserted: mapped.length, removed };
  }

  private mapEntry(entry: ModelsDevProviderEntry): OpencodeProviderDto | null {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) {
      return null;
    }

    const id = entry.id.trim();
    const dto: OpencodeProviderDto = {
      id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id,
      env: Array.isArray(entry.env)
        ? entry.env.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [],
      models: this.mapModels(entry.models),
    };

    if (typeof entry.npm === 'string' && entry.npm.trim()) {
      dto.npm = entry.npm.trim();
    }

    if (typeof entry.api === 'string' && entry.api.trim()) {
      dto.api = entry.api.trim();
    }

    return dto;
  }

  private mapModels(raw: unknown): OpencodeProviderModelDto[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }

    const models: OpencodeProviderModelDto[] = [];

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const modelId =
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as { id?: unknown }).id === 'string'
          ? String((value as { id: string }).id).trim()
          : key.trim();

      if (!modelId) {
        continue;
      }

      const modelName =
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as { name?: unknown }).name === 'string'
          ? String((value as { name: string }).name).trim()
          : modelId;

      models.push({
        id: modelId,
        name: modelName || modelId,
      });
    }

    models.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    return models;
  }

  private toDto(row: OpencodeProviderEntity): OpencodeProviderDto {
    const dto: OpencodeProviderDto = {
      id: row.id,
      name: row.name,
      env: Array.isArray(row.env) ? row.env : [],
      models: this.normalizeStoredModels(row.models),
    };

    if (row.npm) {
      dto.npm = row.npm;
    }

    if (row.api) {
      dto.api = row.api;
    }

    return dto;
  }

  private normalizeStoredModels(raw: unknown): OpencodeProviderModelDto[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    const models: OpencodeProviderModelDto[] = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id.trim() : '';

      if (!id) {
        continue;
      }

      const name =
        typeof (item as { name?: unknown }).name === 'string' && (item as { name: string }).name.trim()
          ? (item as { name: string }).name.trim()
          : id;

      models.push({ id, name });
    }

    return models;
  }
}
