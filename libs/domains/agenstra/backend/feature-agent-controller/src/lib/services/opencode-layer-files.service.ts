import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, In, Like, Repository } from 'typeorm';

import {
  CreateOpencodeLayerFileDto,
  OpencodeLayerFileListEntryDto,
  OpencodeLayerFileListResponseDto,
  OpencodeLayerFileResponseDto,
} from '../dto/opencode-layer-file.dto';
import { OpencodeLayerFileSyncTargetEntity } from '../entities/opencode-layer-file-sync-target.entity';
import { OpencodeLayerFileEntity, type OpencodeLayerFileEntryKind } from '../entities/opencode-layer-file.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import {
  childSegmentUnder,
  ancestorLayerPaths,
  inferLayerEntryKind,
  joinLayerChildPath,
  parentLayerPath,
  sanitizeLayerRelativePath,
  sha256Hex,
  toEmittedLayerPath,
  type OpencodeLayerFileScope,
} from '../utils/opencode-layer-file-path.utils';
import { ClientAgentFileSystemProxyService } from './client-agent-file-system-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';

@Injectable()
export class OpencodeLayerFilesService {
  private readonly logger = new Logger(OpencodeLayerFilesService.name);

  constructor(
    @InjectRepository(OpencodeLayerFileEntity)
    private readonly fileRepo: Repository<OpencodeLayerFileEntity>,
    @InjectRepository(OpencodeLayerFileSyncTargetEntity)
    private readonly syncRepo: Repository<OpencodeLayerFileSyncTargetEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly agentProxy: ClientAgentProxyService,
    private readonly fileSystemProxy: ClientAgentFileSystemProxyService,
  ) {}

  async listGlobal(path = '.'): Promise<OpencodeLayerFileListResponseDto> {
    return await this.list('global', null, path);
  }

  async listWorkspace(clientId: string, path = '.'): Promise<OpencodeLayerFileListResponseDto> {
    return await this.list('workspace', clientId, path);
  }

  async createGlobal(dto: CreateOpencodeLayerFileDto): Promise<OpencodeLayerFileResponseDto> {
    const saved = await this.createEntry('global', null, dto);

    await this.reconcileAndEmit(saved);

    return this.toDto(saved);
  }

  async createWorkspace(clientId: string, dto: CreateOpencodeLayerFileDto): Promise<OpencodeLayerFileResponseDto> {
    const saved = await this.createEntry('workspace', clientId, dto);

    await this.reconcileAndEmit(saved);

    return this.toDto(saved);
  }

  /**
   * Ensure a path exists (mkdir -p for directories / ancestors). Idempotent.
   * Used when opening a config path that has not been materialized yet.
   */
  async ensureGlobal(path: string, entryKind?: OpencodeLayerFileEntryKind): Promise<OpencodeLayerFileResponseDto> {
    return await this.ensurePath('global', null, path, entryKind);
  }

  async ensureWorkspace(
    clientId: string,
    path: string,
    entryKind?: OpencodeLayerFileEntryKind,
  ): Promise<OpencodeLayerFileResponseDto> {
    return await this.ensurePath('workspace', clientId, path, entryKind);
  }

  async getGlobal(path: string): Promise<OpencodeLayerFileResponseDto> {
    return await this.get('global', null, path);
  }

  async putGlobal(path: string, content: string): Promise<OpencodeLayerFileResponseDto> {
    const saved = await this.upsertFile('global', null, path, content);

    await this.reconcileAndEmit(saved);

    return this.toDto(saved);
  }

  async deleteGlobal(path: string): Promise<void> {
    await this.remove('global', null, path);
  }

  async getWorkspace(clientId: string, path: string): Promise<OpencodeLayerFileResponseDto> {
    return await this.get('workspace', clientId, path);
  }

  async putWorkspace(clientId: string, path: string, content: string): Promise<OpencodeLayerFileResponseDto> {
    const saved = await this.upsertFile('workspace', clientId, path, content);

    await this.reconcileAndEmit(saved);

    return this.toDto(saved);
  }

  async deleteWorkspace(clientId: string, path: string): Promise<void> {
    await this.remove('workspace', clientId, path);
  }

  /** Ensure an agent has all applicable layer files (start/restart hook). */
  async emitAllForAgent(clientId: string, agentId: string): Promise<void> {
    const files = await this.fileRepo.find({
      where: [
        { scope: 'global', clientId: IsNull() },
        { scope: 'workspace', clientId },
      ],
    });

    // Directories first so mkdir -p parents exist before file writes.
    const ordered = [...files].sort((a, b) => {
      if (a.entryKind !== b.entryKind) {
        return a.entryKind === 'directory' ? -1 : 1;
      }

      return a.path.length - b.path.length;
    });

    for (const file of ordered) {
      await this.ensureSyncTarget(file, clientId, agentId);
      await this.emitToAgent(file, clientId, agentId);
    }
  }

  /** Reset failed targets to pending, then emit all applicable layer files. */
  async resetFailedAndEmitAllForAgent(clientId: string, agentId: string): Promise<void> {
    await this.syncRepo.update({ agentId, syncStatus: 'failed' }, { syncStatus: 'pending', lastError: null });
    await this.emitAllForAgent(clientId, agentId);
  }

  async processPending(limit = 50): Promise<number> {
    const pending = await this.syncRepo.find({
      where: { syncStatus: In(['pending', 'failed']) },
      take: limit,
      relations: ['file'],
      order: { updatedAt: 'ASC' },
    });
    let done = 0;

    for (const target of pending) {
      if (!target.file) {
        continue;
      }

      await this.emitToAgent(target.file, target.clientId, target.agentId);
      done += 1;
    }

    return done;
  }

  async findPendingTargetIds(max: number): Promise<string[]> {
    const rows = await this.syncRepo.find({
      where: { syncStatus: In(['pending', 'failed']) },
      order: { updatedAt: 'ASC' },
      take: max,
      select: ['id'],
    });

    return rows.map((row) => row.id);
  }

  async processTargetById(targetId: string): Promise<void> {
    const target = await this.syncRepo.findOne({
      where: { id: targetId },
      relations: ['file'],
    });

    if (!target?.file) {
      return;
    }

    await this.emitToAgent(target.file, target.clientId, target.agentId);
  }

  private async ensurePath(
    scope: OpencodeLayerFileScope,
    clientId: string | null,
    path: string,
    entryKind?: OpencodeLayerFileEntryKind,
  ): Promise<OpencodeLayerFileResponseDto> {
    const trimmed = path?.trim() ?? '';

    // Virtual listing root — not a stored layer entry.
    if (!trimmed || trimmed === '.' || trimmed === './') {
      return {
        id: '',
        scope,
        clientId,
        path: '.',
        emittedPath: '.',
        entryKind: 'directory',
        content: '',
        contentSha: sha256Hex(''),
        updatedAt: new Date(0),
      };
    }

    const storagePath = sanitizeLayerRelativePath(path);
    const kind = entryKind ?? inferLayerEntryKind(storagePath);
    const existing = await this.fileRepo.findOne({
      where: { scope, clientId: clientId ?? IsNull(), path: storagePath },
    });

    let dto: OpencodeLayerFileResponseDto;

    if (existing) {
      if (existing.entryKind === 'directory' && kind === 'file') {
        throw new BadRequestException(`Path is a directory: ${storagePath}`);
      }

      dto = this.toDto(existing);
    } else {
      const saved = await this.createEntry(scope, clientId, {
        path: storagePath,
        entryKind: kind,
        content: kind === 'file' ? '' : undefined,
      });

      dto = this.toDto(saved);
    }

    // Wipe container leftovers under this path (keeping other VFS paths), then fan out VFS state.
    await this.resetContainerAndResync(scope, clientId, storagePath);

    return dto;
  }

  private async listAllClientAgents(clientId: string): Promise<Array<{ id: string }>> {
    const pageSize = 100;
    const agents: Array<{ id: string }> = [];
    let offset = 0;

    for (;;) {
      const page = await this.agentProxy.getClientAgents(clientId, pageSize, offset);

      if (page.length === 0) {
        break;
      }

      agents.push(...page);

      if (page.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return agents;
  }

  /**
   * On ensure: clear the path on agent containers, preserving paths owned by other VFS scopes,
   * then re-emit every applicable layer entry under that path so agents match VFS.
   */
  private async resetContainerAndResync(
    scope: OpencodeLayerFileScope,
    clientId: string | null,
    rootPath: string,
  ): Promise<void> {
    const clientIds = scope === 'global' ? await this.clientsRepository.findAllIds() : clientId ? [clientId] : [];

    if (!clientIds.length) {
      return;
    }

    const underRoot = await this.findEntriesUnderPath(rootPath);

    for (const targetClientId of clientIds) {
      let agents: Array<{ id: string }> = [];

      try {
        agents = await this.listAllClientAgents(targetClientId);
      } catch (error: unknown) {
        const err = error as { message?: string };

        this.logger.warn(`Skipping layer reset for client ${targetClientId}: ${err.message ?? 'unknown'}`);
        continue;
      }

      const protectedPaths = this.protectedPathsForClient(underRoot, scope, clientId, targetClientId);
      const applicable = underRoot.filter((file) => this.entryAppliesToClient(file, targetClientId));

      for (const agent of agents) {
        await this.cleanAgentPath(targetClientId, agent.id, rootPath, protectedPaths);
        await this.emitEntriesToAgent(applicable, targetClientId, agent.id);
      }
    }
  }

  private async findEntriesUnderPath(rootPath: string): Promise<OpencodeLayerFileEntity[]> {
    const exact = await this.fileRepo.find({ where: { path: rootPath } });
    const descendants = await this.fileRepo.find({
      where: { path: Like(`${rootPath}/%`) },
    });

    return [...exact, ...descendants];
  }

  private entryAppliesToClient(file: OpencodeLayerFileEntity, clientId: string): boolean {
    if (file.scope === 'global') {
      return true;
    }

    return file.clientId === clientId;
  }

  private isEnsuringEntry(
    file: OpencodeLayerFileEntity,
    scope: OpencodeLayerFileScope,
    clientId: string | null,
  ): boolean {
    if (file.scope !== scope) {
      return false;
    }

    if (scope === 'global') {
      return file.clientId == null;
    }

    return file.clientId === clientId;
  }

  /** Paths owned by another VFS that must survive the container wipe for this client. */
  private protectedPathsForClient(
    underRoot: OpencodeLayerFileEntity[],
    ensuringScope: OpencodeLayerFileScope,
    ensuringClientId: string | null,
    targetClientId: string,
  ): Set<string> {
    const protectedPaths = new Set<string>();

    for (const file of underRoot) {
      if (!this.entryAppliesToClient(file, targetClientId)) {
        continue;
      }

      if (this.isEnsuringEntry(file, ensuringScope, ensuringClientId)) {
        continue;
      }

      protectedPaths.add(file.path);

      for (const ancestor of ancestorLayerPaths(file.path)) {
        if (ancestor !== '/') {
          protectedPaths.add(ancestor);
        }
      }
    }

    return protectedPaths;
  }

  private async cleanAgentPath(
    clientId: string,
    agentId: string,
    rootPath: string,
    protectedPaths: Set<string>,
  ): Promise<void> {
    if (protectedPaths.size === 0) {
      try {
        await this.fileSystemProxy.deleteFileOrDirectory(clientId, agentId, rootPath, 'app');
      } catch {
        // Path may not exist yet on this agent.
      }

      return;
    }

    const diskPaths = await this.listContainerPathsDeep(clientId, agentId, rootPath);
    const toDelete = diskPaths
      .filter((path) => !this.shouldKeepContainerPath(path, protectedPaths))
      .sort((a, b) => b.length - a.length);

    for (const path of toDelete) {
      try {
        await this.fileSystemProxy.deleteFileOrDirectory(clientId, agentId, path, 'app');
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  private shouldKeepContainerPath(path: string, protectedPaths: Set<string>): boolean {
    if (protectedPaths.has(path)) {
      return true;
    }

    // Keep ancestors of protected paths so other-VFS files remain reachable.
    for (const protectedPath of protectedPaths) {
      if (protectedPath.startsWith(`${path}/`)) {
        return true;
      }
    }

    return false;
  }

  private async listContainerPathsDeep(clientId: string, agentId: string, rootPath: string): Promise<string[]> {
    const found: string[] = [];

    const walk = async (dirPath: string): Promise<void> => {
      let nodes: Array<{ name: string; type: 'file' | 'directory'; path: string }>;

      try {
        nodes = await this.fileSystemProxy.listDirectory(clientId, agentId, dirPath, 'app');
      } catch {
        return;
      }

      for (const node of nodes) {
        const childPath = node.path?.trim()
          ? sanitizeLayerRelativePath(node.path)
          : joinLayerChildPath(dirPath, node.name);

        found.push(childPath);

        if (node.type === 'directory') {
          await walk(childPath);
        }
      }
    };

    // Include the root itself when present so a full wipe can remove it when unprotected.
    found.push(rootPath);
    await walk(rootPath);

    return [...new Set(found)];
  }

  private async emitEntriesToAgent(
    entries: OpencodeLayerFileEntity[],
    clientId: string,
    agentId: string,
  ): Promise<void> {
    const ordered = [...entries].sort((a, b) => {
      if (a.entryKind !== b.entryKind) {
        return a.entryKind === 'directory' ? -1 : 1;
      }

      return a.path.length - b.path.length;
    });

    for (const file of ordered) {
      await this.ensureSyncTarget(file, clientId, agentId);
      await this.emitToAgent(file, clientId, agentId);
    }
  }

  /** Create missing ancestor directory markers (mkdir -p semantics in the layer DB). */
  private async ensureAncestorDirectories(
    scope: OpencodeLayerFileScope,
    clientId: string | null,
    path: string,
  ): Promise<void> {
    for (const ancestor of ancestorLayerPaths(path)) {
      if (ancestor === '/') {
        continue;
      }

      const existing = await this.fileRepo.findOne({
        where: { scope, clientId: clientId ?? IsNull(), path: ancestor },
      });

      if (existing) {
        if (existing.entryKind === 'file') {
          throw new BadRequestException(`Cannot create under file path: ${ancestor}`);
        }

        continue;
      }

      const dir = this.fileRepo.create({
        scope,
        clientId,
        path: ancestor,
        entryKind: 'directory',
        content: null,
        contentSha: sha256Hex(''),
      });

      await this.fileRepo.save(dir);
    }
  }

  private async list(
    scope: OpencodeLayerFileScope,
    clientId: string | null,
    rawPath: string,
  ): Promise<OpencodeLayerFileListResponseDto> {
    const root = !rawPath || rawPath === '.' || rawPath === './' ? '.' : sanitizeLayerRelativePath(rawPath);
    const likePrefix = root === '.' ? '%' : root === '/' ? '/%' : `${root}/%`;
    const rows = await this.fileRepo.find({
      where: {
        scope,
        clientId: clientId ?? IsNull(),
        path: Like(likePrefix),
      },
    });

    // Also include exact directory marker at root when listing inside it.
    if (root !== '.') {
      const self = await this.fileRepo.findOne({
        where: { scope, clientId: clientId ?? IsNull(), path: root },
      });

      if (self?.entryKind === 'file') {
        return { path: root, entries: [] };
      }
    }

    const byName = new Map<string, OpencodeLayerFileListEntryDto>();

    for (const row of rows) {
      const segment = childSegmentUnder(root === '.' ? '.' : root, row.path);

      if (!segment) {
        continue;
      }

      let childPath: string;

      if (root === '.') {
        // Preserve absolute vs relative when listing VFS top-level (e.g. `/tmp` vs `opt`).
        childPath = sanitizeLayerRelativePath(row.path).startsWith('/') ? `/${segment}` : segment;
      } else {
        childPath = `${root.replace(/\/$/, '')}/${segment}`;
      }

      const isDirectFile = sanitizeLayerRelativePath(row.path) === sanitizeLayerRelativePath(childPath);
      const entryKind: OpencodeLayerFileEntryKind = isDirectFile && row.entryKind === 'file' ? 'file' : 'directory';

      const existing = byName.get(segment);

      if (!existing || (existing.entryKind === 'file' && entryKind === 'directory')) {
        byName.set(segment, {
          name: segment,
          path: childPath,
          entryKind,
        });
      }
    }

    const entries = [...byName.values()].sort((a, b) => {
      if (a.entryKind !== b.entryKind) {
        return a.entryKind === 'directory' ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });

    return { path: root, entries };
  }

  private async createEntry(
    scope: OpencodeLayerFileScope,
    clientId: string | null,
    dto: CreateOpencodeLayerFileDto,
  ): Promise<OpencodeLayerFileEntity> {
    const storagePath = sanitizeLayerRelativePath(dto.path);
    const entryKind: OpencodeLayerFileEntryKind =
      dto.entryKind === 'directory' || dto.entryKind === 'file' ? dto.entryKind : inferLayerEntryKind(storagePath);
    await this.ensureAncestorDirectories(scope, clientId, storagePath);

    const existing = await this.fileRepo.findOne({
      where: { scope, clientId: clientId ?? IsNull(), path: storagePath },
    });

    if (existing) {
      throw new BadRequestException(`Path already exists: ${storagePath}`);
    }

    const content = entryKind === 'directory' ? null : (dto.content ?? '');
    const contentSha = entryKind === 'directory' ? sha256Hex('') : sha256Hex(content ?? '');
    const file = this.fileRepo.create({
      scope,
      clientId,
      path: storagePath,
      entryKind,
      content,
      contentSha,
    });

    return await this.fileRepo.save(file);
  }

  private async get(
    scope: OpencodeLayerFileScope,
    clientId: string | null,
    path: string,
  ): Promise<OpencodeLayerFileResponseDto> {
    const storagePath = sanitizeLayerRelativePath(path);
    const file = await this.fileRepo.findOne({
      where: {
        scope,
        clientId: clientId ?? IsNull(),
        path: storagePath,
      },
    });

    if (!file || file.entryKind === 'directory') {
      throw new NotFoundException(`Layer file not found: ${storagePath}`);
    }

    return this.toDto(file);
  }

  private async upsertFile(
    scope: OpencodeLayerFileScope,
    clientId: string | null,
    path: string,
    content: string,
  ): Promise<OpencodeLayerFileEntity> {
    const storagePath = sanitizeLayerRelativePath(path);
    await this.ensureAncestorDirectories(scope, clientId, storagePath);
    const contentSha = sha256Hex(content);
    let file = await this.fileRepo.findOne({
      where: {
        scope,
        clientId: clientId ?? IsNull(),
        path: storagePath,
      },
    });

    if (!file) {
      file = this.fileRepo.create({
        scope,
        clientId,
        path: storagePath,
        entryKind: 'file',
        content,
        contentSha,
      });
    } else if (file.entryKind === 'directory') {
      throw new BadRequestException(`Cannot write content to directory: ${storagePath}`);
    } else {
      file.content = content;
      file.contentSha = contentSha;
    }

    return await this.fileRepo.save(file);
  }

  private async remove(scope: OpencodeLayerFileScope, clientId: string | null, path: string): Promise<void> {
    const storagePath = sanitizeLayerRelativePath(path);
    const file = await this.fileRepo.findOne({
      where: {
        scope,
        clientId: clientId ?? IsNull(),
        path: storagePath,
      },
    });

    if (!file) {
      return;
    }

    // Remove descendants when deleting a directory (or a path that has children).
    const descendants = await this.fileRepo.find({
      where: {
        scope,
        clientId: clientId ?? IsNull(),
        path: Like(`${storagePath}/%`),
      },
    });

    if (descendants.length) {
      await this.fileRepo.remove(descendants);
    }

    await this.fileRepo.remove(file);
    await this.pruneEmptyAncestors(scope, clientId, storagePath);
  }

  /**
   * After deleting a path, remove empty mkdir -p directory markers walking toward the root.
   * Stops at the first ancestor that still has children or is not a directory marker.
   */
  private async pruneEmptyAncestors(
    scope: OpencodeLayerFileScope,
    clientId: string | null,
    deletedPath: string,
  ): Promise<void> {
    let current = parentLayerPath(deletedPath);

    while (current && current !== '/') {
      const remaining = await this.fileRepo.find({
        where: {
          scope,
          clientId: clientId ?? IsNull(),
          path: Like(`${current}/%`),
        },
        take: 1,
      });

      if (remaining.length > 0) {
        break;
      }

      const marker = await this.fileRepo.findOne({
        where: {
          scope,
          clientId: clientId ?? IsNull(),
          path: current,
        },
      });

      if (!marker || marker.entryKind !== 'directory') {
        break;
      }

      const parent = parentLayerPath(current);

      await this.fileRepo.remove(marker);
      current = parent;
    }
  }

  private async reconcileAndEmit(file: OpencodeLayerFileEntity): Promise<void> {
    const clientIds =
      file.scope === 'global' ? await this.clientsRepository.findAllIds() : file.clientId ? [file.clientId] : [];

    for (const clientId of clientIds) {
      let agents: Array<{ id: string }> = [];

      try {
        agents = await this.listAllClientAgents(clientId);
      } catch (error: unknown) {
        const err = error as { message?: string };

        this.logger.warn(`Skipping layer file fan-out for client ${clientId}: ${err.message ?? 'unknown'}`);
        continue;
      }

      for (const agent of agents) {
        await this.ensureSyncTarget(file, clientId, agent.id);
        await this.emitToAgent(file, clientId, agent.id);
      }
    }
  }

  private async ensureSyncTarget(file: OpencodeLayerFileEntity, clientId: string, agentId: string): Promise<void> {
    let target = await this.syncRepo.findOne({ where: { fileId: file.id, agentId } });

    if (!target) {
      target = this.syncRepo.create({
        fileId: file.id,
        clientId,
        agentId,
        syncStatus: 'pending',
      });
    } else if (target.syncedSha !== file.contentSha) {
      target.syncStatus = 'pending';
      target.lastError = null;
    }

    await this.syncRepo.save(target);
  }

  private async emitToAgent(file: OpencodeLayerFileEntity, clientId: string, agentId: string): Promise<void> {
    const target = await this.syncRepo.findOne({ where: { fileId: file.id, agentId } });
    const emittedPath = toEmittedLayerPath(file.scope, file.path);

    try {
      if (file.entryKind === 'directory') {
        await this.fileSystemProxy.createFileOrDirectory(clientId, agentId, emittedPath, { type: 'directory' }, 'app');
      } else {
        const buffer = Buffer.from(file.content ?? '', 'utf8');

        await this.fileSystemProxy.writeFile(clientId, agentId, emittedPath, buffer, 'app', {
          contentType: 'text/plain; charset=utf-8',
          fileType: 'text',
        });
      }

      if (target) {
        target.syncStatus = 'synced';
        target.syncedSha = file.contentSha;
        target.lastError = null;
        target.lastSyncedAt = new Date();
        await this.syncRepo.save(target);
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      const message = err.message ?? 'emit failed';

      this.logger.debug(`Layer file emit failed for agent ${agentId}: ${message}`);

      if (target) {
        target.syncStatus = 'failed';
        target.lastError = message;
        await this.syncRepo.save(target);
      }
    }
  }

  private toDto(file: OpencodeLayerFileEntity): OpencodeLayerFileResponseDto {
    return {
      id: file.id,
      scope: file.scope,
      clientId: file.clientId ?? null,
      path: file.path,
      emittedPath: toEmittedLayerPath(file.scope, file.path),
      entryKind: file.entryKind ?? 'file',
      content: file.content ?? '',
      contentSha: file.contentSha,
      updatedAt: file.updatedAt,
    };
  }
}
