import {
  INITIATIVE_LIMITS,
  isLockedWorkItemStatus,
  parseInitiativeProposal,
  type FindingSeverity,
  type FindingSource,
  type InitiativeTurnDecision,
  type InitiativeTurnProposal,
  type ProposalOrigin,
  type RetrospectiveVerdict,
} from '@forepath/agenstra/shared/util-initiative-method';
import type { RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import type {
  ConvertInitiativeFindingDto,
  CreateInitiativeDecisionDto,
  CreateInitiativeFindingDto,
  CreateInitiativeProposalDto,
  DecideInitiativeDecisionDto,
  DecideInitiativeProposalDto,
  OverrideRetrospectiveDto,
  UpdateInitiativeFindingDto,
} from '../dto/initiatives';
import type {
  InitiativeDecisionResponseDto,
  InitiativeFindingResponseDto,
  InitiativeProposalResponseDto,
} from '../dto/initiatives/initiative-response.dto';
import { InitiativeChangeProposalEntity } from '../entities/initiative-change-proposal.entity';
import { InitiativeDecisionEntity } from '../entities/initiative-decision.entity';
import { InitiativeFindingEntity } from '../entities/initiative-finding.entity';
import { InitiativeUnknownEntity } from '../entities/initiative-unknown.entity';
import { InitiativeWorkItemDependencyEntity } from '../entities/initiative-work-item-dependency.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeActionType, InitiativeDecisionStatus } from '../entities/initiative.enums';
import type { InitiativeEntity } from '../entities/initiative.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket.enums';
import type { ContentPrincipal } from '../utils/agent-content-writer.utils';
import { initiativeDecisionToDto, initiativeFindingToDto, initiativeProposalToDto } from '../utils/initiative-mappers';
import { buildInitiativeTicketBody, initiativeTicketTitle } from '../utils/initiative-ticket-body';

import { InitiativeArtifactsService } from './initiative-artifacts.service';
import { INITIATIVES_BOARD_EVENTS } from './initiative-board-realtime.constants';
import { InitiativeWorkItemsService } from './initiative-work-items.service';
import { InitiativesService, type InitiativeActor } from './initiatives.service';
import { TicketsService } from './tickets.service';
import { afterCommit } from './initiative-after-commit';

/** Ticket statuses of stories that have not started (their ticket content may be regenerated). */
const NOT_STARTED_TICKET_STATUSES: readonly TicketStatus[] = [TicketStatus.DRAFT, TicketStatus.TODO];

/** Work item versions share `baseVersions` with document ids (prefixed, so they never collide). */
function proposalItemVersionKey(itemId: string): string {
  return `item:${itemId}`;
}

/** A ticket change of an accepted proposal (runs after COMMIT, with the accepting user's access). */
interface InitiativeTicketEffect {
  workItemId: string;
  ticketId: string;
  run: () => Promise<void>;
}

export interface FindingInput {
  workItemId?: string | null;
  source: FindingSource;
  severity: FindingSeverity;
  body: string;
  evidence?: string[];
  runId?: string | null;
}

@Injectable()
export class InitiativeLearnService {
  private readonly logger = new Logger(InitiativeLearnService.name);

  constructor(
    @InjectRepository(InitiativeFindingEntity)
    private readonly findingRepo: Repository<InitiativeFindingEntity>,
    @InjectRepository(InitiativeChangeProposalEntity)
    private readonly proposalRepo: Repository<InitiativeChangeProposalEntity>,
    @InjectRepository(InitiativeDecisionEntity)
    private readonly decisionRepo: Repository<InitiativeDecisionEntity>,
    @InjectRepository(InitiativeWorkItemEntity)
    private readonly itemRepo: Repository<InitiativeWorkItemEntity>,
    private readonly initiatives: InitiativesService,
    private readonly workItems: InitiativeWorkItemsService,
    private readonly artifacts: InitiativeArtifactsService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
  ) {}

  // --- findings -------------------------------------------------------------------------------------------------------

  async listFindings(
    initiativeId: string,
    status: string | undefined,
    req?: ContentPrincipal,
  ): Promise<InitiativeFindingResponseDto[]> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const rows = await this.findingRepo.find({
      where: {
        initiativeId: initiative.id,
        ...(status ? { status: status as InitiativeFindingEntity['status'] } : {}),
      },
      order: { createdAt: 'DESC' },
      take: INITIATIVE_LIMITS.listMaxLimit,
    });

    return rows.map(initiativeFindingToDto);
  }

  async createFindingByUser(
    initiativeId: string,
    dto: CreateInitiativeFindingDto,
    req?: RequestWithUser,
  ): Promise<InitiativeFindingResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const row = await this.findingRepo.manager.transaction((em) =>
      this.recordFinding(em, initiative, this.initiatives.actorOf(req), {
        workItemId: dto.workItemId ?? null,
        source: 'human',
        severity: dto.severity,
        body: dto.body,
        evidence: dto.evidence,
      }),
    );

    return initiativeFindingToDto(row);
  }

  /** Record a finding (runs, agents, users). Work items must belong to the initiative. */
  async recordFinding(
    em: EntityManager,
    initiative: InitiativeEntity,
    actor: InitiativeActor,
    input: FindingInput,
  ): Promise<InitiativeFindingEntity> {
    if (
      input.workItemId &&
      !(await em
        .getRepository(InitiativeWorkItemEntity)
        .exists({ where: { id: input.workItemId, initiativeId: initiative.id } }))
    ) {
      throw new BadRequestException('The work item belongs to another initiative');
    }

    const repo = em.getRepository(InitiativeFindingEntity);
    const row = await repo.save(
      repo.create({
        initiativeId: initiative.id,
        workItemId: input.workItemId ?? null,
        source: input.source,
        severity: input.severity,
        body: input.body.trim().slice(0, INITIATIVE_LIMITS.findingMaxLength),
        evidence: (input.evidence ?? [])
          .slice(0, INITIATIVE_LIMITS.evidenceRefsMax)
          .map((entry) => entry.slice(0, 500)),
        status: 'open',
        runId: input.runId ?? null,
        agentId: actor.agentId,
        createdByUserId: actor.actorUserId,
      }),
    );

    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.FINDING_CREATED,
      actor,
      { findingId: row.id, severity: row.severity, source: row.source },
      em,
    );
    afterCommit(em, () =>
      this.initiatives.emit(
        initiative.clientId,
        INITIATIVES_BOARD_EVENTS.initiativeFindingUpsert,
        initiativeFindingToDto(row),
      ),
    );

    return row;
  }

  async updateFinding(
    findingId: string,
    dto: UpdateInitiativeFindingDto,
    req?: RequestWithUser,
  ): Promise<InitiativeFindingResponseDto> {
    const { finding, initiative } = await this.getFinding(findingId, req);

    this.initiatives.assertHuman(req);

    if (finding.status === 'converted') {
      throw new ConflictException('Converted findings stay converted');
    }

    finding.status = dto.status;
    finding.resolvedByUserId = dto.status === 'dismissed' ? this.initiatives.userIdOf(req) : null;

    const saved = await this.findingRepo.save(finding);

    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.FINDING_UPDATED,
      this.initiatives.actorOf(req),
      {
        findingId: saved.id,
        status: saved.status,
      },
    );
    this.initiatives.emit(
      initiative.clientId,
      INITIATIVES_BOARD_EVENTS.initiativeFindingUpsert,
      initiativeFindingToDto(saved),
    );

    return initiativeFindingToDto(saved);
  }

  /** Turn a finding into a new work item below an epic (fix now / new story). */
  async convertFinding(
    findingId: string,
    dto: ConvertInitiativeFindingDto,
    req?: RequestWithUser,
  ): Promise<InitiativeFindingResponseDto> {
    const { finding, initiative } = await this.getFinding(findingId, req);

    this.initiatives.assertHuman(req);

    if (finding.status !== 'open') {
      throw new ConflictException('Only open findings can be converted');
    }

    const actor = this.initiatives.actorOf(req);
    const saved = await this.findingRepo.manager.transaction(async (em) => {
      const created = await this.workItems.createItems(
        em,
        initiative,
        [
          {
            key: 'N1',
            kind: finding.severity === 'critical' || finding.severity === 'major' ? 'bug' : 'story',
            title: (dto.title?.trim() || finding.body.split('\n')[0]).slice(0, INITIATIVE_LIMITS.titleMaxLength),
            requirements: finding.body,
            after: [],
            unknowns: [],
          },
        ],
        dto.epicId,
        actor,
      );
      const result = await em
        .createQueryBuilder()
        .update(InitiativeFindingEntity)
        .set({ status: 'converted', resolvedByUserId: actor.actorUserId, updatedAt: () => 'now()' })
        .where('id = :id AND status = :open', { id: finding.id, open: 'open' })
        .execute();

      if (!result.affected) {
        throw new ConflictException('The finding changed meanwhile');
      }

      await this.initiatives.bumpVersion(initiative.id, undefined, em);
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.FINDING_UPDATED,
        actor,
        { findingId: finding.id, status: 'converted', key: [...created.values()][0]?.key },
        em,
      );

      return (await em
        .getRepository(InitiativeFindingEntity)
        .findOne({ where: { id: finding.id } })) as InitiativeFindingEntity;
    });

    this.initiatives.emit(
      initiative.clientId,
      INITIATIVES_BOARD_EVENTS.initiativeFindingUpsert,
      initiativeFindingToDto(saved),
    );
    await this.workItems.emitTree(initiative.id);

    return initiativeFindingToDto(saved);
  }

  private async getFinding(findingId: string, req?: ContentPrincipal) {
    const finding = await this.findingRepo.findOne({ where: { id: findingId } });

    if (!finding) {
      throw new NotFoundException('Finding not found');
    }

    return { finding, initiative: await this.initiatives.getEntityForPrincipal(finding.initiativeId, req) };
  }

  // --- decisions ------------------------------------------------------------------------------------------------------

  async listDecisions(initiativeId: string, req?: ContentPrincipal): Promise<InitiativeDecisionResponseDto[]> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const rows = await this.decisionRepo.find({
      where: { initiativeId: initiative.id },
      order: { createdAt: 'DESC' },
      take: INITIATIVE_LIMITS.listMaxLimit,
    });

    return rows.map(initiativeDecisionToDto);
  }

  async createDecisionByUser(
    initiativeId: string,
    dto: CreateInitiativeDecisionDto,
    req?: RequestWithUser,
  ): Promise<InitiativeDecisionResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const actor = this.initiatives.actorOf(req);
    const [row] = await this.decisionRepo.manager.transaction((em) =>
      this.recordDecisions(em, initiative, actor, [{ title: dto.title, body: dto.body ?? '' }], {
        // A user writing a decision down decides it.
        status: InitiativeDecisionStatus.ACCEPTED,
        workItemId: dto.workItemId ?? null,
      }),
    );

    return initiativeDecisionToDto(row);
  }

  async recordDecisions(
    em: EntityManager,
    initiative: InitiativeEntity,
    actor: InitiativeActor,
    decisions: InitiativeTurnDecision[],
    options: {
      status: InitiativeDecisionStatus;
      workItemId?: string | null;
      proposalId?: string | null;
      runId?: string | null;
    },
  ): Promise<InitiativeDecisionEntity[]> {
    if (
      options.workItemId &&
      !(await em
        .getRepository(InitiativeWorkItemEntity)
        .exists({ where: { id: options.workItemId, initiativeId: initiative.id } }))
    ) {
      throw new BadRequestException('The work item belongs to another initiative');
    }

    const repo = em.getRepository(InitiativeDecisionEntity);
    const rows: InitiativeDecisionEntity[] = [];
    const decided = options.status !== InitiativeDecisionStatus.PROPOSED;

    for (const decision of decisions.slice(0, INITIATIVE_LIMITS.itemsPerTurnMax)) {
      const row = await repo.save(
        repo.create({
          initiativeId: initiative.id,
          workItemId: options.workItemId ?? null,
          title: decision.title.slice(0, INITIATIVE_LIMITS.titleMaxLength),
          body: decision.body.slice(0, INITIATIVE_LIMITS.shortTextMaxLength),
          status: options.status,
          iteration: initiative.iteration,
          proposalId: options.proposalId ?? null,
          runId: options.runId ?? null,
          agentId: actor.agentId,
          createdByUserId: actor.actorUserId,
          decidedByUserId: decided ? actor.actorUserId : null,
          decidedAt: decided ? new Date() : null,
        }),
      );

      rows.push(row);
    }

    if (rows.length > 0) {
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.DECISION_CREATED,
        actor,
        { count: rows.length, status: options.status },
        em,
      );
      afterCommit(em, () => {
        for (const row of rows) {
          this.initiatives.emit(
            initiative.clientId,
            INITIATIVES_BOARD_EVENTS.initiativeDecisionUpsert,
            initiativeDecisionToDto(row),
          );
        }
      });
    }

    return rows;
  }

  async decideDecision(
    decisionId: string,
    dto: DecideInitiativeDecisionDto,
    req?: RequestWithUser,
  ): Promise<InitiativeDecisionResponseDto> {
    const decision = await this.decisionRepo.findOne({ where: { id: decisionId } });

    if (!decision) {
      throw new NotFoundException('Decision not found');
    }

    const initiative = await this.initiatives.getEntityForPrincipal(decision.initiativeId, req);

    this.initiatives.assertHuman(req);

    const actor = this.initiatives.actorOf(req);
    const result = await this.decisionRepo
      .createQueryBuilder()
      .update(InitiativeDecisionEntity)
      .set({
        status: dto.status === 'accepted' ? InitiativeDecisionStatus.ACCEPTED : InitiativeDecisionStatus.REJECTED,
        decidedByUserId: actor.actorUserId,
        decidedAt: new Date(),
      })
      .where('id = :id AND status = :proposed', { id: decision.id, proposed: InitiativeDecisionStatus.PROPOSED })
      .execute();

    if (!result.affected) {
      throw new ConflictException('This decision was decided already');
    }

    const saved = (await this.decisionRepo.findOne({ where: { id: decision.id } })) as InitiativeDecisionEntity;

    await this.initiatives.appendActivity(initiative.id, InitiativeActionType.DECISION_DECIDED, actor, {
      decisionId: saved.id,
      status: saved.status,
    });
    this.initiatives.emit(
      initiative.clientId,
      INITIATIVES_BOARD_EVENTS.initiativeDecisionUpsert,
      initiativeDecisionToDto(saved),
    );

    return initiativeDecisionToDto(saved);
  }

  // --- retrospective --------------------------------------------------------------------------------------------------

  async setRetrospectiveVerdict(
    em: EntityManager,
    initiative: InitiativeEntity,
    epicId: string,
    verdict: RetrospectiveVerdict,
    actor: InitiativeActor,
    overridden: boolean,
  ): Promise<void> {
    const epic = await em
      .getRepository(InitiativeWorkItemEntity)
      .findOne({ where: { id: epicId, initiativeId: initiative.id } });

    if (!epic || epic.kind !== 'epic') {
      throw new BadRequestException('Retrospectives belong to an epic of the initiative');
    }

    await this.workItems.conditionalItemUpdate(em, epic.id, undefined, {
      retrospectiveVerdict: verdict,
      retrospectiveOverridden: overridden,
    });
    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.RETROSPECTIVE_VERDICT,
      actor,
      { key: epic.key, verdict, overridden },
      em,
    );
  }

  /** A human overrides the retrospective verdict (BMad: the skill's verdict can be overridden by a person). */
  async overrideRetrospective(epicId: string, dto: OverrideRetrospectiveDto, req?: RequestWithUser) {
    const { item, initiative } = await this.workItems.getItemForPrincipal(epicId, req);

    this.initiatives.assertHuman(req);

    await this.itemRepo.manager.transaction(async (em) => {
      await this.setRetrospectiveVerdict(em, initiative, item.id, dto.verdict, this.initiatives.actorOf(req), true);
      await this.initiatives.bumpVersion(initiative.id, undefined, em);
    });
    this.initiatives.publish('initiative.retrospective.completed', initiative.clientId, {
      initiativeId: initiative.id,
      epicId: item.id,
      key: item.key,
      verdict: dto.verdict,
      overridden: true,
    });

    return await this.workItems.emitTree(initiative.id);
  }

  // --- proposals ------------------------------------------------------------------------------------------------------

  async listProposals(
    initiativeId: string,
    status: string | undefined,
    req?: ContentPrincipal,
  ): Promise<InitiativeProposalResponseDto[]> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const rows = await this.proposalRepo.find({
      where: {
        initiativeId: initiative.id,
        ...(status ? { status: status as InitiativeChangeProposalEntity['status'] } : {}),
      },
      order: { createdAt: 'DESC' },
      take: INITIATIVE_LIMITS.listMaxLimit,
    });

    return rows.map(initiativeProposalToDto);
  }

  async getProposal(proposalId: string, req?: ContentPrincipal): Promise<InitiativeProposalResponseDto> {
    const { proposal } = await this.getProposalEntity(proposalId, req);

    return initiativeProposalToDto(proposal);
  }

  async createProposalByUser(
    initiativeId: string,
    dto: CreateInitiativeProposalDto,
    req?: RequestWithUser,
  ): Promise<InitiativeProposalResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const changes = parseInitiativeProposal({ ...dto.changes, title: dto.title, rationale: dto.rationale ?? '' });

    if (!changes || (!changes.artifacts.length && !changes.workItems.length && !changes.decisions.length)) {
      throw new BadRequestException('A proposal needs at least one document, work item change or decision');
    }

    const row = await this.proposalRepo.manager.transaction((em) =>
      this.createProposal(em, initiative, changes, {
        origin: 'human',
        actor: this.initiatives.actorOf(req),
        bumpsIteration: dto.bumpsIteration ?? true,
      }),
    );

    return initiativeProposalToDto(row);
  }

  /** Store a proposal with the document versions it was made against (staleness check on accept). */
  async createProposal(
    em: EntityManager,
    initiative: InitiativeEntity,
    changes: InitiativeTurnProposal,
    options: {
      origin: ProposalOrigin;
      actor: InitiativeActor;
      runId?: string | null;
      bumpsIteration?: boolean;
      findingIds?: string[];
    },
  ): Promise<InitiativeChangeProposalEntity> {
    const baseVersions: Record<string, number> = {};

    for (const artifact of changes.artifacts) {
      const existing =
        artifact.type === 'note' ? null : await this.artifacts.findExisting(em, initiative.id, artifact.type, null);

      if (existing) {
        baseVersions[existing.id] = existing.currentVersion;
      }
    }

    // Existing work items the proposal rewrites: accepting it after someone else edited them is stale.
    const itemKeys = [
      ...new Set(changes.workItems.flatMap((op) => (op.op === 'update' || op.op === 'drop' ? [op.key] : []))),
    ];

    if (itemKeys.length > 0) {
      const items = await em
        .getRepository(InitiativeWorkItemEntity)
        .find({ where: { initiativeId: initiative.id, key: In(itemKeys) }, select: ['id', 'version'] });

      for (const item of items) {
        baseVersions[proposalItemVersionKey(item.id)] = item.version;
      }
    }

    const repo = em.getRepository(InitiativeChangeProposalEntity);
    const row = await repo.save(
      repo.create({
        initiativeId: initiative.id,
        origin: options.origin,
        title: changes.title.slice(0, INITIATIVE_LIMITS.titleMaxLength),
        rationale: changes.rationale,
        changes,
        baseVersions,
        status: 'open',
        bumpsIteration: options.bumpsIteration ?? true,
        runId: options.runId ?? null,
        agentId: options.actor.agentId,
        createdByUserId: options.actor.actorUserId,
      }),
    );

    if (options.findingIds?.length) {
      await em
        .getRepository(InitiativeFindingEntity)
        .update({ id: In(options.findingIds), initiativeId: initiative.id, status: 'open' }, { proposalId: row.id });
    }

    await this.initiatives.appendActivity(
      initiative.id,
      InitiativeActionType.PROPOSAL_CREATED,
      options.actor,
      { proposalId: row.id, title: row.title, origin: row.origin },
      em,
    );
    afterCommit(em, () => {
      this.initiatives.emit(
        initiative.clientId,
        INITIATIVES_BOARD_EVENTS.initiativeProposalUpsert,
        initiativeProposalToDto(row),
      );
      this.initiatives.publish('initiative.proposal.created', initiative.clientId, {
        initiativeId: initiative.id,
        proposalId: row.id,
        title: row.title,
        origin: row.origin,
      });
    });

    return row;
  }

  async rejectProposal(
    proposalId: string,
    dto: DecideInitiativeProposalDto,
    req?: RequestWithUser,
  ): Promise<InitiativeProposalResponseDto> {
    const { proposal, initiative } = await this.getProposalEntity(proposalId, req);

    this.initiatives.assertHuman(req);

    const actor = this.initiatives.actorOf(req);
    const saved = await this.proposalRepo.manager.transaction(async (em) => {
      await this.transitionProposal(em, proposal.id, ['open', 'stale'], {
        status: 'rejected',
        decidedByUserId: actor.actorUserId,
        decidedAt: new Date(),
        decisionNote: dto.note?.trim() || null,
      });
      await em
        .getRepository(InitiativeFindingEntity)
        .update({ proposalId: proposal.id, status: 'open' }, { proposalId: null });
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.PROPOSAL_REJECTED,
        actor,
        { proposalId: proposal.id },
        em,
      );

      return (await em
        .getRepository(InitiativeChangeProposalEntity)
        .findOne({ where: { id: proposal.id } })) as InitiativeChangeProposalEntity;
    });

    this.afterProposalDecision(initiative, saved);

    return initiativeProposalToDto(saved);
  }

  /**
   * Apply a proposal atomically (human only): document versions (accepted), work-item operations on items that have
   * not started, accepted decisions, the next iteration. Stale when a changed document moved on since.
   */
  async acceptProposal(
    proposalId: string,
    dto: DecideInitiativeProposalDto,
    req?: RequestWithUser,
  ): Promise<InitiativeProposalResponseDto> {
    const { proposal, initiative } = await this.getProposalEntity(proposalId, req);

    this.initiatives.assertHuman(req);

    const actor = this.initiatives.actorOf(req);
    const ticketEffects: InitiativeTicketEffect[] = [];
    let saved: InitiativeChangeProposalEntity;

    try {
      saved = await this.proposalRepo.manager.transaction(async (em) => {
        await this.transitionProposal(em, proposal.id, ['open'], {
          status: 'accepted',
          decidedByUserId: actor.actorUserId,
          decidedAt: new Date(),
          decisionNote: dto.note?.trim() || null,
        });

        const current = proposal.bumpsIteration
          ? await this.initiatives.bumpVersion(initiative.id, undefined, em, {
              // Incremented in SQL: two accepts racing each other must not both write the same iteration.
              iteration: (() => 'iteration + 1') as unknown as number,
              phase: 'plan',
            })
          : await this.initiatives.bumpVersion(initiative.id, undefined, em);

        await this.applyChanges(em, current, proposal, actor, !!dto.closeDroppedTickets, ticketEffects, req);
        await em
          .getRepository(InitiativeFindingEntity)
          .update(
            { proposalId: proposal.id, status: 'open' },
            { status: 'converted', resolvedByUserId: actor.actorUserId },
          );
        await this.initiatives.appendActivity(
          initiative.id,
          InitiativeActionType.PROPOSAL_ACCEPTED,
          actor,
          { proposalId: proposal.id, iteration: current.iteration },
          em,
        );

        return (await em
          .getRepository(InitiativeChangeProposalEntity)
          .findOne({ where: { id: proposal.id } })) as InitiativeChangeProposalEntity;
      });
    } catch (error) {
      if (error instanceof StaleProposalError) {
        await this.proposalRepo.update({ id: proposal.id, status: 'open' }, { status: 'stale' });
        const stale = (await this.proposalRepo.findOne({
          where: { id: proposal.id },
        })) as InitiativeChangeProposalEntity;

        this.initiatives.emit(
          initiative.clientId,
          INITIATIVES_BOARD_EVENTS.initiativeProposalUpsert,
          initiativeProposalToDto(stale),
        );
        throw new ConflictException(error.message);
      }

      throw error;
    }

    // Ticket changes go through the ticket service (the accepting user's access, ticket activity and realtime). The
    // proposal is committed: a failing ticket (deleted, no access) becomes a finding instead of aborting the rest.
    for (const effect of ticketEffects) {
      try {
        await effect.run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(`Proposal ${proposal.id}: ticket ${effect.ticketId} could not be updated: ${message}`);
        await this.findingRepo.manager
          .transaction((em) =>
            this.recordFinding(em, initiative, actor, {
              workItemId: effect.workItemId,
              source: 'human',
              severity: 'major',
              body: `Accepting "${proposal.title}" could not update ticket ${effect.ticketId}: ${message}. Update the ticket by hand.`,
            }),
          )
          .catch((recordError: unknown) =>
            this.logger.warn(`Could not record the ticket failure: ${String(recordError)}`),
          );
      }
    }

    this.afterProposalDecision(initiative, saved);
    await this.workItems.emitTree(initiative.id);

    return initiativeProposalToDto(saved);
  }

  private afterProposalDecision(initiative: InitiativeEntity, saved: InitiativeChangeProposalEntity): void {
    this.initiatives.emit(
      initiative.clientId,
      INITIATIVES_BOARD_EVENTS.initiativeProposalUpsert,
      initiativeProposalToDto(saved),
    );
    this.initiatives.publish('initiative.proposal.decided', initiative.clientId, {
      initiativeId: initiative.id,
      proposalId: saved.id,
      title: saved.title,
      status: saved.status,
    });
  }

  private async transitionProposal(
    em: EntityManager,
    proposalId: string,
    from: string[],
    patch: Partial<InitiativeChangeProposalEntity>,
  ): Promise<void> {
    const result = await em
      .createQueryBuilder()
      .update(InitiativeChangeProposalEntity)
      .set({ ...patch, updatedAt: () => 'now()' })
      .where('id = :id AND status IN (:...from)', { id: proposalId, from })
      .execute();

    if (!result.affected) {
      throw new ConflictException('This proposal was decided already (or is stale: create a new one).');
    }
  }

  private async getProposalEntity(proposalId: string, req?: ContentPrincipal) {
    const proposal = await this.proposalRepo.findOne({ where: { id: proposalId } });

    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    return { proposal, initiative: await this.initiatives.getEntityForPrincipal(proposal.initiativeId, req) };
  }

  private async applyChanges(
    em: EntityManager,
    initiative: InitiativeEntity,
    proposal: InitiativeChangeProposalEntity,
    actor: InitiativeActor,
    closeDroppedTickets: boolean,
    ticketEffects: InitiativeTicketEffect[],
    principal: RequestWithUser | undefined,
  ): Promise<void> {
    const changes = proposal.changes;

    for (const artifact of changes.artifacts) {
      const existing =
        artifact.type === 'note' ? null : await this.artifacts.findExisting(em, initiative.id, artifact.type, null);

      if (
        existing &&
        proposal.baseVersions[existing.id] !== undefined &&
        proposal.baseVersions[existing.id] !== existing.currentVersion
      ) {
        throw new StaleProposalError(`${existing.title} changed since the proposal was made; create a new proposal.`);
      }

      if (existing && proposal.baseVersions[existing.id] === undefined) {
        throw new StaleProposalError(`${existing.title} was created after the proposal; create a new proposal.`);
      }

      const written = await this.artifacts.writeArtifact(em, initiative, {
        type: artifact.type,
        title: artifact.title,
        content: artifact.content,
        source: 'proposal',
        proposalId: proposal.id,
        actor,
        accept: true,
      });

      afterCommit(em, () => this.artifacts.emitArtifact(initiative, written));
    }

    const tree = await this.workItems.loadTree(initiative, em);
    const byKey = new Map(tree.items.map((item) => [item.key, item]));
    const repo = em.getRepository(InitiativeWorkItemEntity);
    const changedItemIds = new Set<string>();
    const rewritten = new Set<string>();
    const assertUnlocked = (key: string) => {
      const item = byKey.get(key);

      if (!item) {
        throw new BadRequestException(`Unknown work item ${key}`);
      }

      if (isLockedWorkItemStatus(tree.statusById.get(item.id) ?? 'draft')) {
        throw new ConflictException(`${key} is built or done and is never rewritten; add a new item instead.`);
      }

      const base = proposal.baseVersions[proposalItemVersionKey(item.id)];

      if (base !== undefined && base !== item.version) {
        throw new StaleProposalError(`${key} was edited after the proposal; create a new proposal.`);
      }

      return item;
    };

    // Epics first, so items of new epics can name them as parentKey.
    const adds = changes.workItems.filter((op) => op.op === 'add') as Array<
      Extract<(typeof changes.workItems)[number], { op: 'add' }>
    >;

    for (const op of [...adds.filter((a) => a.item.kind === 'epic'), ...adds.filter((a) => a.item.kind !== 'epic')]) {
      const parent = op.item.kind === 'epic' ? null : op.parentKey ? byKey.get(op.parentKey) : undefined;

      if (op.item.kind !== 'epic' && !parent) {
        throw new BadRequestException(`${op.item.title}: parentKey must name an epic`);
      }

      const created = await this.workItems.createItems(em, initiative, [op.item], parent?.id ?? null, actor);
      const row = created.get(op.item.key) as InitiativeWorkItemEntity;

      byKey.set(op.item.key, row);
      byKey.set(row.key, row);
      changedItemIds.add(row.id);
    }

    for (const op of changes.workItems) {
      switch (op.op) {
        case 'update': {
          const item = assertUnlocked(op.key);
          const patch: Partial<InitiativeWorkItemEntity> = {};

          if (op.title !== undefined) patch.title = op.title;
          if (op.requirements !== undefined) patch.requirements = op.requirements;
          if (op.verify !== undefined) patch.verify = op.verify;
          if (op.doneWhen !== undefined) patch.doneWhen = op.doneWhen;

          if (Object.keys(patch).length > 0) {
            // The first write is conditional on the version the proposal saw; later ops on the same item follow it.
            const expected = rewritten.has(item.id)
              ? undefined
              : proposal.baseVersions[proposalItemVersionKey(item.id)];

            try {
              await this.workItems.conditionalItemUpdate(em, item.id, expected, patch);
            } catch (error) {
              // Edited between the check above and this write: the proposal is stale, not just this request.
              if (error instanceof ConflictException && expected !== undefined) {
                throw new StaleProposalError(`${op.key} was edited after the proposal; create a new proposal.`);
              }

              throw error;
            }

            rewritten.add(item.id);
          }

          if (op.after !== undefined) {
            const prerequisiteIds = op.after
              .map((key) => byKey.get(key)?.id)
              .filter((id): id is string => !!id && id !== item.id);

            await this.workItems.replaceDependencies(em, initiative, item, [...new Set(prerequisiteIds)]);
          }

          changedItemIds.add(item.id);
          break;
        }
        case 'drop': {
          const item = assertUnlocked(op.key);

          if (item.ticketId && tree.ticketStatusByItemId.has(item.id)) {
            if (!closeDroppedTickets) {
              throw new ConflictException(`${op.key} has a ticket: confirm closing the tickets of dropped stories.`);
            }

            const ticketId = item.ticketId;

            ticketEffects.push({
              workItemId: item.id,
              ticketId,
              run: async () => {
                await this.ticketsService.update(ticketId, { status: TicketStatus.CLOSED }, principal);
              },
            });
          } else {
            await this.workItems.conditionalItemUpdate(em, item.id, undefined, { status: 'dropped' });
          }

          break;
        }
        case 'move': {
          const item = assertUnlocked(op.key);
          const before = op.beforeKey ? byKey.get(op.beforeKey) : undefined;

          await this.workItems.moveBefore(em, item, before?.id);
          break;
        }
        default:
          break;
      }
    }

    // Stories that changed and have a ticket that has not started get a regenerated body; started ones a comment.
    for (const itemId of changedItemIds) {
      const item = await repo.findOne({ where: { id: itemId } });

      if (!item?.ticketId) {
        continue;
      }

      const ticket = await em
        .getRepository(TicketEntity)
        .findOne({ where: { id: item.ticketId, clientId: initiative.clientId } });

      if (!ticket) {
        continue;
      }

      const epic = item.parentId ? await repo.findOne({ where: { id: item.parentId } }) : null;
      const deps = await em.getRepository(InitiativeWorkItemDependencyEntity).find({ where: { workItemId: item.id } });
      const after = deps
        .map((dep) => tree.items.find((row) => row.id === dep.prerequisiteId)?.key)
        .filter((k): k is string => !!k);
      const unknowns = await em.getRepository(InitiativeUnknownEntity).find({ where: { workItemId: item.id } });
      const body = buildInitiativeTicketBody(initiative, item, { epic, after, unknowns });

      if (NOT_STARTED_TICKET_STATUSES.includes(ticket.status)) {
        ticketEffects.push({
          workItemId: item.id,
          ticketId: ticket.id,
          run: async () => {
            await this.ticketsService.update(
              ticket.id,
              { title: initiativeTicketTitle(item), content: body },
              principal,
            );
          },
        });
      } else {
        ticketEffects.push({
          workItemId: item.id,
          ticketId: ticket.id,
          run: async () => {
            await this.ticketsService.addComment(
              ticket.id,
              {
                body:
                  `Requirements of ${item.key} changed in iteration ${initiative.iteration} ("${proposal.title}"). ` +
                  'The ticket was not rewritten because work has started:\n\n' +
                  body,
              },
              principal,
            );
          },
        });
      }
    }

    await this.recordDecisions(em, initiative, actor, changes.decisions, {
      status: InitiativeDecisionStatus.ACCEPTED,
      proposalId: proposal.id,
    });
  }
}

class StaleProposalError extends Error {}
