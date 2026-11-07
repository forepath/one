import { ClientAgentCredentialsRepository, type RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import type { PlanInitiativeStoryDto, ReleaseInitiativeDto, TransferInitiativeDto } from '../dto/initiatives';
import type {
  InitiativeBuildActionResponseDto,
  TicketInitiativeLinkDto,
} from '../dto/initiatives/initiative-response.dto';
import { InitiativeWorkItemDependencyEntity } from '../entities/initiative-work-item-dependency.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeActionType } from '../entities/initiative.enums';
import type { InitiativeEntity } from '../entities/initiative.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket.enums';
import { buildInitiativeTicketBody, initiativeTicketTitle } from '../utils/initiative-ticket-body';

import { ChatPlanOrchestratorService } from './chat-plan-orchestrator.service';
import { ChatPlanService } from './chat-plan.service';
import { InitiativeAutomationHooks, type InitiativeSessionContext } from './initiative-automation-hooks';
import { InitiativeContextService } from './initiative-context.service';
import { InitiativeWorkItemsService, type InitiativeTree } from './initiative-work-items.service';
import { InitiativesService, INITIATIVE_SYSTEM_ACTOR } from './initiatives.service';
import { TicketAutomationService } from './ticket-automation.service';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { TicketsService } from './tickets.service';

/** Ticket changes of a workspace are coalesced before initiatives react (bulk edits, automation bursts). */
const TICKET_CHANGE_DEBOUNCE_MS = 400;

/**
 * Plan → build: transfer epics and stories into tickets, release stories whose prerequisites are satisfied (by hand
 * or automatically), plan a story as a chat plan, keep the automation gate (`automation_blocked`) in sync, and react to
 * ticket changes (statuses of linked tickets drive the work items).
 */
@Injectable()
export class InitiativeBuildService extends InitiativeAutomationHooks implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InitiativeBuildService.name);
  private readonly pendingTicketIdsByClient = new Map<string, Set<string>>();
  /** Workspaces with deleted tickets since the last flush (their items can no longer be found by ticket id). */
  private readonly removalsByClient = new Set<string>();
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();
  /** Transfers of one initiative run one after another (plus conditional linking against concurrent replicas). */
  private readonly transferLocks = new Map<string, Promise<unknown>>();
  private unsubscribe?: () => void;

  constructor(
    @InjectRepository(InitiativeWorkItemEntity)
    private readonly itemRepo: Repository<InitiativeWorkItemEntity>,
    @InjectRepository(InitiativeWorkItemDependencyEntity)
    private readonly dependencyRepo: Repository<InitiativeWorkItemDependencyEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    private readonly initiatives: InitiativesService,
    private readonly workItems: InitiativeWorkItemsService,
    private readonly context: InitiativeContextService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
    private readonly ticketAutomationService: TicketAutomationService,
    private readonly ticketBoardRealtime: TicketBoardRealtimeService,
    private readonly chatPlanService: ChatPlanService,
    private readonly chatPlanOrchestrator: ChatPlanOrchestratorService,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
  ) {
    super();
  }

  onModuleInit(): void {
    this.unsubscribe = this.ticketBoardRealtime.onTicketChange((change) =>
      this.queueTicketChange(change.clientId, change.ticketId, change.removed),
    );
    this.workItems.setTreeChangeListener((initiativeId) => this.refresh(initiativeId));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();

    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
  }

  // --- automation gate (InitiativeAutomationHooks) -----------------------------------------------------------------

  async isTicketBlocked(ticketId: string, clientId: string): Promise<boolean> {
    const item = await this.itemRepo.findOne({ where: { ticketId, clientId } });

    if (!item) {
      return false;
    }

    const initiative = await this.initiatives.getEntityOrThrow(item.initiativeId).catch(() => null);

    if (!initiative) {
      return false;
    }

    const tree = await this.workItems.loadTree(initiative);
    const view = tree.dtos.find((dto) => dto.id === item.id);
    const blocked = !view || view.status === 'dropped' || !view.ready;

    // Self-heal a stale query flag (e.g. a failed refresh): otherwise the ticket keeps occupying the candidate batch.
    if (blocked && !item.automationBlocked) {
      await this.syncAutomationGate(tree).catch((error: unknown) =>
        this.logger.warn(`Initiative ${initiative.id}: automation gate resync failed: ${String(error)}`),
      );
    }

    return blocked;
  }

  async automationContext(ticketId: string, clientId: string): Promise<InitiativeSessionContext | null> {
    return await this.context.contextForTicket(ticketId, clientId);
  }

  /** Recompute `automation_blocked` of every linked item of an initiative (after any change of its tree). */
  async syncAutomationGate(tree: InitiativeTree): Promise<void> {
    const blocked: string[] = [];
    const unblocked: string[] = [];

    for (const dto of tree.dtos) {
      const item = tree.items.find((row) => row.id === dto.id);

      if (!item?.ticketId) {
        continue;
      }

      const shouldBlock = dto.status === 'dropped' || !dto.ready;

      if (shouldBlock !== item.automationBlocked) {
        (shouldBlock ? blocked : unblocked).push(item.id);
      }
    }

    if (blocked.length) {
      await this.itemRepo.update({ id: In(blocked) }, { automationBlocked: true });
    }

    if (unblocked.length) {
      await this.itemRepo.update({ id: In(unblocked) }, { automationBlocked: false });
    }
  }

  /** Emit the tree, keep the automation gate in sync and auto-release when the initiative asks for it. */
  async refresh(initiativeId: string, options: { autoRelease?: boolean } = {}): Promise<void> {
    const initiative = await this.initiatives.getEntityOrThrow(initiativeId).catch(() => null);

    if (!initiative) {
      return;
    }

    let tree = await this.workItems.loadTree(initiative);

    if (options.autoRelease !== false && initiative.autoRelease && initiative.state === 'active') {
      const released = await this.releaseReady(initiative, tree, undefined, undefined);

      if (released.length > 0) {
        tree = await this.workItems.loadTree(initiative);
      }
    }

    await this.syncAutomationGate(tree);
    await this.workItems.publishTree(initiative.id);
  }

  // --- ticket observer -------------------------------------------------------------------------------------------

  private queueTicketChange(clientId: string, ticketId: string, removed = false): void {
    if (removed) {
      this.removalsByClient.add(clientId);
    }

    const pending = this.pendingTicketIdsByClient.get(clientId) ?? new Set<string>();

    pending.add(ticketId);
    this.pendingTicketIdsByClient.set(clientId, pending);

    if (this.flushTimers.has(clientId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.flushTimers.delete(clientId);
      void this.flushTicketChanges(clientId).catch((error: unknown) =>
        this.logger.warn(`Initiative refresh after ticket changes failed: ${(error as Error).message}`),
      );
    }, TICKET_CHANGE_DEBOUNCE_MS);

    timer.unref?.();
    this.flushTimers.set(clientId, timer);
  }

  private async flushTicketChanges(clientId: string): Promise<void> {
    const ticketIds = [...(this.pendingTicketIdsByClient.get(clientId) ?? [])];
    const hadRemovals = this.removalsByClient.delete(clientId);

    this.pendingTicketIdsByClient.delete(clientId);

    if (ticketIds.length === 0) {
      return;
    }

    // A deleted ticket already lost its link (FK set null), so its item cannot be found by ticket id any more: refresh
    // every initiative of the workspace that has items (debounced, so rare).
    const affectedByRemoval = hadRemovals
      ? (
          await this.itemRepo
            .createQueryBuilder('item')
            .select('DISTINCT item.initiative_id', 'initiativeId')
            .where('item.client_id = :clientId', { clientId })
            .getRawMany<{ initiativeId: string }>()
        ).map((row) => row.initiativeId)
      : [];

    // Items linked to these tickets, in any workspace (a ticket migrated away leaves its item behind).
    const items = await this.itemRepo.find({ where: { ticketId: In(ticketIds) } });
    const tickets = await this.ticketRepo.find({ where: { id: In(ticketIds) }, select: ['id', 'clientId'] });
    const ticketClient = new Map(tickets.map((ticket) => [ticket.id, ticket.clientId]));

    for (const item of items) {
      const owner = ticketClient.get(item.ticketId as string);

      if (owner && owner !== item.clientId) {
        // Moved to another workspace: the link ends (never cross workspaces); the item keeps its own status.
        await this.itemRepo.update(
          { id: item.id, ticketId: item.ticketId as string },
          { ticketId: null, automationBlocked: false },
        );
        await this.initiatives.appendActivity(
          item.initiativeId,
          InitiativeActionType.WORK_ITEM_UPDATED,
          INITIATIVE_SYSTEM_ACTOR,
          {
            key: item.key,
            unlinked: 'ticket moved to another workspace',
          },
        );
      }
    }

    for (const initiativeId of new Set([...items.map((item) => item.initiativeId), ...affectedByRemoval])) {
      await this.refresh(initiativeId);
    }
  }

  // --- transfer -------------------------------------------------------------------------------------------------

  async transfer(
    initiativeId: string,
    dto: TransferInitiativeDto,
    req?: RequestWithUser,
  ): Promise<InitiativeBuildActionResponseDto> {
    const previous = this.transferLocks.get(initiativeId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.transferUnlocked(initiativeId, dto, req));

    this.transferLocks.set(initiativeId, next);

    try {
      return await next;
    } finally {
      if (this.transferLocks.get(initiativeId) === next) {
        this.transferLocks.delete(initiativeId);
      }
    }
  }

  private async transferUnlocked(
    initiativeId: string,
    dto: TransferInitiativeDto,
    req?: RequestWithUser,
  ): Promise<InitiativeBuildActionResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);

    this.initiatives.assertNotArchived(initiative);

    const tree = await this.workItems.loadTree(initiative);
    const epics = tree.items.filter(
      (item) =>
        item.kind === 'epic' &&
        tree.statusById.get(item.id) !== 'dropped' &&
        (!dto.epicIds?.length || dto.epicIds.includes(item.id)),
    );

    if (dto.epicIds?.length && epics.length !== dto.epicIds.length) {
      throw new BadRequestException('Epics must belong to the initiative (and not be dropped)');
    }

    const ticketIds: string[] = [];
    const skipped: InitiativeBuildActionResponseDto['skipped'] = [];
    const storyTickets: Array<{ item: InitiativeWorkItemEntity; ticketId: string }> = [];
    const keyOf = new Map(tree.items.map((item) => [item.id, item.key]));
    const afterKeys = (itemId: string) =>
      tree.dependencies
        .filter((dep) => dep.workItemId === itemId)
        .map((dep) => keyOf.get(dep.prerequisiteId) as string);

    for (const epic of epics) {
      let epicTicketId = tree.ticketStatusByItemId.has(epic.id) ? (epic.ticketId as string) : null;

      if (!epicTicketId) {
        epicTicketId = await this.createAndLink(initiative, epic, null, tree, afterKeys(epic.id), req);

        if (!epicTicketId) {
          skipped.push({ workItemId: epic.id, reason: 'Transferred by someone else meanwhile' });
          continue;
        }

        ticketIds.push(epicTicketId);
      }

      for (const item of tree.items.filter((row) => row.parentId === epic.id)) {
        if (tree.statusById.get(item.id) === 'dropped' || tree.ticketStatusByItemId.has(item.id)) {
          continue;
        }

        const ticketId = await this.createAndLink(initiative, item, epicTicketId, tree, afterKeys(item.id), req, epic);

        if (ticketId) {
          ticketIds.push(ticketId);
          storyTickets.push({ item, ticketId });
        } else {
          skipped.push({ workItemId: item.id, reason: 'Transferred by someone else meanwhile' });
        }
      }
    }

    if (dto.automation) {
      const model = dto.automation.preferredModel?.trim() || initiative.defaultModel?.trim() || null;

      for (const { item, ticketId } of storyTickets) {
        if (dto.automation.eligible && !model) {
          skipped.push({ workItemId: item.id, reason: 'Ticket automation needs a model (set one for the initiative)' });
          continue;
        }

        try {
          // Workspace-manager rules of ticket automation apply unchanged (403 for other users).
          await this.ticketAutomationService.patchAutomation(
            ticketId,
            {
              eligible: dto.automation.eligible,
              ...(dto.automation.allowedAgentIds ? { allowedAgentIds: dto.automation.allowedAgentIds } : {}),
              ...(model ? { preferredModel: model } : {}),
              requiresApproval: item.planCheckpoint,
            },
            req,
          );
        } catch (error) {
          skipped.push({ workItemId: item.id, reason: `Automation not configured: ${(error as Error).message}` });
        }
      }
    }

    if (ticketIds.length > 0) {
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.TRANSFERRED,
        this.initiatives.actorOf(req),
        {
          count: ticketIds.length,
        },
      );
      this.initiatives.publish('initiative.work_items.transferred', initiative.clientId, {
        initiativeId: initiative.id,
        ticketIds,
      });
      await this.initiatives.bumpVersion(initiative.id, undefined);
    }

    await this.refresh(initiative.id);

    const updated = await this.workItems.list(initiative.id, req);

    return { workItems: updated.items, ticketIds, skipped };
  }

  /** Create the ticket through the ticket service (user's access, activity, realtime) and link it conditionally. */
  private async createAndLink(
    initiative: InitiativeEntity,
    item: InitiativeWorkItemEntity,
    parentTicketId: string | null,
    tree: InitiativeTree,
    after: string[],
    req?: RequestWithUser,
    epic?: InitiativeWorkItemEntity,
  ): Promise<string | null> {
    const ticket = await this.ticketsService.create(
      {
        ...(parentTicketId ? { parentId: parentTicketId } : { clientId: initiative.clientId }),
        title: initiativeTicketTitle(item),
        content: buildInitiativeTicketBody(initiative, item, {
          epic: epic ?? null,
          after,
          unknowns: tree.unknowns.filter((unknown) => unknown.workItemId === item.id),
        }),
        priority: item.priority,
        status: TicketStatus.DRAFT,
      },
      req,
    );
    const linked = await this.itemRepo.update({ id: item.id, ticketId: IsNull() }, { ticketId: ticket.id });

    if (!linked.affected) {
      // Someone transferred the item meanwhile: remove the duplicate ticket again.
      await this.ticketsService.remove(ticket.id, req).catch(() => undefined);

      return null;
    }

    return ticket.id;
  }

  // --- release ----------------------------------------------------------------------------------------------------

  async release(
    initiativeId: string,
    dto: ReleaseInitiativeDto,
    req?: RequestWithUser,
  ): Promise<InitiativeBuildActionResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);

    this.initiatives.assertNotArchived(initiative);

    const tree = await this.workItems.loadTree(initiative);
    const released = await this.releaseReady(initiative, tree, dto.workItemIds, req);
    const skipped = (dto.workItemIds ?? [])
      .filter((id) => !released.some((entry) => entry.itemId === id))
      .map((id) => {
        const view = tree.dtos.find((dto) => dto.id === id);

        return {
          workItemId: id,
          reason: !view
            ? 'Not part of the initiative'
            : !view.ticketId
              ? 'Not transferred yet'
              : view.status !== 'draft'
                ? `Already ${view.status}`
                : `Waiting for ${view.blockedBy.join(', ')}`,
        };
      });

    if (released.length > 0) {
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.RELEASED,
        this.initiatives.actorOf(req),
        {
          keys: released.map((entry) => entry.key),
        },
      );
    }

    await this.refresh(initiative.id, { autoRelease: false });

    const updated = await this.workItems.list(initiative.id, req);

    return { workItems: updated.items, ticketIds: released.map((entry) => entry.ticketId), skipped };
  }

  /**
   * Release ready, transferred stories that are still `draft` to `todo`. With a request: through the ticket service as
   * that user; without (auto-release): as a conditional system status change.
   */
  private async releaseReady(
    initiative: InitiativeEntity,
    tree: InitiativeTree,
    onlyIds: string[] | undefined,
    req: RequestWithUser | undefined,
  ): Promise<Array<{ itemId: string; key: string; ticketId: string }>> {
    const released: Array<{ itemId: string; key: string; ticketId: string }> = [];

    for (const view of tree.dtos) {
      if (
        view.kind === 'epic' ||
        !view.ticketId ||
        view.ticketStatus !== TicketStatus.DRAFT ||
        !view.ready ||
        (onlyIds && !onlyIds.includes(view.id))
      ) {
        continue;
      }

      try {
        if (req) {
          await this.ticketsService.update(view.ticketId, { status: TicketStatus.TODO }, req);
        } else if (
          !(await this.ticketsService.applySystemStatusChange(
            view.ticketId,
            initiative.clientId,
            [TicketStatus.DRAFT],
            TicketStatus.TODO,
            {
              source: 'initiative_auto_release',
              initiativeId: initiative.id,
              key: view.key,
            },
          ))
        ) {
          continue;
        }

        released.push({ itemId: view.id, key: view.key, ticketId: view.ticketId });
      } catch (error) {
        this.logger.warn(`Release of ${view.key} failed: ${(error as Error).message}`);
      }
    }

    if (released.length > 0) {
      this.initiatives.publish('initiative.work_items.released', initiative.clientId, {
        initiativeId: initiative.id,
        keys: released.map((entry) => entry.key),
        ticketIds: released.map((entry) => entry.ticketId),
        automatic: !req,
      });
    }

    return released;
  }

  // --- ticket board ------------------------------------------------------------------------------------------

  /** The initiative story of a ticket (workspace access of the ticket; `link: null` when not linked). */
  async linkForTicket(ticketId: string, req?: RequestWithUser): Promise<TicketInitiativeLinkDto> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId }, select: ['id', 'clientId'] });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    await this.initiatives.assertClientAccess(ticket.clientId, req);

    const item = await this.itemRepo.findOne({ where: { ticketId, clientId: ticket.clientId } });
    const initiative = item ? await this.initiatives.getEntityOrThrow(item.initiativeId).catch(() => null) : null;

    if (!item || !initiative) {
      return { link: null };
    }

    const view = (await this.workItems.loadTree(initiative)).dtos.find((dto) => dto.id === item.id);

    return {
      link: {
        initiativeId: initiative.id,
        initiativeTitle: initiative.title,
        workItemId: item.id,
        key: item.key,
        status: view?.status ?? item.status,
        ready: view?.ready ?? true,
        blockedBy: view?.blockedBy ?? [],
        automationBlocked: !view || view.status === 'dropped' || !view.ready,
      },
    };
  }

  // --- plan a story --------------------------------------------------------------------------------------------

  /** Plan a transferred story as a chat plan on an environment (explore-only; executes in the chosen visible chat). */
  async planStory(
    itemId: string,
    dto: PlanInitiativeStoryDto,
    req?: RequestWithUser,
  ): Promise<InitiativeBuildActionResponseDto> {
    const { item, initiative } = await this.workItems.getItemForPrincipal(itemId, req);

    if (item.kind === 'epic') {
      throw new BadRequestException('Plan stories, spikes or bugs (not epics)');
    }

    const ticket = item.ticketId
      ? await this.ticketRepo.findOne({ where: { id: item.ticketId, clientId: initiative.clientId } })
      : null;

    if (!ticket?.longSha) {
      throw new ConflictException('Transfer the story to a ticket first');
    }

    if (!(await this.clientAgentCredentialsRepository.findByClientAndAgent(initiative.clientId, dto.agentId))) {
      throw new NotFoundException('Environment not found in this workspace');
    }

    const sessionContext = await this.context.buildSessionContext(initiative, { epicId: item.parentId ?? null });
    const message = [
      `Plan the implementation of ${item.key} "${item.title}" (ticket ${ticket.longSha.slice(0, 8)}) of the initiative ` +
        `"${initiative.title}". The ticket, the initiative overview and its accepted documents are attached as context; ` +
        'stay consistent with them and cover the "Verify" and "Done when" checks.',
      ...(dto.instructions?.trim() ? ['', dto.instructions.trim()] : []),
    ].join('\n');
    const plan = await this.chatPlanService.create(
      {
        clientId: initiative.clientId,
        agentId: dto.agentId,
        chatId: dto.chatId,
        message,
        model: dto.model ?? initiative.defaultModel ?? null,
        contextInjection: {
          includeWorkspace: false,
          environmentIds: [dto.agentId],
          autoEnrichmentEnabled: false,
          ticketShas: [ticket.longSha],
          ...sessionContext,
        },
      },
      req,
    );

    this.chatPlanOrchestrator.startExplore(plan.id);
    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.STORY_PLANNED,
      this.initiatives.actorOf(req),
      {
        key: item.key,
        planId: plan.id,
        agentId: dto.agentId,
      },
    );

    const updated = await this.workItems.list(initiative.id, req);

    return { workItems: updated.items, ticketIds: [ticket.id], skipped: [], planId: plan.id };
  }
}
