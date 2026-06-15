import {
  ClientUsersRepository,
  ensureClientAccess,
  getUserFromRequest,
  type RequestWithUser,
  UsersRepository,
} from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CreateKnowledgeNodeDto,
  KnowledgePageActivityResponseDto,
  CreateKnowledgeRelationDto,
  KnowledgeNodeResponseDto,
  KnowledgePromptContextResponseDto,
  KnowledgeRelationResponseDto,
  ReorderKnowledgeNodeDto,
  UpdateKnowledgeNodeDto,
} from '../dto/knowledge';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import {
  KnowledgeActionType,
  KnowledgeActorType,
  KnowledgeNodeType,
  KnowledgeRelationSourceType,
  KnowledgeRelationTargetType,
} from '../entities/knowledge-node.enums';
import { KnowledgePageActivityEntity } from '../entities/knowledge-page-activity.entity';
import { KnowledgeRelationEntity } from '../entities/knowledge-relation.entity';
import { ClientsRepository } from '../repositories/clients.repository';

import { KnowledgeEmbeddingIndexService } from './embeddings/knowledge-embedding-index.service';
import { ExternalImportSyncMarkerService } from './external-import-sync-marker.service';
import { KNOWLEDGE_BOARD_EVENTS } from './knowledge-board-realtime.constants';
import { KnowledgeBoardRealtimeService } from './knowledge-board-realtime.service';
import { TICKETS_BOARD_EVENTS } from './ticket-board-realtime.constants';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { TicketsService } from './tickets.service';

@Injectable()
export class KnowledgeTreeService {
  constructor(
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeNodeRepo: Repository<KnowledgeNodeEntity>,
    @InjectRepository(KnowledgeRelationEntity)
    private readonly knowledgeRelationRepo: Repository<KnowledgeRelationEntity>,
    @InjectRepository(KnowledgePageActivityEntity)
    private readonly knowledgePageActivityRepo: Repository<KnowledgePageActivityEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly usersRepository: UsersRepository,
    private readonly ticketsService: TicketsService,
    private readonly ticketBoardRealtime: TicketBoardRealtimeService,
    private readonly knowledgeBoardRealtime: KnowledgeBoardRealtimeService,
    private readonly knowledgeEmbeddingIndexService: KnowledgeEmbeddingIndexService,
    @Inject(forwardRef(() => ExternalImportSyncMarkerService))
    private readonly externalImportSyncMarkerService: ExternalImportSyncMarkerService,
  ) {}

  private async assertClientAccess(clientId: string, req?: RequestWithUser): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  private async getNodeOrThrow(id: string): Promise<KnowledgeNodeEntity> {
    const node = await this.knowledgeNodeRepo.findOne({ where: { id } });

    if (!node) {
      throw new NotFoundException(`Knowledge node ${id} not found`);
    }

    return node;
  }

  private async assertNodeReadable(id: string, req?: RequestWithUser): Promise<KnowledgeNodeEntity> {
    const node = await this.getNodeOrThrow(id);

    await this.assertClientAccess(node.clientId, req);

    return node;
  }

  private async wouldCreateCycle(nodeId: string, newParentId: string): Promise<boolean> {
    let current: string | null = newParentId;
    const visited = new Set<string>();

    while (current) {
      if (current === nodeId || visited.has(current)) {
        return true;
      }

      visited.add(current);
      const row = await this.knowledgeNodeRepo.findOne({ where: { id: current }, select: ['parentId'] });

      current = row?.parentId ?? null;
    }

    return false;
  }

  private async assertValidParent(
    nodeType: KnowledgeNodeType,
    parentId: string | null | undefined,
    clientId: string,
  ): Promise<void> {
    if (!parentId) {
      return;
    }

    const parent = await this.getNodeOrThrow(parentId);

    if (parent.clientId !== clientId) {
      throw new BadRequestException('Parent must belong to same workspace');
    }

    if (parent.nodeType !== KnowledgeNodeType.FOLDER) {
      throw new BadRequestException('Parent must be a folder');
    }

    if (nodeType === KnowledgeNodeType.FOLDER || nodeType === KnowledgeNodeType.PAGE) {
      return;
    }
  }

  private async nextSortOrder(clientId: string, parentId?: string | null): Promise<number> {
    const siblings = await this.knowledgeNodeRepo.find({
      where: { clientId, parentId: parentId ?? null },
      select: ['sortOrder'],
      order: { sortOrder: 'DESC' },
      take: 1,
    });

    return (siblings[0]?.sortOrder ?? -1) + 1;
  }

  private mapNode(row: KnowledgeNodeEntity): KnowledgeNodeResponseDto {
    const longSha = row.longSha ?? KnowledgeNodeEntity.deriveLongSha(row.id);

    return {
      id: row.id,
      shas: {
        short: longSha.slice(0, 7),
        long: longSha,
      },
      clientId: row.clientId,
      nodeType: row.nodeType,
      parentId: row.parentId ?? null,
      title: row.title,
      content: row.content ?? null,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapRelation(row: KnowledgeRelationEntity): KnowledgeRelationResponseDto {
    return {
      id: row.id,
      clientId: row.clientId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      targetType: row.targetType,
      targetNodeId: row.targetNodeId ?? null,
      targetTicketLongSha: row.targetTicketLongSha ?? null,
      createdAt: row.createdAt,
    };
  }

  private emitKnowledgeTreeChanged(clientId: string): void {
    this.knowledgeBoardRealtime.emitToClient(clientId, KNOWLEDGE_BOARD_EVENTS.knowledgeTreeChanged, { clientId });
  }

  private emitKnowledgeRelationChanged(
    clientId: string,
    sourceType: KnowledgeRelationSourceType,
    sourceId: string,
  ): void {
    this.knowledgeBoardRealtime.emitToClient(clientId, KNOWLEDGE_BOARD_EVENTS.knowledgeRelationChanged, {
      clientId,
      sourceType,
      sourceId,
    });
    this.ticketBoardRealtime.emitToClient(clientId, TICKETS_BOARD_EVENTS.knowledgeRelationChanged, {
      clientId,
      sourceType,
      sourceId,
    });
  }

  private emitKnowledgePageActivityCreated(clientId: string, activity: KnowledgePageActivityResponseDto): void {
    this.knowledgeBoardRealtime.emitToClient(clientId, KNOWLEDGE_BOARD_EVENTS.knowledgePageActivityCreated, activity);
  }

  private isApiKeyMode(): boolean {
    const authMethod = process.env.AUTHENTICATION_METHOD?.toLowerCase().trim();

    return authMethod === 'api-key' || (authMethod === undefined && !!process.env.STATIC_API_KEY);
  }

  private resolveActor(req?: RequestWithUser): { actorType: KnowledgeActorType; actorUserId?: string } {
    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (info.isApiKeyAuth || this.isApiKeyMode()) {
      return { actorType: KnowledgeActorType.SYSTEM };
    }

    if (info.userId) {
      return { actorType: KnowledgeActorType.HUMAN, actorUserId: info.userId };
    }

    return { actorType: KnowledgeActorType.SYSTEM };
  }

  private async mapPageActivity(row: KnowledgePageActivityEntity): Promise<KnowledgePageActivityResponseDto> {
    let actorEmail: string | null = null;

    if (row.actorUserId) {
      const u = await this.usersRepository.findById(row.actorUserId);

      actorEmail = u?.email ?? null;
    }

    return {
      id: row.id,
      pageId: row.pageId,
      occurredAt: row.occurredAt,
      actorType: row.actorType,
      actorUserId: row.actorUserId ?? null,
      actorEmail,
      actionType: row.actionType,
      payload: row.payload,
    };
  }

  private async appendPageActivity(
    pageId: string,
    clientId: string,
    actionType: KnowledgeActionType,
    payload: Record<string, unknown>,
    req?: RequestWithUser,
  ): Promise<void> {
    const actor = this.resolveActor(req);
    const activityRow = await this.knowledgePageActivityRepo.save(
      this.knowledgePageActivityRepo.create({
        pageId,
        actorType: actor.actorType,
        actorUserId: actor.actorUserId ?? null,
        actionType,
        payload,
      }),
    );

    this.emitKnowledgePageActivityCreated(clientId, await this.mapPageActivity(activityRow));
  }

  async createNode(dto: CreateKnowledgeNodeDto, req?: RequestWithUser): Promise<KnowledgeNodeResponseDto> {
    let clientId = dto.clientId;

    if (!dto.parentId && !clientId) {
      throw new BadRequestException('clientId is required when parentId is not set');
    }

    if (dto.parentId) {
      const parent = await this.getNodeOrThrow(dto.parentId);

      await this.assertClientAccess(parent.clientId, req);
      clientId = parent.clientId;
    } else {
      await this.assertClientAccess(clientId!, req);
    }

    await this.assertValidParent(dto.nodeType, dto.parentId, clientId!);
    const sortOrder = await this.nextSortOrder(clientId!, dto.parentId ?? null);
    const created = await this.knowledgeNodeRepo.save(
      this.knowledgeNodeRepo.create({
        clientId: clientId!,
        nodeType: dto.nodeType,
        parentId: dto.parentId ?? null,
        title: dto.title.trim(),
        content: dto.nodeType === KnowledgeNodeType.PAGE ? (dto.content ?? '') : null,
        sortOrder,
      }),
    );

    created.longSha = KnowledgeNodeEntity.deriveLongSha(created.id);
    const saved = await this.knowledgeNodeRepo.save(created);

    this.emitKnowledgeTreeChanged(saved.clientId);

    if (saved.nodeType === KnowledgeNodeType.PAGE) {
      await this.knowledgeEmbeddingIndexService.reindexPage(saved.clientId, saved.id, saved.title, saved.content ?? '');
      await this.appendPageActivity(saved.id, saved.clientId, KnowledgeActionType.CREATED, { title: saved.title }, req);
    }

    return this.mapNode(saved);
  }

  async listNodes(clientId: string, req?: RequestWithUser): Promise<KnowledgeNodeResponseDto[]> {
    await this.assertClientAccess(clientId, req);
    const rows = await this.knowledgeNodeRepo.find({
      where: { clientId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    return rows.map((row) => this.mapNode(row));
  }

  async getTree(clientId: string, req?: RequestWithUser): Promise<KnowledgeNodeResponseDto[]> {
    const rows = await this.listNodes(clientId, req);
    const byParent = new Map<string | null, KnowledgeNodeResponseDto[]>();

    for (const row of rows) {
      const key = row.parentId ?? null;
      const list = byParent.get(key) ?? [];

      list.push(row);
      byParent.set(key, list);
    }

    const build = (parentId: string | null): KnowledgeNodeResponseDto[] => {
      const children = byParent.get(parentId) ?? [];

      return children
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
        .map((child) => ({
          ...child,
          children: build(child.id),
        }));
    };

    return build(null);
  }

  async getNode(id: string, req?: RequestWithUser): Promise<KnowledgeNodeResponseDto> {
    const node = await this.assertNodeReadable(id, req);

    return this.mapNode(node);
  }

  async updateNode(id: string, dto: UpdateKnowledgeNodeDto, req?: RequestWithUser): Promise<KnowledgeNodeResponseDto> {
    const node = await this.assertNodeReadable(id, req);
    const before = {
      title: node.title,
      content: node.content ?? null,
      parentId: node.parentId ?? null,
    };

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('Node cannot be its own parent');
      }

      if (dto.parentId) {
        await this.assertValidParent(node.nodeType, dto.parentId, node.clientId);

        if (await this.wouldCreateCycle(node.id, dto.parentId)) {
          throw new BadRequestException('Invalid parent: would create a cycle');
        }
      }

      node.parentId = dto.parentId;
    }

    if (dto.title !== undefined) {
      node.title = dto.title.trim();
    }

    if (dto.content !== undefined) {
      if (node.nodeType !== KnowledgeNodeType.PAGE) {
        throw new BadRequestException('Only pages can have content');
      }

      node.content = dto.content;
    }

    const saved = await this.knowledgeNodeRepo.save(node);

    this.emitKnowledgeTreeChanged(saved.clientId);

    if (saved.nodeType === KnowledgeNodeType.PAGE) {
      await this.knowledgeEmbeddingIndexService.reindexPage(saved.clientId, saved.id, saved.title, saved.content ?? '');

      if (before.parentId !== (saved.parentId ?? null)) {
        await this.appendPageActivity(
          saved.id,
          saved.clientId,
          KnowledgeActionType.PARENT_CHANGED,
          { fromParentId: before.parentId, toParentId: saved.parentId ?? null },
          req,
        );
      }

      if (before.title !== saved.title) {
        await this.appendPageActivity(
          saved.id,
          saved.clientId,
          KnowledgeActionType.FIELD_UPDATED,
          { field: 'title', from: before.title, to: saved.title },
          req,
        );
      }

      if (before.content !== (saved.content ?? null)) {
        await this.appendPageActivity(saved.id, saved.clientId, KnowledgeActionType.CONTENT_UPDATED, {}, req);
      }
    }

    return this.mapNode(saved);
  }

  async reorderNode(
    id: string,
    dto: ReorderKnowledgeNodeDto,
    req?: RequestWithUser,
  ): Promise<KnowledgeNodeResponseDto> {
    const node = await this.assertNodeReadable(id, req);

    node.sortOrder = dto.sortOrder;
    const saved = await this.knowledgeNodeRepo.save(node);

    this.emitKnowledgeTreeChanged(saved.clientId);

    if (saved.nodeType === KnowledgeNodeType.PAGE) {
      await this.appendPageActivity(
        saved.id,
        saved.clientId,
        KnowledgeActionType.SORT_ORDER_CHANGED,
        { sortOrder: saved.sortOrder },
        req,
      );
    }

    return this.mapNode(saved);
  }

  async deleteNode(id: string, req?: RequestWithUser, releaseExternalSyncMarker = false): Promise<void> {
    const node = await this.assertNodeReadable(id, req);
    const childCount = await this.knowledgeNodeRepo.count({ where: { parentId: node.id } });

    if (childCount > 0) {
      throw new ConflictException('Cannot delete folder with children');
    }

    await this.knowledgeNodeRepo.manager.transaction(async (em) => {
      await this.externalImportSyncMarkerService.applyKnowledgeNodeDeleteInTransaction(
        em,
        node.id,
        releaseExternalSyncMarker,
      );
      await em.getRepository(KnowledgeNodeEntity).delete(node.id);
    });
    await this.knowledgeEmbeddingIndexService.deleteForNode(node.id);
    this.emitKnowledgeTreeChanged(node.clientId);
  }

  /**
   * Internal: create or update a knowledge page from an external import (system actor).
   */
  async importUpsertKnowledgePage(params: {
    clientId: string;
    parentFolderId: string | null;
    title: string;
    content: string;
    existingNodeId?: string | null;
    /** When updating an existing page, keep stored body (used for ancestor placeholders). */
    preserveExistingContent?: boolean;
  }): Promise<KnowledgeNodeResponseDto> {
    const { clientId, parentFolderId, title, content, existingNodeId, preserveExistingContent } = params;

    if (!(await this.clientsRepository.findById(clientId))) {
      throw new NotFoundException(`Client ${clientId} not found`);
    }

    if (parentFolderId) {
      const parent = await this.getNodeOrThrow(parentFolderId);

      if (parent.clientId !== clientId) {
        throw new BadRequestException('Parent folder must belong to the import workspace');
      }

      if (parent.nodeType !== KnowledgeNodeType.FOLDER) {
        throw new BadRequestException('Parent must be a folder');
      }
    }

    const reqSystem = undefined;

    if (existingNodeId) {
      const node = await this.knowledgeNodeRepo.findOne({ where: { id: existingNodeId, clientId } });

      if (!node) {
        throw new NotFoundException('Knowledge node not found for import update');
      }

      if (node.nodeType !== KnowledgeNodeType.PAGE) {
        throw new BadRequestException('Import target must be a page');
      }

      const before = {
        title: node.title,
        content: node.content ?? null,
        parentId: node.parentId ?? null,
      };

      node.title = title.trim();

      if (!preserveExistingContent) {
        node.content = content;
      }

      node.parentId = parentFolderId ?? null;

      const saved = await this.knowledgeNodeRepo.save(node);

      this.emitKnowledgeTreeChanged(saved.clientId);
      await this.knowledgeEmbeddingIndexService.reindexPage(saved.clientId, saved.id, saved.title, saved.content ?? '');

      if (before.parentId !== (saved.parentId ?? null)) {
        await this.appendPageActivity(
          saved.id,
          saved.clientId,
          KnowledgeActionType.PARENT_CHANGED,
          { fromParentId: before.parentId, toParentId: saved.parentId ?? null, source: 'external_import' },
          reqSystem,
        );
      }

      if (before.title !== saved.title) {
        await this.appendPageActivity(
          saved.id,
          saved.clientId,
          KnowledgeActionType.FIELD_UPDATED,
          { field: 'title', from: before.title, to: saved.title, source: 'external_import' },
          reqSystem,
        );
      }

      if (!preserveExistingContent && before.content !== (saved.content ?? null)) {
        await this.appendPageActivity(saved.id, saved.clientId, KnowledgeActionType.CONTENT_UPDATED, {}, reqSystem);
      }

      return this.mapNode(saved);
    }

    const sortOrder = await this.nextSortOrder(clientId, parentFolderId ?? null);
    const created = await this.knowledgeNodeRepo.save(
      this.knowledgeNodeRepo.create({
        clientId,
        nodeType: KnowledgeNodeType.PAGE,
        parentId: parentFolderId ?? null,
        title: title.trim(),
        content,
        sortOrder,
      }),
    );

    created.longSha = KnowledgeNodeEntity.deriveLongSha(created.id);
    const saved = await this.knowledgeNodeRepo.save(created);

    this.emitKnowledgeTreeChanged(saved.clientId);
    await this.knowledgeEmbeddingIndexService.reindexPage(saved.clientId, saved.id, saved.title, saved.content ?? '');
    await this.appendPageActivity(
      saved.id,
      saved.clientId,
      KnowledgeActionType.CREATED,
      { title: saved.title },
      reqSystem,
    );

    return this.mapNode(saved);
  }

  /**
   * Internal: create or relocate a knowledge folder for external import (system actor).
   */
  async importEnsureKnowledgeFolder(params: {
    clientId: string;
    parentFolderId: string | null;
    title: string;
    existingFolderId?: string | null;
  }): Promise<KnowledgeNodeResponseDto> {
    const { clientId, parentFolderId, title, existingFolderId } = params;

    if (!(await this.clientsRepository.findById(clientId))) {
      throw new NotFoundException(`Client ${clientId} not found`);
    }

    if (parentFolderId) {
      const parent = await this.getNodeOrThrow(parentFolderId);

      if (parent.clientId !== clientId) {
        throw new BadRequestException('Parent folder must belong to the import workspace');
      }

      if (parent.nodeType !== KnowledgeNodeType.FOLDER) {
        throw new BadRequestException('Parent must be a folder');
      }
    }

    if (existingFolderId) {
      const node = await this.knowledgeNodeRepo.findOne({ where: { id: existingFolderId, clientId } });

      if (!node) {
        throw new NotFoundException('Knowledge folder not found for import update');
      }

      if (node.nodeType !== KnowledgeNodeType.FOLDER) {
        throw new BadRequestException('Import target must be a folder');
      }

      node.title = title.trim();
      node.parentId = parentFolderId ?? null;
      const saved = await this.knowledgeNodeRepo.save(node);

      this.emitKnowledgeTreeChanged(saved.clientId);

      return this.mapNode(saved);
    }

    const sortOrder = await this.nextSortOrder(clientId, parentFolderId ?? null);
    const created = await this.knowledgeNodeRepo.save(
      this.knowledgeNodeRepo.create({
        clientId,
        nodeType: KnowledgeNodeType.FOLDER,
        parentId: parentFolderId ?? null,
        title: title.trim(),
        content: null,
        sortOrder,
      }),
    );

    created.longSha = KnowledgeNodeEntity.deriveLongSha(created.id);
    const saved = await this.knowledgeNodeRepo.save(created);

    this.emitKnowledgeTreeChanged(saved.clientId);

    return this.mapNode(saved);
  }

  async duplicateNode(id: string, req?: RequestWithUser): Promise<KnowledgeNodeResponseDto> {
    const seed = await this.assertNodeReadable(id, req);
    const all = await this.knowledgeNodeRepo.find({
      where: { clientId: seed.clientId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const byParent = new Map<string | null, KnowledgeNodeEntity[]>();

    for (const row of all) {
      const key = row.parentId ?? null;
      const list = byParent.get(key) ?? [];

      list.push(row);
      byParent.set(key, list);
    }

    const cloneRecursively = async (
      source: KnowledgeNodeEntity,
      parentId: string | null,
      titleSuffix: string,
    ): Promise<KnowledgeNodeEntity> => {
      const cloned = await this.knowledgeNodeRepo.save(
        this.knowledgeNodeRepo.create({
          clientId: source.clientId,
          nodeType: source.nodeType,
          parentId,
          title: `${source.title}${titleSuffix}`,
          content: source.content ?? null,
          sortOrder: await this.nextSortOrder(source.clientId, parentId),
        }),
      );

      cloned.longSha = KnowledgeNodeEntity.deriveLongSha(cloned.id);
      const saved = await this.knowledgeNodeRepo.save(cloned);
      const children = byParent.get(source.id) ?? [];

      for (const child of children) {
        await cloneRecursively(child, saved.id, '');
      }

      return saved;
    };
    const duplicated = await cloneRecursively(seed, seed.parentId ?? null, ' (Copy)');

    this.emitKnowledgeTreeChanged(seed.clientId);

    if (duplicated.nodeType === KnowledgeNodeType.PAGE) {
      await this.knowledgeEmbeddingIndexService.reindexPage(
        duplicated.clientId,
        duplicated.id,
        duplicated.title,
        duplicated.content ?? '',
      );
      await this.appendPageActivity(
        duplicated.id,
        duplicated.clientId,
        KnowledgeActionType.DUPLICATED,
        { sourcePageId: seed.id },
        req,
      );
    }

    return this.mapNode(duplicated);
  }

  async listPageActivity(
    pageId: string,
    limit: number,
    offset: number,
    req?: RequestWithUser,
  ): Promise<KnowledgePageActivityResponseDto[]> {
    const page = await this.assertNodeReadable(pageId, req);

    if (page.nodeType !== KnowledgeNodeType.PAGE) {
      throw new BadRequestException('Activity is only available for pages');
    }

    const rows = await this.knowledgePageActivityRepo.find({
      where: { pageId },
      order: { occurredAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return Promise.all(rows.map((row) => this.mapPageActivity(row)));
  }

  async findNodeBySha(clientId: string, sha: string, req?: RequestWithUser): Promise<KnowledgeNodeResponseDto | null> {
    await this.assertClientAccess(clientId, req);
    const normalized = sha.trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    let node: KnowledgeNodeEntity | null = null;

    if (normalized.length >= 40) {
      node = await this.knowledgeNodeRepo.findOne({
        where: { clientId, longSha: normalized.slice(0, 40) },
      });
    } else {
      node = await this.knowledgeNodeRepo
        .createQueryBuilder('n')
        .where('n.client_id = :clientId', { clientId })
        .andWhere('n.long_sha LIKE :prefix', { prefix: `${normalized}%` })
        .orderBy('n.created_at', 'DESC')
        .getOne();
    }

    return node ? this.mapNode(node) : null;
  }

  async createRelation(dto: CreateKnowledgeRelationDto, req?: RequestWithUser): Promise<KnowledgeRelationResponseDto> {
    await this.assertClientAccess(dto.clientId, req);

    return this.persistKnowledgeRelation(dto, req);
  }

  /**
   * System-only: create a relation during external import (no end-user {@link assertClientAccess}).
   * Workspace consistency is still enforced (e.g. target node must belong to {@link CreateKnowledgeRelationDto.clientId}).
   */
  async importCreateRelation(dto: CreateKnowledgeRelationDto): Promise<KnowledgeRelationResponseDto> {
    return this.persistKnowledgeRelation(dto, undefined);
  }

  private async persistKnowledgeRelation(
    dto: CreateKnowledgeRelationDto,
    req?: RequestWithUser,
  ): Promise<KnowledgeRelationResponseDto> {
    if (dto.targetType === KnowledgeRelationTargetType.TICKET && !dto.targetTicketSha) {
      throw new BadRequestException('targetTicketSha is required for ticket relations');
    }

    if (
      (dto.targetType === KnowledgeRelationTargetType.FOLDER || dto.targetType === KnowledgeRelationTargetType.PAGE) &&
      !dto.targetNodeId
    ) {
      throw new BadRequestException('targetNodeId is required for node relations');
    }

    if (dto.targetNodeId) {
      const target = await this.getNodeOrThrow(dto.targetNodeId);

      if (target.clientId !== dto.clientId) {
        throw new ForbiddenException('Relation target must belong to same workspace');
      }

      if (
        (dto.targetType === KnowledgeRelationTargetType.FOLDER && target.nodeType !== KnowledgeNodeType.FOLDER) ||
        (dto.targetType === KnowledgeRelationTargetType.PAGE && target.nodeType !== KnowledgeNodeType.PAGE)
      ) {
        throw new BadRequestException('targetType does not match target node type');
      }
    }

    const relation = await this.knowledgeRelationRepo.save(
      this.knowledgeRelationRepo.create({
        clientId: dto.clientId,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        targetType: dto.targetType,
        targetNodeId: dto.targetNodeId ?? null,
        targetTicketLongSha: dto.targetTicketSha?.trim().toLowerCase() ?? null,
      }),
    );

    this.emitKnowledgeRelationChanged(relation.clientId, relation.sourceType, relation.sourceId);

    if (relation.sourceType === KnowledgeRelationSourceType.PAGE) {
      await this.appendPageActivity(
        relation.sourceId,
        relation.clientId,
        KnowledgeActionType.RELATION_ADDED,
        {
          relationId: relation.id,
          targetType: relation.targetType,
          targetNodeId: relation.targetNodeId ?? null,
          targetTicketLongSha: relation.targetTicketLongSha ?? null,
        },
        req,
      );
    }

    return this.mapRelation(relation);
  }

  async listRelations(
    clientId: string,
    sourceType: KnowledgeRelationSourceType,
    sourceId: string,
    req?: RequestWithUser,
  ): Promise<KnowledgeRelationResponseDto[]> {
    await this.assertClientAccess(clientId, req);

    return this.listRelationsForImport(clientId, sourceType, sourceId);
  }

  /**
   * System-only: list relations for a source during external import (no end-user access check).
   */
  async importListRelations(
    clientId: string,
    sourceType: KnowledgeRelationSourceType,
    sourceId: string,
  ): Promise<KnowledgeRelationResponseDto[]> {
    return this.listRelationsForImport(clientId, sourceType, sourceId);
  }

  private async listRelationsForImport(
    clientId: string,
    sourceType: KnowledgeRelationSourceType,
    sourceId: string,
  ): Promise<KnowledgeRelationResponseDto[]> {
    const rows = await this.knowledgeRelationRepo.find({
      where: { clientId, sourceType, sourceId },
      order: { createdAt: 'ASC' },
    });

    return rows.map((row) => this.mapRelation(row));
  }

  async deleteRelation(id: string, req?: RequestWithUser): Promise<void> {
    const relation = await this.knowledgeRelationRepo.findOne({ where: { id } });

    if (!relation) {
      throw new NotFoundException(`Knowledge relation ${id} not found`);
    }

    await this.assertClientAccess(relation.clientId, req);
    await this.knowledgeRelationRepo.delete(id);
    this.emitKnowledgeRelationChanged(relation.clientId, relation.sourceType, relation.sourceId);

    if (relation.sourceType === KnowledgeRelationSourceType.PAGE) {
      await this.appendPageActivity(
        relation.sourceId,
        relation.clientId,
        KnowledgeActionType.RELATION_REMOVED,
        {
          relationId: relation.id,
          targetType: relation.targetType,
          targetNodeId: relation.targetNodeId ?? null,
          targetTicketLongSha: relation.targetTicketLongSha ?? null,
        },
        req,
      );
    }
  }

  private async collectSubtreePages(clientId: string, rootNodeId: string): Promise<KnowledgeNodeEntity[]> {
    const all = await this.knowledgeNodeRepo.find({
      where: { clientId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const byParent = new Map<string | null, KnowledgeNodeEntity[]>();

    for (const row of all) {
      const key = row.parentId ?? null;
      const list = byParent.get(key) ?? [];

      list.push(row);
      byParent.set(key, list);
    }

    const result: KnowledgeNodeEntity[] = [];
    const stack: string[] = [rootNodeId];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const id = stack.pop()!;

      if (visited.has(id)) {
        continue;
      }

      visited.add(id);
      const row = all.find((n) => n.id === id);

      if (!row) {
        continue;
      }

      if (row.nodeType === KnowledgeNodeType.PAGE) {
        result.push(row);
      }

      const children = byParent.get(id) ?? [];

      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i].id);
      }
    }

    return result;
  }

  private pageToPromptSection(page: KnowledgeNodeEntity): string {
    return `Knowledge Page: ${page.title}\n${page.content ?? ''}`.trim();
  }

  async collectPromptContextsForSource(
    clientId: string,
    sourceType: KnowledgeRelationSourceType,
    sourceId: string,
    req?: RequestWithUser,
  ): Promise<KnowledgePromptContextResponseDto> {
    await this.assertClientAccess(clientId, req);
    const relations = await this.knowledgeRelationRepo.find({
      where: { clientId, sourceType, sourceId },
      order: { createdAt: 'ASC' },
    });
    const sections: string[] = [];
    const seenPageIds = new Set<string>();
    const seenTicketShas = new Set<string>();

    for (const rel of relations) {
      if (rel.targetType === KnowledgeRelationTargetType.TICKET && rel.targetTicketLongSha) {
        if (seenTicketShas.has(rel.targetTicketLongSha)) {
          continue;
        }

        seenTicketShas.add(rel.targetTicketLongSha);
        const ticketPrompt = await this.ticketsService.getPrototypePromptByClientSha(clientId, rel.targetTicketLongSha);

        if (ticketPrompt?.prompt) {
          sections.push(ticketPrompt.prompt);
        }

        continue;
      }

      if (!rel.targetNodeId) {
        continue;
      }

      const target = await this.knowledgeNodeRepo.findOne({ where: { id: rel.targetNodeId, clientId } });

      if (!target) {
        continue;
      }

      if (target.nodeType === KnowledgeNodeType.PAGE) {
        if (!seenPageIds.has(target.id)) {
          seenPageIds.add(target.id);
          sections.push(this.pageToPromptSection(target));
        }
      } else {
        const subtreePages = await this.collectSubtreePages(clientId, target.id);

        for (const page of subtreePages) {
          if (seenPageIds.has(page.id)) {
            continue;
          }

          seenPageIds.add(page.id);
          sections.push(this.pageToPromptSection(page));
        }
      }
    }

    return { promptSections: sections };
  }

  async collectPromptContextsByHashes(
    clientId: string,
    hashes: string[],
    req?: RequestWithUser,
  ): Promise<KnowledgePromptContextResponseDto> {
    await this.assertClientAccess(clientId, req);
    const uniq = Array.from(new Set(hashes.map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0)));
    const pages: KnowledgeNodeEntity[] = [];
    const seen = new Set<string>();

    for (const hash of uniq) {
      const node = await this.findNodeBySha(clientId, hash, req);

      if (!node) {
        continue;
      }

      if (node.nodeType === KnowledgeNodeType.PAGE) {
        const page = await this.knowledgeNodeRepo.findOne({ where: { id: node.id } });

        if (page && !seen.has(page.id)) {
          seen.add(page.id);
          pages.push(page);
        }
      } else {
        const subtreePages = await this.collectSubtreePages(clientId, node.id);

        for (const page of subtreePages) {
          if (seen.has(page.id)) {
            continue;
          }

          seen.add(page.id);
          pages.push(page);
        }
      }
    }

    return { promptSections: pages.map((page) => this.pageToPromptSection(page)) };
  }
}
