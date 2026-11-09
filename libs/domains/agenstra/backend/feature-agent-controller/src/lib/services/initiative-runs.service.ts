import {
  ACTIVE_RUN_STATUSES,
  ANSWERABLE_RUN_STATUSES,
  INITIATIVE_LIMITS,
  findInitiativeStep,
  isLockedWorkItemStatus,
  stepAvailability,
  type InitiativeRunMode,
  type InitiativeRunStatus,
  type InitiativeStepDefinition,
  type InitiativeTurnStatus,
  type InitiativeTurnWorkItem,
} from '@forepath/agenstra/shared/util-initiative-method';
import { ClientAgentCredentialsRepository, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import type { DecideInitiativeRunDto, InitiativeRunMessageDto, StartInitiativeRunDto } from '../dto/initiatives';
import type { InitiativeRunResponseDto } from '../dto/initiatives/initiative-response.dto';
import { InitiativeArtifactEntity } from '../entities/initiative-artifact.entity';
import { InitiativeFindingEntity } from '../entities/initiative-finding.entity';
import { InitiativeRunTurnEntity, type InitiativeRunTurnRole } from '../entities/initiative-run-turn.entity';
import { InitiativeRunEntity } from '../entities/initiative-run.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeActionType, InitiativeDecisionStatus } from '../entities/initiative.enums';
import type { InitiativeEntity } from '../entities/initiative.entity';
import type { ContentPrincipal } from '../utils/agent-content-writer.utils';
import { initiativeRunToDto, initiativeRunTurnToDto } from '../utils/initiative-mappers';

import { InitiativeArtifactsService } from './initiative-artifacts.service';
import { INITIATIVES_BOARD_EVENTS } from './initiative-board-realtime.constants';
import { InitiativeLearnService } from './initiative-learn.service';
import { InitiativeWorkItemsService, type InitiativeTree } from './initiative-work-items.service';
import { InitiativesService, type InitiativeActor } from './initiatives.service';
import { afterCommit } from './initiative-after-commit';

/** Statuses a run can be discarded / cancelled from. */
const CANCELLABLE: readonly InitiativeRunStatus[] = ['pending', 'working', 'needs_input', 'ready'];

function maxActiveRunsPerClient(): number {
  const value = Number.parseInt(process.env.INITIATIVE_MAX_ACTIVE_RUNS_PER_CLIENT ?? '', 10);

  return Number.isFinite(value) && value > 0 ? value : INITIATIVE_LIMITS.activeRunsPerClientDefault;
}

/** Callback the orchestrator registers (avoids a constructor cycle). */
export interface InitiativeRunDriver {
  startTurn(runId: string, message: string, firstTurn: boolean): void;
}

/**
 * Guided step runs: start, answer, accept, discard, cancel, retry. Accepting applies the agent's latest result as the
 * signed-off outcome of a human (documents accepted, items created, findings recorded), conditionally on the versions
 * the run started from (a moved-on target becomes a change proposal instead of an overwrite).
 */
@Injectable()
export class InitiativeRunsService {
  private driver?: InitiativeRunDriver;

  constructor(
    @InjectRepository(InitiativeRunEntity)
    private readonly runRepo: Repository<InitiativeRunEntity>,
    @InjectRepository(InitiativeRunTurnEntity)
    private readonly turnRepo: Repository<InitiativeRunTurnEntity>,
    @InjectRepository(InitiativeArtifactEntity)
    private readonly artifactRepo: Repository<InitiativeArtifactEntity>,
    @InjectRepository(InitiativeWorkItemEntity)
    private readonly itemRepo: Repository<InitiativeWorkItemEntity>,
    @InjectRepository(InitiativeFindingEntity)
    private readonly findingRepo: Repository<InitiativeFindingEntity>,
    private readonly initiatives: InitiativesService,
    private readonly workItems: InitiativeWorkItemsService,
    private readonly artifacts: InitiativeArtifactsService,
    private readonly learn: InitiativeLearnService,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
  ) {}

  registerDriver(driver: InitiativeRunDriver): void {
    this.driver = driver;
  }

  // --- reads ----------------------------------------------------------------------------------------------------

  async list(initiativeId: string, req?: ContentPrincipal): Promise<InitiativeRunResponseDto[]> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);
    const rows = await this.runRepo.find({
      where: { initiativeId: initiative.id },
      order: { createdAt: 'DESC' },
      take: INITIATIVE_LIMITS.listMaxLimit,
    });

    return rows.map((row) => initiativeRunToDto(row));
  }

  async get(runId: string, req?: ContentPrincipal): Promise<InitiativeRunResponseDto> {
    const { run } = await this.getRunForPrincipal(runId, req);
    const turns = await this.turnRepo.find({ where: { runId: run.id }, order: { seq: 'ASC' } });

    return initiativeRunToDto(run, turns);
  }

  async getRunForPrincipal(
    runId: string,
    req?: ContentPrincipal,
  ): Promise<{ run: InitiativeRunEntity; initiative: InitiativeEntity }> {
    const run = await this.runRepo.findOne({ where: { id: runId } });

    if (!run) {
      throw new NotFoundException('Run not found');
    }

    return { run, initiative: await this.initiatives.getEntityForPrincipal(run.initiativeId, req) };
  }

  // --- start / answer ----------------------------------------------------------------------------------------------

  async start(
    initiativeId: string,
    dto: StartInitiativeRunDto,
    req?: RequestWithUser,
  ): Promise<InitiativeRunResponseDto> {
    const initiative = await this.initiatives.getEntityForPrincipal(initiativeId, req);

    this.initiatives.assertNotArchived(initiative);

    const step = findInitiativeStep(dto.step) as InitiativeStepDefinition;
    const agentId = dto.agentId ?? initiative.defaultAgentId ?? undefined;

    if (!agentId) {
      throw new BadRequestException('Choose an environment (or set the facilitator environment of the initiative)');
    }

    // The environment must belong to the workspace (same rule as chats and plans).
    if (!(await this.clientAgentCredentialsRepository.findByClientAndAgent(initiative.clientId, agentId))) {
      throw new NotFoundException('Environment not found in this workspace');
    }

    const tree = await this.workItems.loadTree(initiative);
    const epic = dto.workItemId ? tree.items.find((item) => item.id === dto.workItemId) : undefined;

    if (dto.workItemId && (!epic || epic.kind !== 'epic')) {
      throw new BadRequestException('The target must be an epic of the initiative');
    }

    const availability = stepAvailability(step, await this.workItems.snapshot(initiative, tree), epic?.id ?? null);

    if (!availability.available) {
      throw new BadRequestException(availability.missing.join(' '));
    }

    const targetArtifact =
      step.output.kind === 'artifact'
        ? await this.artifacts.findExisting(this.artifactRepo.manager, initiative.id, step.output.artifactType, null)
        : step.output.kind === 'retrospective' && epic
          ? await this.artifacts.findExisting(this.artifactRepo.manager, initiative.id, 'retrospective', epic.id)
          : null;
    const mode = this.resolveMode(step, dto.mode, !!targetArtifact);

    if (mode === 'validate' && !targetArtifact) {
      throw new BadRequestException('There is no document to validate yet');
    }

    const findingIds = await this.validFindingIds(initiative, dto.findingIds);
    const actor = this.initiatives.actorOf(req);
    const baseVersions: Record<string, number> = {};

    if (targetArtifact) {
      baseVersions[targetArtifact.id] = targetArtifact.currentVersion;
    }

    if (epic) {
      baseVersions[epic.id] = epic.version;
    }

    const message = dto.message?.trim() ?? '';
    const run = await this.runRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(InitiativeRunEntity);

      // Checked under the initiative's row lock: two users starting the same step cannot both get an active run.
      await this.initiatives.lockWorkspaceRuns(em, initiative.clientId);
      await this.initiatives.lockInitiative(em, initiative.id);

      const active = await repo.count({
        where: { clientId: initiative.clientId, status: In([...ACTIVE_RUN_STATUSES]) },
      });

      if (active >= maxActiveRunsPerClient()) {
        throw new ConflictException('Too many active runs in this workspace; accept, discard or cancel one first.');
      }

      if (
        await repo.exists({
          where: {
            initiativeId: initiative.id,
            step: step.key,
            ...(epic ? { targetWorkItemId: epic.id } : {}),
            status: In([...ACTIVE_RUN_STATUSES]),
          },
        })
      ) {
        throw new ConflictException('This step is already running for this target; continue it or discard it first.');
      }

      const row = await repo.save(
        repo.create({
          initiativeId: initiative.id,
          clientId: initiative.clientId,
          step: step.key,
          mode,
          style: dto.style ?? 'coaching',
          targetWorkItemId: epic?.id ?? null,
          targetArtifactId: targetArtifact?.id ?? null,
          agentId,
          model: dto.model?.trim() || initiative.defaultModel || null,
          status: 'pending',
          resumeSessionSuffix: '-initiative-pending',
          baseVersions,
          findingIds,
          createdByUserId: actor.actorUserId,
          version: 1,
        }),
      );

      row.resumeSessionSuffix = `-initiative-${row.id}`;
      await repo.update(row.id, { resumeSessionSuffix: row.resumeSessionSuffix });
      await this.appendTurn(em, row, 'user', message || `Start: ${step.title} (${mode})`, actor.actorUserId);
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.RUN_STARTED,
        actor,
        { runId: row.id, step: step.key, mode, agentId, epicKey: epic?.key ?? null },
        em,
      );

      return row;
    });

    this.emitRun(initiative, run);
    this.driver?.startTurn(run.id, message, true);

    return this.get(run.id, req);
  }

  private resolveMode(
    step: InitiativeStepDefinition,
    requested: InitiativeRunMode | undefined,
    hasTarget: boolean,
  ): InitiativeRunMode {
    if (requested) {
      if (!step.modes.includes(requested)) {
        throw new BadRequestException(`${step.title} supports: ${step.modes.join(', ')}`);
      }

      // Creating a document that exists already updates it.
      return requested === 'create' && hasTarget && step.modes.includes('update') ? 'update' : requested;
    }

    if (hasTarget && step.modes.includes('update')) {
      return 'update';
    }

    return step.modes[0];
  }

  private async validFindingIds(initiative: InitiativeEntity, ids: string[] | undefined): Promise<string[]> {
    if (!ids?.length) {
      return [];
    }

    const rows = await this.findingRepo.find({
      where: { id: In(ids.slice(0, INITIATIVE_LIMITS.itemsPerTurnMax)), initiativeId: initiative.id, status: 'open' },
      select: ['id'],
    });

    return rows.map((row) => row.id);
  }

  async message(runId: string, dto: InitiativeRunMessageDto, req?: RequestWithUser): Promise<InitiativeRunResponseDto> {
    const { run, initiative } = await this.getRunForPrincipal(runId, req);
    const actor = this.initiatives.actorOf(req);
    const message = dto.message.trim();

    await this.runRepo.manager.transaction(async (em) => {
      // One turn at a time: a message while the agent answers is refused (any member may answer otherwise).
      await this.transition(em, run.id, ANSWERABLE_RUN_STATUSES, {
        status: 'working',
        failureCode: null,
        failureMessage: null,
      });
      await this.appendTurn(em, run, 'user', message, actor.actorUserId);
    });

    const updated = (await this.runRepo.findOne({ where: { id: run.id } })) as InitiativeRunEntity;

    this.emitRun(initiative, updated);
    this.driver?.startTurn(run.id, message, false);

    return this.get(run.id, req);
  }

  async retry(runId: string, req?: RequestWithUser): Promise<InitiativeRunResponseDto> {
    const { run, initiative } = await this.getRunForPrincipal(runId, req);
    const lastUser = await this.turnRepo.findOne({ where: { runId: run.id, role: 'user' }, order: { seq: 'DESC' } });
    const firstTurn = (await this.turnRepo.count({ where: { runId: run.id, role: 'agent' } })) === 0;

    await this.runRepo.manager.transaction((em) =>
      this.transition(em, run.id, ['failed'], {
        status: 'working',
        failureCode: null,
        failureMessage: null,
        finishedAt: null,
      }),
    );
    this.emitRun(initiative, (await this.runRepo.findOne({ where: { id: run.id } })) as InitiativeRunEntity);
    this.driver?.startTurn(
      run.id,
      firstTurn
        ? lastUser?.content.startsWith('Start: ')
          ? ''
          : (lastUser?.content ?? '')
        : (lastUser?.content ?? ''),
      firstTurn,
    );

    return this.get(run.id, req);
  }

  async discard(runId: string, dto: DecideInitiativeRunDto, req?: RequestWithUser): Promise<InitiativeRunResponseDto> {
    return this.close(runId, dto, req, 'discarded', InitiativeActionType.RUN_DISCARDED, [
      'pending',
      'needs_input',
      'ready',
      'failed',
    ]);
  }

  async cancel(runId: string, dto: DecideInitiativeRunDto, req?: RequestWithUser): Promise<InitiativeRunResponseDto> {
    return this.close(runId, dto, req, 'cancelled', InitiativeActionType.RUN_CANCELLED, CANCELLABLE);
  }

  private async close(
    runId: string,
    dto: DecideInitiativeRunDto,
    req: RequestWithUser | undefined,
    status: InitiativeRunStatus,
    action: InitiativeActionType,
    from: readonly InitiativeRunStatus[],
  ): Promise<InitiativeRunResponseDto> {
    const { run, initiative } = await this.getRunForPrincipal(runId, req);
    const actor = this.initiatives.actorOf(req);

    await this.runRepo.manager.transaction(async (em) => {
      await this.transition(
        em,
        run.id,
        from,
        { status, finishedAt: new Date(), decidedByUserId: actor.actorUserId, streamingText: null },
        dto.expectedVersion,
      );
      await this.initiatives.appendActivity(initiative.id, action, actor, { runId: run.id, step: run.step }, em);
    });
    this.emitRun(initiative, (await this.runRepo.findOne({ where: { id: run.id } })) as InitiativeRunEntity);

    return this.get(run.id, req);
  }

  // --- accept -------------------------------------------------------------------------------------------------------

  /** Apply the agent's latest result (human only). */
  async accept(runId: string, dto: DecideInitiativeRunDto, req?: RequestWithUser): Promise<InitiativeRunResponseDto> {
    const { run, initiative } = await this.getRunForPrincipal(runId, req);

    this.initiatives.assertHuman(req);

    const result = run.result;

    if (!result || !['ready', 'needs_input'].includes(run.status)) {
      throw new ConflictException('There is no result to accept yet');
    }

    const step = findInitiativeStep(run.step) as InitiativeStepDefinition;
    const actor = this.initiatives.actorOf(req);
    const outcome: { proposalId?: string; verdict?: string } = {};

    await this.runRepo.manager.transaction(async (em) => {
      await this.transition(
        em,
        run.id,
        ['ready', 'needs_input'],
        { status: 'accepted', finishedAt: new Date(), decidedByUserId: actor.actorUserId, streamingText: null },
        dto.expectedVersion,
      );

      const current = await this.initiatives.bumpVersion(initiative.id, undefined, em);

      await this.applyResult(em, current, run, step, result, actor, outcome);
      await this.initiatives.appendActivity(
        initiative.id,
        InitiativeActionType.RUN_ACCEPTED,
        actor,
        { runId: run.id, step: run.step, mode: run.mode, ...outcome },
        em,
      );
    });

    const accepted = (await this.runRepo.findOne({ where: { id: run.id } })) as InitiativeRunEntity;

    this.emitRun(initiative, accepted);

    if (step.output.kind === 'retrospective' && outcome.verdict) {
      this.initiatives.publish('initiative.retrospective.completed', initiative.clientId, {
        initiativeId: initiative.id,
        epicId: run.targetWorkItemId,
        verdict: outcome.verdict,
        overridden: false,
      });
    }

    for (const artifact of await this.artifactRepo.find({ where: { initiativeId: initiative.id } })) {
      this.artifacts.emitArtifact(initiative, artifact);
    }

    await this.workItems.emitTree(initiative.id);

    return this.get(run.id, req);
  }

  private async applyResult(
    em: EntityManager,
    initiative: InitiativeEntity,
    run: InitiativeRunEntity,
    step: InitiativeStepDefinition,
    result: InitiativeTurnStatus,
    actor: InitiativeActor,
    outcome: { proposalId?: string; verdict?: string },
  ): Promise<void> {
    const output = step.output;
    const findingSource = output.kind === 'retrospective' ? 'retrospective' : 'run';
    const tree = await this.workItems.loadTree(initiative, em);
    const keyed = new Map(tree.items.map((item) => [item.key, item]));

    // Findings and decisions of every step (validate runs only produce these).
    for (const finding of result.findings) {
      await this.learn.recordFinding(em, initiative, actor, {
        workItemId: finding.itemKey ? (keyed.get(finding.itemKey)?.id ?? null) : (run.targetWorkItemId ?? null),
        source: findingSource,
        severity: finding.severity,
        body: finding.body,
        evidence: finding.evidence,
        runId: run.id,
      });
    }

    if (result.decisions.length > 0) {
      // BMad: decision records of a retrospective are written only after a human approves each one.
      await this.learn.recordDecisions(em, initiative, actor, result.decisions, {
        status: output.kind === 'retrospective' ? InitiativeDecisionStatus.PROPOSED : InitiativeDecisionStatus.ACCEPTED,
        workItemId: run.targetWorkItemId ?? null,
        runId: run.id,
      });
    }

    switch (output.kind) {
      case 'artifact': {
        if (run.mode === 'validate') {
          return;
        }

        if (!result.draftMarkdown) {
          throw new BadRequestException('The result has no document yet');
        }

        const target = await this.artifacts.findExisting(em, initiative.id, output.artifactType, null);

        if (target && target.currentVersion !== run.baseVersions[target.id]) {
          // The document moved on (or was created) while the run worked: propose instead of overwriting.
          const proposal = await this.learn.createProposal(
            em,
            initiative,
            {
              title: `${step.title}: result of a run`,
              rationale: 'The document changed while the run was working; review the differences before accepting.',
              artifacts: [{ type: output.artifactType, content: result.draftMarkdown }],
              workItems: [],
              decisions: [],
            },
            { origin: 'run', actor, runId: run.id, bumpsIteration: false },
          );

          outcome.proposalId = proposal.id;

          return;
        }

        await this.artifacts.writeArtifact(em, initiative, {
          type: output.artifactType,
          content: result.draftMarkdown,
          source: 'run',
          runId: run.id,
          actor,
          accept: true,
        });

        return;
      }
      case 'epics':
        await this.applyItems(
          em,
          initiative,
          tree,
          result.workItems.filter((item) => item.kind === 'epic'),
          null,
          actor,
        );

        return;
      case 'stories': {
        const epic = this.targetEpic(tree, run);

        await this.applyItems(
          em,
          initiative,
          tree,
          result.workItems.filter((item) => item.kind !== 'epic'),
          epic,
          actor,
        );

        return;
      }
      case 'epic-refinement': {
        const epic = this.targetEpic(tree, run);

        if (!result.epic) {
          throw new BadRequestException('The result has no epic refinement yet');
        }

        await this.workItems.conditionalItemUpdate(em, epic.id, run.baseVersions[epic.id], {
          requirements: result.epic.requirements,
          ...(result.epic.doneWhen ? { doneWhen: result.epic.doneWhen } : {}),
          refined: true,
        });

        for (const unknown of result.epic.unknowns) {
          await this.workItems.saveUnknown(em, initiative.id, epic.id, unknown);
        }

        return;
      }
      case 'review':
        outcome.verdict = result.verdict;

        return;
      case 'retrospective': {
        const epic = this.targetEpic(tree, run);
        const unfinished = tree.items.some(
          (item) =>
            item.parentId === epic.id && !['built', 'done', 'dropped'].includes(tree.statusById.get(item.id) as string),
        );
        // Unfinished stories force "rejected" (a human may override the verdict afterwards).
        const verdict = unfinished ? 'rejected' : (result.verdict ?? 'accepted-with-open-items');

        if (result.draftMarkdown) {
          await this.artifacts.writeArtifact(em, initiative, {
            type: 'retrospective',
            workItemId: epic.id,
            title: `Retrospective ${epic.key}`,
            content: result.draftMarkdown,
            source: 'run',
            runId: run.id,
            actor,
            accept: true,
          });
        }

        await this.learn.setRetrospectiveVerdict(em, initiative, epic.id, verdict, actor, false);
        outcome.verdict = verdict;

        return;
      }
      case 'proposal': {
        if (!result.proposal) {
          throw new BadRequestException('The result has no change proposal yet');
        }

        const proposal = await this.learn.createProposal(em, initiative, result.proposal, {
          origin: 'run',
          actor,
          runId: run.id,
          findingIds: run.findingIds,
        });

        outcome.proposalId = proposal.id;

        return;
      }
    }
  }

  private targetEpic(tree: InitiativeTree, run: InitiativeRunEntity): InitiativeWorkItemEntity {
    const epic = tree.items.find((item) => item.id === run.targetWorkItemId);

    if (!epic) {
      throw new ConflictException('The target epic no longer exists');
    }

    return epic;
  }

  /**
   * Items of a slicing result: existing keys update items that have not started (built or done stay as they are),
   * placeholders create new items in order (dependencies by placeholder or key).
   */
  private async applyItems(
    em: EntityManager,
    initiative: InitiativeEntity,
    tree: InitiativeTree,
    items: InitiativeTurnWorkItem[],
    parent: InitiativeWorkItemEntity | null,
    actor: InitiativeActor,
  ): Promise<void> {
    const existingByKey = new Map(tree.items.map((item) => [item.key, item]));
    const creates = items.filter((item) => !existingByKey.has(item.key));

    for (const item of items.filter((candidate) => existingByKey.has(candidate.key))) {
      const row = existingByKey.get(item.key) as InitiativeWorkItemEntity;

      if (isLockedWorkItemStatus(tree.statusById.get(row.id) ?? 'draft') || (parent && row.parentId !== parent.id)) {
        continue;
      }

      await this.workItems.conditionalItemUpdate(em, row.id, undefined, {
        title: item.title,
        ...(item.requirements !== undefined ? { requirements: item.requirements } : {}),
        ...(item.verify !== undefined ? { verify: item.verify } : {}),
        ...(item.doneWhen !== undefined ? { doneWhen: item.doneWhen } : {}),
      });
    }

    if (creates.length > 0) {
      await this.workItems.createItems(em, initiative, creates, parent?.id ?? null, actor);
    }
  }

  // --- orchestrator helpers ---------------------------------------------------------------------------------------

  async appendTurn(
    em: EntityManager,
    run: Pick<InitiativeRunEntity, 'id' | 'initiativeId' | 'clientId'>,
    role: InitiativeRunTurnRole,
    content: string,
    actorUserId: string | null,
  ): Promise<InitiativeRunTurnEntity> {
    const repo = em.getRepository(InitiativeRunTurnEntity);
    const last = await repo.findOne({ where: { runId: run.id }, order: { seq: 'DESC' }, select: ['id', 'seq'] });
    const row = await repo.save(
      repo.create({
        runId: run.id,
        seq: (last?.seq ?? 0) + 1,
        role,
        content: content.slice(0, INITIATIVE_LIMITS.contentMaxLength),
        actorUserId,
      }),
    );

    afterCommit(em, () =>
      this.initiatives.emit(run.clientId, INITIATIVES_BOARD_EVENTS.initiativeRunTurnAppended, {
        initiativeId: run.initiativeId,
        ...initiativeRunTurnToDto(row),
      }),
    );

    return row;
  }

  /** Conditional status transition (409 when the run is in another state or changed meanwhile). */
  async transition(
    em: EntityManager,
    runId: string,
    from: readonly InitiativeRunStatus[],
    patch: Partial<InitiativeRunEntity>,
    expectedVersion?: number,
  ): Promise<void> {
    const query = em
      .createQueryBuilder()
      .update(InitiativeRunEntity)
      .set({ ...patch, version: () => 'version + 1', updatedAt: () => 'now()' })
      .where('id = :runId AND status IN (:...from)', { runId, from: [...from] });

    if (expectedVersion !== undefined) {
      query.andWhere('version = :expectedVersion', { expectedVersion });
    }

    if (!(await query.execute()).affected) {
      throw new ConflictException('The run changed meanwhile (the agent may be answering); load the latest state.');
    }
  }

  emitRun(initiative: Pick<InitiativeEntity, 'clientId'>, run: InitiativeRunEntity): void {
    this.initiatives.emit(initiative.clientId, INITIATIVES_BOARD_EVENTS.initiativeRunUpsert, initiativeRunToDto(run));
  }
}
