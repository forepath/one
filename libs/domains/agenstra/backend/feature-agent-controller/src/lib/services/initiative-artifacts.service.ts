import {
  INITIATIVE_ARTIFACT_TEMPLATES,
  INITIATIVE_ARTIFACT_TYPE_LABELS,
  INITIATIVE_LIMITS,
  type InitiativeArtifactType,
} from '@forepath/agenstra/shared/util-initiative-method';
import type { RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';

import type {
  AcceptInitiativeArtifactDto,
  CreateInitiativeArtifactDto,
  PublishInitiativeArtifactDto,
  UpdateInitiativeArtifactDto,
} from '../dto/initiatives';
import type {
  InitiativeArtifactResponseDto,
  InitiativeArtifactVersionResponseDto,
} from '../dto/initiatives/initiative-response.dto';
import {
  InitiativeArtifactVersionEntity,
  type InitiativeArtifactVersionSource,
} from '../entities/initiative-artifact-version.entity';
import { InitiativeArtifactEntity } from '../entities/initiative-artifact.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeActionType } from '../entities/initiative.enums';
import type { InitiativeEntity } from '../entities/initiative.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgeNodeType } from '../entities/knowledge-node.enums';
import type { ContentPrincipal } from '../utils/agent-content-writer.utils';
import { initiativeArtifactEntityToDto, initiativeArtifactVersionToDto } from '../utils/initiative-mappers';

import { INITIATIVES_BOARD_EVENTS } from './initiative-board-realtime.constants';
import { InitiativesService, type InitiativeActor } from './initiatives.service';
import { KnowledgeTreeService } from './knowledge-tree.service';

export interface ArtifactWriteInput {
  type: InitiativeArtifactType;
  workItemId?: string | null;
  title?: string;
  content: string;
  source: InitiativeArtifactVersionSource;
  actor: InitiativeActor;
  runId?: string | null;
  proposalId?: string | null;
  /** Accept the written version at once (a human accepted the run / proposal that produced it). */
  accept?: boolean;
}

@Injectable()
export class InitiativeArtifactsService {
  constructor(
    @InjectRepository(InitiativeArtifactEntity)
    private readonly artifactRepo: Repository<InitiativeArtifactEntity>,
    @InjectRepository(InitiativeArtifactVersionEntity)
    private readonly versionRepo: Repository<InitiativeArtifactVersionEntity>,
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeNodeRepo: Repository<KnowledgeNodeEntity>,
    private readonly initiatives: InitiativesService,
    @Inject(forwardRef(() => KnowledgeTreeService))
    private readonly knowledgeTreeService: KnowledgeTreeService,
  ) {}

  async getForPrincipal(
    artifactId: string,
    req?: ContentPrincipal,
  ): Promise<{ artifact: InitiativeArtifactEntity; initiative: InitiativeEntity }> {
    const artifact = await this.artifactRepo.findOne({ where: { id: artifactId } });

    if (!artifact) {
      throw new NotFoundException('Document not found');
    }

    const initiative = await this.initiatives.getEntityForPrincipal(artifact.initiativeId, req);

    return { artifact, initiative };
  }

  async list(initiativeId: string, req?: ContentPrincipal): Promise<InitiativeArtifactResponseDto[]> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const rows = await this.artifactRepo.find({
      where: { initiativeId: initiative.id },
      order: { createdAt: 'ASC' },
    });

    return rows.map((row) => initiativeArtifactEntityToDto(row));
  }

  async get(artifactId: string, req?: ContentPrincipal): Promise<InitiativeArtifactResponseDto> {
    const { artifact } = await this.getForPrincipal(artifactId, req);

    return initiativeArtifactEntityToDto(artifact, true);
  }

  async create(
    initiativeId: string,
    dto: CreateInitiativeArtifactDto,
    req?: RequestWithUser,
  ): Promise<InitiativeArtifactResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);

    this.initiatives.assertNotArchived(initiative);

    const actor = this.initiatives.actorOf(req);
    const saved = await this.artifactRepo.manager.transaction(async (em) => {
      if (dto.workItemId) {
        await this.assertEpic(em, initiative, dto.workItemId);
      }

      if (dto.type !== 'note' && (await this.findExisting(em, initiative.id, dto.type, dto.workItemId ?? null))) {
        throw new ConflictException('This document exists already; open it instead.');
      }

      const row = await this.writeArtifact(em, initiative, {
        type: dto.type,
        workItemId: dto.workItemId ?? null,
        title: dto.title,
        content: dto.content ?? INITIATIVE_ARTIFACT_TEMPLATES[dto.type],
        source: 'human',
        actor,
      });

      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.ARTIFACT_CREATED,
        actor,
        { artifactId: row.id, type: row.type, title: row.title },
        em,
      );

      return row;
    });

    this.emitArtifact(initiative, saved);

    return initiativeArtifactEntityToDto(saved, true);
  }

  async update(
    artifactId: string,
    dto: UpdateInitiativeArtifactDto,
    req?: RequestWithUser,
  ): Promise<InitiativeArtifactResponseDto> {
    const { artifact, initiative } = await this.getForPrincipal(artifactId, req);
    const actor = this.initiatives.actorOf(req);
    const contentChanged = dto.content !== undefined && dto.content !== artifact.content;
    const titleChanged = dto.title !== undefined && dto.title.trim() !== artifact.title;

    if (dto.expectedVersion !== artifact.version) {
      throw new ConflictException('The document changed meanwhile; load the latest version.');
    }

    if (!contentChanged && !titleChanged) {
      return initiativeArtifactEntityToDto(artifact, true);
    }

    const saved = await this.artifactRepo.manager.transaction(async (em) => {
      if (contentChanged) {
        await this.appendVersion(em, initiative, artifact, dto.content as string, {
          source: 'human',
          actor,
          expectedVersion: dto.expectedVersion,
          title: titleChanged ? (dto.title as string).trim() : undefined,
        });
      } else {
        await this.conditionalUpdate(em, artifact.id, dto.expectedVersion, { title: (dto.title as string).trim() });
      }

      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.ARTIFACT_UPDATED,
        actor,
        { artifactId: artifact.id, type: artifact.type, contentChanged, titleChanged },
        em,
      );

      return (await em
        .getRepository(InitiativeArtifactEntity)
        .findOne({ where: { id: artifact.id } })) as InitiativeArtifactEntity;
    });

    this.emitArtifact(initiative, saved);

    return initiativeArtifactEntityToDto(saved, true);
  }

  /** Make the current version the accepted contract (human only). */
  async accept(
    artifactId: string,
    dto: AcceptInitiativeArtifactDto,
    req?: RequestWithUser,
  ): Promise<InitiativeArtifactResponseDto> {
    const { artifact, initiative } = await this.getForPrincipal(artifactId, req);

    this.initiatives.assertHuman(req);

    const actor = this.initiatives.actorOf(req);
    const saved = await this.artifactRepo.manager.transaction(async (em) => {
      await this.conditionalUpdate(em, artifact.id, dto.expectedVersion, {
        acceptedVersion: artifact.currentVersion,
        acceptedAt: new Date(),
        acceptedByUserId: actor.actorUserId,
      });
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.ARTIFACT_ACCEPTED,
        actor,
        { artifactId: artifact.id, type: artifact.type, version: artifact.currentVersion },
        em,
      );

      return (await em
        .getRepository(InitiativeArtifactEntity)
        .findOne({ where: { id: artifact.id } })) as InitiativeArtifactEntity;
    });

    this.emitArtifact(initiative, saved);
    this.initiatives.publish('initiative.artifact.accepted', initiative.clientId, {
      initiativeId: initiative.id,
      artifactId: saved.id,
      type: saved.type,
      title: saved.title,
      version: saved.currentVersion,
    });

    return initiativeArtifactEntityToDto(saved, true);
  }

  async remove(artifactId: string, req?: RequestWithUser): Promise<void> {
    const { artifact, initiative } = await this.getForPrincipal(artifactId, req);

    await this.artifactRepo.delete({ id: artifact.id });
    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.ARTIFACT_DELETED,
      this.initiatives.actorOf(req),
      {
        artifactId: artifact.id,
        type: artifact.type,
        title: artifact.title,
      },
    );
    this.initiatives.emit(initiative.clientId, INITIATIVES_BOARD_EVENTS.initiativeArtifactRemoved, {
      id: artifact.id,
      initiativeId: initiative.id,
    });
  }

  async listVersions(artifactId: string, req?: ContentPrincipal): Promise<InitiativeArtifactVersionResponseDto[]> {
    const { artifact } = await this.getForPrincipal(artifactId, req);
    const rows = await this.versionRepo.find({
      where: { artifactId: artifact.id },
      order: { version: 'DESC' },
      select: [
        'id',
        'artifactId',
        'version',
        'iteration',
        'source',
        'runId',
        'proposalId',
        'createdByUserId',
        'agentId',
        'createdAt',
      ],
    });

    return rows.map((row) => initiativeArtifactVersionToDto(row, artifact.acceptedVersion));
  }

  async getVersion(
    artifactId: string,
    version: number,
    req?: ContentPrincipal,
  ): Promise<InitiativeArtifactVersionResponseDto> {
    const { artifact } = await this.getForPrincipal(artifactId, req);
    const row = await this.versionRepo.findOne({ where: { artifactId: artifact.id, version } });

    if (!row) {
      throw new NotFoundException('Version not found');
    }

    return initiativeArtifactVersionToDto(row, artifact.acceptedVersion, true);
  }

  /**
   * Copy the current version into a knowledge page (the user's knowledge access and the knowledge rules apply). The
   * page is a snapshot: later versions are published again explicitly.
   */
  async publishToKnowledge(
    artifactId: string,
    dto: PublishInitiativeArtifactDto,
    req?: RequestWithUser,
  ): Promise<InitiativeArtifactResponseDto> {
    const { artifact, initiative } = await this.getForPrincipal(artifactId, req);
    const title = `${initiative.title}: ${artifact.title}`.slice(0, INITIATIVE_LIMITS.titleMaxLength);
    const existing = artifact.publishedNodeId
      ? await this.knowledgeNodeRepo.findOne({ where: { id: artifact.publishedNodeId, clientId: initiative.clientId } })
      : null;
    let nodeId: string;

    // The knowledge tree takes the workspace from the parent: only folders of the initiative's own workspace qualify.
    if (
      dto.parentNodeId &&
      !(await this.knowledgeNodeRepo.exists({ where: { id: dto.parentNodeId, clientId: initiative.clientId } }))
    ) {
      throw new BadRequestException('parentNodeId must be a knowledge node of the same workspace');
    }

    if (existing && !dto.parentNodeId) {
      await this.knowledgeTreeService.updateNode(existing.id, { title, content: artifact.content }, req);
      nodeId = existing.id;
    } else {
      const created = await this.knowledgeTreeService.createNode(
        {
          clientId: initiative.clientId,
          ...(dto.parentNodeId ? { parentId: dto.parentNodeId } : {}),
          nodeType: KnowledgeNodeType.PAGE,
          title,
          content: artifact.content,
        },
        req,
      );

      nodeId = created.id;
    }

    await this.artifactRepo.update(artifact.id, { publishedNodeId: nodeId });
    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.ARTIFACT_PUBLISHED,
      this.initiatives.actorOf(req),
      {
        artifactId: artifact.id,
        nodeId,
        version: artifact.currentVersion,
      },
    );

    const saved = (await this.artifactRepo.findOne({ where: { id: artifact.id } })) as InitiativeArtifactEntity;

    this.emitArtifact(initiative, saved);

    return initiativeArtifactEntityToDto(saved, true);
  }

  // --- internal writes (runs, proposals) ------------------------------------------------------------------------------

  async findExisting(
    em: EntityManager,
    initiativeId: string,
    type: InitiativeArtifactType,
    workItemId: string | null,
  ): Promise<InitiativeArtifactEntity | null> {
    return await em.getRepository(InitiativeArtifactEntity).findOne({
      where: { initiativeId, type, workItemId: workItemId ?? IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  private async assertEpic(em: EntityManager, initiative: InitiativeEntity, workItemId: string): Promise<void> {
    const epic = await em
      .getRepository(InitiativeWorkItemEntity)
      .findOne({ where: { id: workItemId, initiativeId: initiative.id } });

    if (!epic || epic.kind !== 'epic') {
      throw new BadRequestException('Epic documents belong to an epic of the same initiative');
    }
  }

  /**
   * Write a document: a new version of the existing one (same type and scope; notes are always new) or a new document.
   * Used by accepted runs and proposals (inside their transaction).
   */
  async writeArtifact(
    em: EntityManager,
    initiative: InitiativeEntity,
    input: ArtifactWriteInput,
  ): Promise<InitiativeArtifactEntity> {
    const content = input.content.slice(0, INITIATIVE_LIMITS.contentMaxLength);
    const existing =
      input.type === 'note' ? null : await this.findExisting(em, initiative.id, input.type, input.workItemId ?? null);

    if (existing) {
      await this.appendVersion(em, initiative, existing, content, {
        source: input.source,
        actor: input.actor,
        runId: input.runId,
        proposalId: input.proposalId,
        accept: input.accept,
        title: input.title?.trim() || undefined,
      });

      return (await em
        .getRepository(InitiativeArtifactEntity)
        .findOne({ where: { id: existing.id } })) as InitiativeArtifactEntity;
    }

    const repo = em.getRepository(InitiativeArtifactEntity);
    const row = await repo.save(
      repo.create({
        initiativeId: initiative.id,
        clientId: initiative.clientId,
        type: input.type,
        workItemId: input.workItemId ?? null,
        title: (input.title?.trim() || INITIATIVE_ARTIFACT_TYPE_LABELS[input.type]).slice(
          0,
          INITIATIVE_LIMITS.titleMaxLength,
        ),
        content,
        currentVersion: 1,
        acceptedVersion: input.accept ? 1 : null,
        acceptedAt: input.accept ? new Date() : null,
        acceptedByUserId: input.accept ? input.actor.actorUserId : null,
        version: 1,
      }),
    );

    row.longSha = InitiativeArtifactEntity.deriveLongSha(row.id);
    await repo.update(row.id, { longSha: row.longSha });
    await this.saveVersionRow(em, initiative, row.id, 1, content, input);

    return row;
  }

  private async appendVersion(
    em: EntityManager,
    initiative: InitiativeEntity,
    artifact: InitiativeArtifactEntity,
    content: string,
    options: {
      source: InitiativeArtifactVersionSource;
      actor: InitiativeActor;
      runId?: string | null;
      proposalId?: string | null;
      accept?: boolean;
      expectedVersion?: number;
      title?: string;
    },
  ): Promise<void> {
    const next = artifact.currentVersion + 1;

    // Also conditional on the content version read: a concurrent writer (run accept vs. human save) gets a 409, not a
    // unique-index violation on the version row.
    await this.conditionalUpdate(
      em,
      artifact.id,
      options.expectedVersion,
      {
        content,
        currentVersion: next,
        ...(options.title ? { title: options.title.slice(0, INITIATIVE_LIMITS.titleMaxLength) } : {}),
        ...(options.accept
          ? { acceptedVersion: next, acceptedAt: new Date(), acceptedByUserId: options.actor.actorUserId }
          : {}),
      },
      artifact.currentVersion,
    );
    await this.saveVersionRow(em, initiative, artifact.id, next, content, options);
  }

  private async saveVersionRow(
    em: EntityManager,
    initiative: InitiativeEntity,
    artifactId: string,
    version: number,
    content: string,
    options: {
      source: InitiativeArtifactVersionSource;
      actor: InitiativeActor;
      runId?: string | null;
      proposalId?: string | null;
    },
  ): Promise<void> {
    const repo = em.getRepository(InitiativeArtifactVersionEntity);

    await repo.save(
      repo.create({
        artifactId,
        version,
        content,
        iteration: initiative.iteration,
        source: options.source,
        runId: options.runId ?? null,
        proposalId: options.proposalId ?? null,
        createdByUserId: options.actor.actorUserId,
        agentId: options.actor.agentId,
      }),
    );
  }

  private async conditionalUpdate(
    em: EntityManager,
    artifactId: string,
    expectedVersion: number | undefined,
    patch: Partial<InitiativeArtifactEntity>,
    expectedCurrentVersion?: number,
  ): Promise<void> {
    const query = em
      .createQueryBuilder()
      .update(InitiativeArtifactEntity)
      .set({ ...patch, version: () => 'version + 1', updatedAt: () => 'now()' })
      .where('id = :id', { id: artifactId });

    if (expectedVersion !== undefined) {
      query.andWhere('version = :expectedVersion', { expectedVersion });
    }

    if (expectedCurrentVersion !== undefined) {
      query.andWhere('current_version = :expectedCurrentVersion', { expectedCurrentVersion });
    }

    if (!(await query.execute()).affected) {
      throw new ConflictException('The document changed meanwhile; load the latest version.');
    }
  }

  emitArtifact(initiative: InitiativeEntity, row: InitiativeArtifactEntity): void {
    this.initiatives.emit(
      initiative.clientId,
      INITIATIVES_BOARD_EVENTS.initiativeArtifactUpsert,
      initiativeArtifactEntityToDto(row),
    );
  }
}
