import {
  INITIATIVE_LIMITS,
  INITIATIVE_STEPS,
  evaluateReadiness,
  findDependencyCycle,
  isLockedWorkItemStatus,
  nextEpicKey,
  nextItemKey,
  stepAvailability,
  ticketStatusForWorkItemStatus,
  whatsNext,
  type InitiativeArtifactType,
  type InitiativeSnapshot,
  type InitiativeTurnUnknown,
  type InitiativeTurnWorkItem,
  type RuleWorkItem,
  type WorkItemStatus,
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
import { EntityManager, In, Repository } from 'typeorm';

import type {
  CreateInitiativeUnknownDto,
  CreateInitiativeWorkItemDto,
  ReorderInitiativeWorkItemDto,
  ResolveInitiativeUnknownDto,
  SetInitiativeWorkItemDependenciesDto,
  SetInitiativeWorkItemStatusDto,
  UpdateInitiativeWorkItemDto,
} from '../dto/initiatives';
import type {
  InitiativeOverviewResponseDto,
  InitiativeUnknownResponseDto,
  InitiativeWorkItemResponseDto,
  InitiativeWorkItemsResponseDto,
} from '../dto/initiatives/initiative-response.dto';
import { InitiativeArtifactEntity } from '../entities/initiative-artifact.entity';
import { InitiativeChangeProposalEntity } from '../entities/initiative-change-proposal.entity';
import { InitiativeDecisionEntity } from '../entities/initiative-decision.entity';
import { InitiativeFindingEntity } from '../entities/initiative-finding.entity';
import { InitiativeRunEntity } from '../entities/initiative-run.entity';
import { InitiativeUnknownEntity } from '../entities/initiative-unknown.entity';
import { InitiativeWorkItemDependencyEntity } from '../entities/initiative-work-item-dependency.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeActionType, InitiativeDecisionStatus } from '../entities/initiative.enums';
import { InitiativeEntity } from '../entities/initiative.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketPriority, TicketStatus } from '../entities/ticket.enums';
import type { ContentPrincipal } from '../utils/agent-content-writer.utils';
import {
  effectiveWorkItemStatus,
  initiativeEntityToDto,
  initiativeUnknownToDto,
  initiativeWorkItemToDto,
} from '../utils/initiative-mappers';

import { INITIATIVES_BOARD_EVENTS } from './initiative-board-realtime.constants';
import { InitiativesService, type InitiativeActor } from './initiatives.service';
import { TicketsService } from './tickets.service';

/** Loaded tree of one initiative with effective statuses and readiness. */
export interface InitiativeTree {
  initiative: InitiativeEntity;
  items: InitiativeWorkItemEntity[];
  dependencies: InitiativeWorkItemDependencyEntity[];
  unknowns: InitiativeUnknownEntity[];
  /** Ticket status per item id (only tickets of the initiative's workspace count as linked). */
  ticketStatusByItemId: Map<string, TicketStatus>;
  statusById: Map<string, WorkItemStatus>;
  dtos: InitiativeWorkItemResponseDto[];
}

/** Placeholder (`N1`) or existing key → created / existing item. */
export type WorkItemKeyMap = Map<string, InitiativeWorkItemEntity>;

@Injectable()
export class InitiativeWorkItemsService {
  constructor(
    @InjectRepository(InitiativeWorkItemEntity)
    private readonly itemRepo: Repository<InitiativeWorkItemEntity>,
    @InjectRepository(InitiativeWorkItemDependencyEntity)
    private readonly dependencyRepo: Repository<InitiativeWorkItemDependencyEntity>,
    @InjectRepository(InitiativeUnknownEntity)
    private readonly unknownRepo: Repository<InitiativeUnknownEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    @InjectRepository(InitiativeArtifactEntity)
    private readonly artifactRepo: Repository<InitiativeArtifactEntity>,
    @InjectRepository(InitiativeFindingEntity)
    private readonly findingRepo: Repository<InitiativeFindingEntity>,
    @InjectRepository(InitiativeChangeProposalEntity)
    private readonly proposalRepo: Repository<InitiativeChangeProposalEntity>,
    @InjectRepository(InitiativeDecisionEntity)
    private readonly decisionRepo: Repository<InitiativeDecisionEntity>,
    @InjectRepository(InitiativeRunEntity)
    private readonly runRepo: Repository<InitiativeRunEntity>,
    private readonly initiatives: InitiativesService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
  ) {}

  // --- tree ---------------------------------------------------------------------------------------------------------

  async loadTree(initiative: InitiativeEntity, em: EntityManager = this.itemRepo.manager): Promise<InitiativeTree> {
    const items = await em.getRepository(InitiativeWorkItemEntity).find({
      where: { initiativeId: initiative.id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const dependencies = await em
      .getRepository(InitiativeWorkItemDependencyEntity)
      .find({ where: { initiativeId: initiative.id } });
    const unknowns = await em
      .getRepository(InitiativeUnknownEntity)
      .find({ where: { initiativeId: initiative.id }, order: { createdAt: 'ASC' } });
    const ticketIds = items.map((item) => item.ticketId).filter((id): id is string => !!id);
    const tickets = ticketIds.length
      ? await em.getRepository(TicketEntity).find({
          where: { id: In(ticketIds), clientId: initiative.clientId },
          select: ['id', 'status'],
        })
      : [];
    const ticketStatus = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
    const ticketStatusByItemId = new Map<string, TicketStatus>();
    const statusById = new Map<string, WorkItemStatus>();

    for (const item of items) {
      const status = item.ticketId ? ticketStatus.get(item.ticketId) : undefined;

      if (status) {
        ticketStatusByItemId.set(item.id, status);
      }

      statusById.set(item.id, effectiveWorkItemStatus(item, status));
    }

    const ruleItems: RuleWorkItem[] = items.map((item) => ({
      id: item.id,
      key: item.key,
      kind: item.kind,
      parentId: item.parentId ?? null,
      status: statusById.get(item.id) as WorkItemStatus,
      sortOrder: item.sortOrder,
      refined: item.refined,
      doneCheckpoint: item.doneCheckpoint,
      ticketId: item.ticketId ?? null,
    }));
    const readiness = evaluateReadiness(ruleItems, dependencies, {
      prerequisiteSatisfiedAt: initiative.prerequisiteSatisfiedAt,
      retrospectiveVerdicts: Object.fromEntries(
        items
          .filter((item) => item.kind === 'epic' && item.retrospectiveVerdict)
          .map((item) => [item.id, item.retrospectiveVerdict ?? undefined]),
      ),
    });
    const prerequisitesOf = new Map<string, string[]>();

    for (const dependency of dependencies) {
      prerequisitesOf.set(dependency.workItemId, [
        ...(prerequisitesOf.get(dependency.workItemId) ?? []),
        dependency.prerequisiteId,
      ]);
    }

    const dtos = items.map((item) =>
      initiativeWorkItemToDto(item, {
        ticketStatus: ticketStatusByItemId.get(item.id) ?? null,
        prerequisiteIds: prerequisitesOf.get(item.id) ?? [],
        readiness: readiness.get(item.id),
        unknowns: unknowns.filter((unknown) => unknown.workItemId === item.id),
      }),
    );

    return { initiative, items, dependencies, unknowns, ticketStatusByItemId, statusById, dtos };
  }

  treeResponse(tree: InitiativeTree): InitiativeWorkItemsResponseDto {
    return {
      initiativeId: tree.initiative.id,
      items: tree.dtos,
      initiativeVersion: tree.initiative.version,
      unknowns: tree.unknowns.filter((unknown) => !unknown.workItemId).map(initiativeUnknownToDto),
    };
  }

  async list(initiativeId: string, req?: ContentPrincipal): Promise<InitiativeWorkItemsResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);

    return this.treeResponse(await this.loadTree(initiative));
  }

  /** Set by the build service: keeps the automation gate in sync and auto-releases before publishing. */
  private treeChangeListener?: (initiativeId: string) => Promise<void>;

  setTreeChangeListener(listener: (initiativeId: string) => Promise<void>): void {
    this.treeChangeListener = listener;
  }

  /**
   * After any change of the tree: let the build service react (automation gate, auto-release), then push the tree to
   * every board of the workspace. Returns the current tree.
   */
  async emitTree(initiativeId: string): Promise<InitiativeWorkItemsResponseDto | undefined> {
    if (!this.treeChangeListener) {
      return await this.publishTree(initiativeId);
    }

    try {
      await this.treeChangeListener(initiativeId);
    } catch {
      await this.publishTree(initiativeId);
    }

    const initiative = await this.initiatives.getEntityOrThrow(initiativeId).catch(() => undefined);

    return initiative ? this.treeResponse(await this.loadTree(initiative)) : undefined;
  }

  /** Push the current tree (and initiative) to every board of the workspace. */
  async publishTree(initiativeId: string): Promise<InitiativeWorkItemsResponseDto | undefined> {
    const initiative = await this.initiatives.getEntityOrThrow(initiativeId).catch(() => undefined);

    if (!initiative) {
      return undefined;
    }

    const response = this.treeResponse(await this.loadTree(initiative));

    this.initiatives.emit(initiative.clientId, INITIATIVES_BOARD_EVENTS.initiativeWorkItemsChanged, response);
    this.initiatives.emitInitiative(initiative);

    return response;
  }

  async getItemForPrincipal(
    itemId: string,
    req?: ContentPrincipal,
  ): Promise<{ item: InitiativeWorkItemEntity; initiative: InitiativeEntity }> {
    const item = await this.itemRepo.findOne({ where: { id: itemId } });

    if (!item) {
      throw new NotFoundException('Work item not found');
    }

    const initiative = await this.initiatives.getEntityForPrincipal(item.initiativeId, req);

    return { item, initiative };
  }

  private async effectiveStatus(item: InitiativeWorkItemEntity, clientId: string): Promise<WorkItemStatus> {
    if (!item.ticketId) {
      return item.status;
    }

    const ticket = await this.ticketRepo.findOne({ where: { id: item.ticketId, clientId }, select: ['id', 'status'] });

    return effectiveWorkItemStatus(item, ticket?.status);
  }

  // --- create / update / delete -------------------------------------------------------------------------------------

  async create(
    initiativeId: string,
    dto: CreateInitiativeWorkItemDto,
    req?: RequestWithUser,
  ): Promise<InitiativeWorkItemsResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);

    this.initiatives.assertNotArchived(initiative);

    const actor = this.initiatives.actorOf(req);

    await this.itemRepo.manager.transaction(async (em) => {
      const created = await this.createItems(
        em,
        initiative,
        [
          {
            key: 'N1',
            kind: dto.kind,
            title: dto.title,
            requirements: dto.requirements,
            verify: dto.verify,
            doneWhen: dto.doneWhen,
            after: [],
            unknowns: [],
          },
        ],
        dto.kind === 'epic' ? null : (dto.parentId ?? null),
        actor,
        { priority: dto.priority },
      );

      await this.initiatives.bumpVersion(initiative.id, undefined, em);
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.WORK_ITEM_CREATED,
        actor,
        { keys: [...created.values()].map((item) => item.key) },
        em,
      );
    });

    return (await this.emitTree(initiative.id)) as InitiativeWorkItemsResponseDto;
  }

  /**
   * Create work items (epics, or items below one epic) with stable keys. `after` names placeholders of the same batch or
   * existing keys of the initiative. Returns placeholder → created item.
   */
  async createItems(
    em: EntityManager,
    initiative: InitiativeEntity,
    inputs: InitiativeTurnWorkItem[],
    parentId: string | null,
    actor: InitiativeActor,
    options: { priority?: TicketPriority; beforeId?: string } = {},
  ): Promise<WorkItemKeyMap> {
    // Keys are allocated from the current items: concurrent creates must not compute the same `E3`.
    await this.initiatives.lockInitiative(em, initiative.id);

    const repo = em.getRepository(InitiativeWorkItemEntity);
    const existing = await repo.find({ where: { initiativeId: initiative.id } });

    if (existing.length + inputs.length > INITIATIVE_LIMITS.workItemsPerInitiativeMax) {
      throw new BadRequestException(
        `An initiative has at most ${INITIATIVE_LIMITS.workItemsPerInitiativeMax} work items`,
      );
    }

    const parent = parentId ? existing.find((item) => item.id === parentId) : undefined;

    if (parentId && (!parent || parent.kind !== 'epic')) {
      throw new BadRequestException('Stories, spikes and bugs belong to an epic of the same initiative');
    }

    const keys = existing.map((item) => item.key);
    const siblings = existing.filter((item) => (item.parentId ?? null) === (parentId ?? null));
    let sortOrder = siblings.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    const created: WorkItemKeyMap = new Map();

    for (const input of inputs) {
      const isEpic = !parent;

      if (isEpic !== (input.kind === 'epic')) {
        throw new BadRequestException(
          isEpic ? `${input.title}: only epics may be created without an epic` : `${input.title}: epics have no parent`,
        );
      }

      const key = isEpic ? nextEpicKey(keys) : nextItemKey(parent.key, keys);

      keys.push(key);

      const row = await repo.save(
        repo.create({
          initiativeId: initiative.id,
          clientId: initiative.clientId,
          parentId: parent?.id ?? null,
          kind: input.kind,
          key,
          title: input.title.trim().slice(0, INITIATIVE_LIMITS.titleMaxLength),
          requirements: input.requirements ?? '',
          verify: input.verify ?? '',
          doneWhen: input.doneWhen ?? '',
          refined: false,
          priority: options.priority ?? TicketPriority.MEDIUM,
          sortOrder: sortOrder++,
          status: 'draft',
          iterationCreated: initiative.iteration,
          version: 1,
        }),
      );

      created.set(input.key, row);

      for (const unknown of input.unknowns) {
        await this.saveUnknown(em, initiative.id, row.id, unknown);
      }
    }

    await this.addDependencies(em, initiative, inputs, created, existing);

    return created;
  }

  /** Dependencies of freshly created items (`after` keys of the batch or existing keys); cycles are refused. */
  private async addDependencies(
    em: EntityManager,
    initiative: InitiativeEntity,
    inputs: InitiativeTurnWorkItem[],
    created: WorkItemKeyMap,
    existing: InitiativeWorkItemEntity[],
  ): Promise<void> {
    const byKey = new Map(existing.map((item) => [item.key, item]));
    const repo = em.getRepository(InitiativeWorkItemDependencyEntity);
    const current = await repo.find({ where: { initiativeId: initiative.id } });
    const added: Array<{ workItemId: string; prerequisiteId: string }> = [];

    for (const input of inputs) {
      const item = created.get(input.key) as InitiativeWorkItemEntity;

      for (const ref of input.after) {
        const prerequisite = created.get(ref) ?? byKey.get(ref);

        if (
          prerequisite &&
          prerequisite.id !== item.id &&
          !added.some((d) => d.workItemId === item.id && d.prerequisiteId === prerequisite.id)
        ) {
          added.push({ workItemId: item.id, prerequisiteId: prerequisite.id });
        }
      }
    }

    const parentOf = new Map<string, string | null>(
      [...existing, ...created.values()].map((item) => [item.id, item.parentId] as [string, string | null]),
    );
    const cycle = findDependencyCycle(current, added, parentOf);

    if (cycle) {
      throw new BadRequestException('The dependencies would form a cycle (an item waits for its own epic, or a loop)');
    }

    if (added.length > 0) {
      await repo.save(added.map((edge) => repo.create({ ...edge, initiativeId: initiative.id })));
    }
  }

  async saveUnknown(
    em: EntityManager,
    initiativeId: string,
    workItemId: string | null,
    unknown: InitiativeTurnUnknown,
  ): Promise<InitiativeUnknownEntity> {
    const repo = em.getRepository(InitiativeUnknownEntity);

    return await repo.save(
      repo.create({
        initiativeId,
        workItemId,
        question: unknown.question.slice(0, INITIATIVE_LIMITS.shortTextMaxLength),
        resolution: unknown.resolution,
      }),
    );
  }

  async update(
    itemId: string,
    dto: UpdateInitiativeWorkItemDto,
    req?: RequestWithUser,
  ): Promise<InitiativeWorkItemsResponseDto> {
    const { item, initiative } = await this.getItemForPrincipal(itemId, req);
    const content = {
      title: dto.title?.trim(),
      requirements: dto.requirements,
      verify: dto.verify,
      doneWhen: dto.doneWhen,
    };
    const contentChanged = Object.entries(content).some(
      ([key, value]) => value !== undefined && value !== item[key as keyof typeof content],
    );

    if (contentChanged && isLockedWorkItemStatus(await this.effectiveStatus(item, initiative.clientId))) {
      throw new ConflictException('Built or done items are never rewritten; add a new item instead.');
    }

    const patch: Partial<InitiativeWorkItemEntity> = {};

    for (const [key, value] of Object.entries({
      ...content,
      refined: dto.refined,
      planCheckpoint: dto.planCheckpoint,
      doneCheckpoint: dto.doneCheckpoint,
      priority: dto.priority,
    })) {
      if (value !== undefined && value !== item[key as keyof InitiativeWorkItemEntity]) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }

    if (dto.refined !== undefined && item.kind !== 'epic') {
      delete patch.refined;
    }

    const fields = Object.keys(patch);

    if (fields.length > 0) {
      await this.itemRepo.manager.transaction(async (em) => {
        await this.conditionalItemUpdate(em, item.id, dto.expectedVersion, patch);
        await this.initiatives.bumpVersion(initiative.id, undefined, em);
        await this.initiatives.appendActivity(
          initiative.id,
          InitiativeActionType.WORK_ITEM_UPDATED,
          this.initiatives.actorOf(req),
          { key: item.key, fields },
          em,
        );
      });
    } else if (dto.expectedVersion !== item.version) {
      throw new ConflictException('The work item changed meanwhile; load the latest version.');
    }

    return (await this.emitTree(initiative.id)) as InitiativeWorkItemsResponseDto;
  }

  async conditionalItemUpdate(
    em: EntityManager,
    itemId: string,
    expectedVersion: number | undefined,
    patch: Partial<InitiativeWorkItemEntity>,
  ): Promise<void> {
    const query = em
      .createQueryBuilder()
      .update(InitiativeWorkItemEntity)
      .set({ ...patch, version: () => 'version + 1', updatedAt: () => 'now()' })
      .where('id = :id', { id: itemId });

    if (expectedVersion !== undefined) {
      query.andWhere('version = :expectedVersion', { expectedVersion });
    }

    const result = await query.execute();

    if (!result.affected) {
      throw new ConflictException('The work item changed meanwhile; load the latest version.');
    }
  }

  async remove(itemId: string, req?: RequestWithUser): Promise<InitiativeWorkItemsResponseDto> {
    const { item, initiative } = await this.getItemForPrincipal(itemId, req);
    const subtree = await this.itemRepo.find({ where: [{ id: item.id }, { parentId: item.id }] });

    if (subtree.some((row) => !!row.ticketId)) {
      throw new ConflictException('Transferred items are not deleted; drop them instead (their tickets stay).');
    }

    await this.itemRepo.manager.transaction(async (em) => {
      await em.getRepository(InitiativeWorkItemEntity).delete({ id: item.id });
      await this.initiatives.bumpVersion(initiative.id, undefined, em);
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.WORK_ITEM_DELETED,
        this.initiatives.actorOf(req),
        { key: item.key, title: item.title },
        em,
      );
    });

    return (await this.emitTree(initiative.id)) as InitiativeWorkItemsResponseDto;
  }

  async reorder(
    itemId: string,
    dto: ReorderInitiativeWorkItemDto,
    req?: RequestWithUser,
  ): Promise<InitiativeWorkItemsResponseDto> {
    const { item, initiative } = await this.getItemForPrincipal(itemId, req);

    await this.itemRepo.manager.transaction(async (em) => {
      await this.initiatives.bumpVersion(initiative.id, dto.expectedInitiativeVersion, em);
      await this.moveBefore(em, item, dto.beforeId);
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.WORK_ITEMS_REORDERED,
        this.initiatives.actorOf(req),
        { key: item.key },
        em,
      );
    });

    return (await this.emitTree(initiative.id)) as InitiativeWorkItemsResponseDto;
  }

  /** Move an item before a sibling (end when omitted) and renumber the siblings. */
  async moveBefore(em: EntityManager, item: InitiativeWorkItemEntity, beforeId?: string): Promise<void> {
    const repo = em.getRepository(InitiativeWorkItemEntity);
    const siblings = await repo.find({
      where: { initiativeId: item.initiativeId, ...(item.parentId ? { parentId: item.parentId } : {}) },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const level = siblings.filter((row) => (row.parentId ?? null) === (item.parentId ?? null) && row.id !== item.id);
    const index = beforeId ? level.findIndex((row) => row.id === beforeId) : level.length;

    if (beforeId && index < 0) {
      throw new BadRequestException('Items can only be moved among the items of the same epic (or among epics)');
    }

    level.splice(index, 0, item);

    for (const [position, row] of level.entries()) {
      if (row.sortOrder !== position) {
        await repo.update(row.id, { sortOrder: position });
      }
    }
  }

  async setDependencies(
    itemId: string,
    dto: SetInitiativeWorkItemDependenciesDto,
    req?: RequestWithUser,
  ): Promise<InitiativeWorkItemsResponseDto> {
    const { item, initiative } = await this.getItemForPrincipal(itemId, req);
    const prerequisiteIds = [...new Set(dto.prerequisiteIds)];

    await this.itemRepo.manager.transaction(async (em) => {
      await this.initiatives.bumpVersion(initiative.id, dto.expectedInitiativeVersion, em);
      await this.replaceDependencies(em, initiative, item, prerequisiteIds);
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.DEPENDENCIES_CHANGED,
        this.initiatives.actorOf(req),
        { key: item.key, prerequisiteCount: prerequisiteIds.length },
        em,
      );
    });

    return (await this.emitTree(initiative.id)) as InitiativeWorkItemsResponseDto;
  }

  async replaceDependencies(
    em: EntityManager,
    initiative: InitiativeEntity,
    item: InitiativeWorkItemEntity,
    prerequisiteIds: string[],
  ): Promise<void> {
    const prerequisites = prerequisiteIds.length
      ? await em
          .getRepository(InitiativeWorkItemEntity)
          .find({ where: { id: In(prerequisiteIds), initiativeId: initiative.id } })
      : [];

    if (prerequisites.length !== prerequisiteIds.length) {
      throw new BadRequestException('Prerequisites must be work items of the same initiative');
    }

    const repo = em.getRepository(InitiativeWorkItemDependencyEntity);
    const others = (await repo.find({ where: { initiativeId: initiative.id } })).filter(
      (edge) => edge.workItemId !== item.id,
    );
    const added = prerequisiteIds.map((prerequisiteId) => ({ workItemId: item.id, prerequisiteId }));

    const structure = await em
      .getRepository(InitiativeWorkItemEntity)
      .find({ where: { initiativeId: initiative.id }, select: ['id', 'parentId'] });

    if (findDependencyCycle(others, added, new Map(structure.map((row) => [row.id, row.parentId])))) {
      throw new BadRequestException('The dependencies would form a cycle');
    }

    await repo.delete({ workItemId: item.id });

    if (added.length > 0) {
      await repo.save(added.map((edge) => repo.create({ ...edge, initiativeId: initiative.id })));
    }
  }

  /**
   * Status set by a human on the page. Transferred items change their ticket (the ticket stays the source of truth);
   * marking done is human-only (BMad: build stops at built).
   */
  async setStatus(
    itemId: string,
    dto: SetInitiativeWorkItemStatusDto,
    req?: RequestWithUser,
  ): Promise<InitiativeWorkItemsResponseDto> {
    const { item, initiative } = await this.getItemForPrincipal(itemId, req);

    this.initiatives.assertHuman(req);

    if (
      item.ticketId &&
      (await this.ticketRepo.exists({ where: { id: item.ticketId, clientId: initiative.clientId } }))
    ) {
      if (dto.status === 'blocked') {
        throw new BadRequestException('Transferred items take their status from the ticket');
      }

      const ticketStatus = ticketStatusForWorkItemStatus(dto.status) as TicketStatus;

      // Ticket rules, activity, approval invalidation and realtime apply unchanged (the user's own access).
      await this.ticketsService.update(item.ticketId, { status: ticketStatus }, req);
    } else {
      await this.itemRepo.manager.transaction(async (em) => {
        await this.conditionalItemUpdate(em, item.id, undefined, { status: dto.status });
        await this.initiatives.bumpVersion(initiative.id, undefined, em);
      });
    }

    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.WORK_ITEM_UPDATED,
      this.initiatives.actorOf(req),
      {
        key: item.key,
        status: dto.status,
      },
    );

    return (await this.emitTree(initiative.id)) as InitiativeWorkItemsResponseDto;
  }

  // --- unknowns -------------------------------------------------------------------------------------------------------

  async createUnknown(
    initiativeId: string,
    dto: CreateInitiativeUnknownDto,
    req?: RequestWithUser,
  ): Promise<InitiativeUnknownResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);

    if (
      dto.workItemId &&
      !(await this.itemRepo.exists({ where: { id: dto.workItemId, initiativeId: initiative.id } }))
    ) {
      throw new BadRequestException('The work item belongs to another initiative');
    }

    const row = await this.saveUnknown(this.unknownRepo.manager, initiative.id, dto.workItemId ?? null, {
      question: dto.question.trim(),
      resolution: dto.resolution,
    });

    await this.emitTree(initiative.id);

    return initiativeUnknownToDto(row);
  }

  async resolveUnknown(
    unknownId: string,
    dto: ResolveInitiativeUnknownDto,
    req?: RequestWithUser,
  ): Promise<InitiativeUnknownResponseDto> {
    const row = await this.unknownRepo.findOne({ where: { id: unknownId } });

    if (!row) {
      throw new NotFoundException('Unknown not found');
    }

    const initiative = await this.initiatives.getEntityForPrincipal(row.initiativeId, req);

    this.initiatives.assertHuman(req);
    row.answer = dto.answer.trim();
    row.resolvedAt = new Date();
    row.resolvedByUserId = this.initiatives.userIdOf(req);

    const saved = await this.unknownRepo.save(row);

    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.UNKNOWN_RESOLVED,
      this.initiatives.actorOf(req),
      {
        unknownId: row.id,
      },
    );
    await this.emitTree(initiative.id);

    return initiativeUnknownToDto(saved);
  }

  async removeUnknown(unknownId: string, req?: RequestWithUser): Promise<void> {
    const row = await this.unknownRepo.findOne({ where: { id: unknownId } });

    if (!row) {
      throw new NotFoundException('Unknown not found');
    }

    await this.initiatives.getEntityForPrincipal(row.initiativeId, req);
    await this.unknownRepo.delete({ id: row.id });
    await this.emitTree(row.initiativeId);
  }

  // --- overview -------------------------------------------------------------------------------------------------------

  async snapshot(initiative: InitiativeEntity, tree?: InitiativeTree): Promise<InitiativeSnapshot> {
    const loaded = tree ?? (await this.loadTree(initiative));
    const artifacts = await this.artifactRepo.find({
      where: { initiativeId: initiative.id },
      select: ['id', 'type', 'workItemId', 'currentVersion', 'acceptedVersion'],
    });
    const accepted = new Set<InitiativeArtifactType>(
      artifacts.filter((row) => !row.workItemId && row.acceptedVersion !== null).map((row) => row.type),
    );
    const retrospectiveEpics = new Set(
      artifacts.filter((row) => row.type === 'retrospective' && row.workItemId).map((row) => row.workItemId as string),
    );

    return {
      path: initiative.path,
      hasIntent: !!initiative.intent?.trim(),
      acceptedArtifactTypes: accepted,
      epics: loaded.items
        .filter((item) => item.kind === 'epic')
        .map((epic) => ({
          id: epic.id,
          key: epic.key,
          title: epic.title,
          refined: epic.refined,
          status: loaded.statusById.get(epic.id) as WorkItemStatus,
          items: loaded.items
            .filter((item) => item.parentId === epic.id && loaded.statusById.get(item.id) !== 'dropped')
            .map((item) => ({
              status: loaded.statusById.get(item.id) as WorkItemStatus,
              transferred: !!loaded.ticketStatusByItemId.get(item.id),
            })),
          hasRetrospective: retrospectiveEpics.has(epic.id) || !!epic.retrospectiveVerdict,
        })),
      openFindings: await this.findingRepo.count({ where: { initiativeId: initiative.id, status: 'open' } }),
      openProposals: await this.proposalRepo.count({ where: { initiativeId: initiative.id, status: 'open' } }),
    };
  }

  async overview(initiativeId: string, req?: RequestWithUser): Promise<InitiativeOverviewResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const tree = await this.loadTree(initiative);
    const snapshot = await this.snapshot(initiative, tree);
    const itemsByStatus: Partial<Record<WorkItemStatus, number>> = {};

    for (const item of tree.items) {
      if (item.kind !== 'epic') {
        const status = tree.statusById.get(item.id) as WorkItemStatus;

        itemsByStatus[status] = (itemsByStatus[status] ?? 0) + 1;
      }
    }

    const artifacts = await this.artifactRepo.find({
      where: { initiativeId },
      select: ['id', 'currentVersion', 'acceptedVersion'],
    });

    return {
      initiative: initiativeEntityToDto(initiative),
      nextActions: whatsNext(snapshot),
      steps: INITIATIVE_STEPS.filter((step) => step.target === 'initiative').map((step) => ({
        step: step.key,
        ...stepAvailability(step, snapshot),
      })),
      counts: {
        artifacts: artifacts.length,
        acceptedArtifacts: artifacts.filter((row) => row.acceptedVersion === row.currentVersion).length,
        epics: tree.items.filter((item) => item.kind === 'epic').length,
        items: tree.items.filter((item) => item.kind !== 'epic').length,
        itemsByStatus,
        openFindings: snapshot.openFindings,
        openProposals: snapshot.openProposals,
        proposedDecisions: await this.decisionRepo.count({
          where: { initiativeId, status: InitiativeDecisionStatus.PROPOSED },
        }),
        openUnknowns: tree.unknowns.filter((unknown) => !unknown.resolvedAt).length,
        activeRuns: await this.runRepo.count({
          where: { initiativeId, status: In(['pending', 'working', 'needs_input', 'ready']) },
        }),
      },
    };
  }
}
