import {
  INITIATIVE_ARTIFACT_TYPE_LABELS,
  buildInitiativeFollowUpPrompt,
  buildInitiativeRepairPrompt,
  buildInitiativeStepPrompt,
  findInitiativeStep,
  parseInitiativeTurnStatusFromText,
  stripInitiativeTurnStatusBlock,
  type InitiativeStepDefinition,
  type InitiativeTurnStatus,
} from '@forepath/agenstra/shared/util-initiative-method';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';

import { InitiativeArtifactEntity } from '../entities/initiative-artifact.entity';
import { InitiativeFindingEntity } from '../entities/initiative-finding.entity';
import { InitiativeRunEntity } from '../entities/initiative-run.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeActionType, InitiativeRunFailureCode } from '../entities/initiative.enums';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';

import { InitiativeContextService } from './initiative-context.service';
import { InitiativeRunsService, type InitiativeRunDriver } from './initiative-runs.service';
import { InitiativesService, INITIATIVE_SYSTEM_ACTOR } from './initiatives.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';

/** Live text of a turn is written at most this often (like chat plan drafts). */
const STREAM_THROTTLE_MS = 400;
/** Streaming text kept for the live view. */
const STREAM_MAX_LENGTH = 20_000;
const REPAIR_ATTEMPTS = 2;
/** An active run without any update for this long is no longer worked on (restart, crashed replica). */
const INTERRUPTED_RUN_STALE_MS = 30 * 60_000;
const INTERRUPTED_RUN_SWEEP_MS = 5 * 60_000;
/** Well below the stale threshold, so a driven turn is always fresh. */
const RUN_HEARTBEAT_MS = 2 * 60_000;

/**
 * Drives step runs in hidden, read-only `-initiative-{runId}` sessions (plan agent + explore-only ruleset on the
 * manager, pre-granted context only, no content changes). Each turn ends with a status block; its normalized content
 * becomes the run's result, which a user accepts on the page.
 */
@Injectable()
export class InitiativeRunOrchestratorService implements InitiativeRunDriver, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InitiativeRunOrchestratorService.name);
  private readonly lastStreamAt = new Map<string, number>();
  private sweepTimer?: NodeJS.Timeout;
  /** Runs whose turn this process is driving right now (never swept, whatever their `updated_at`). */
  private readonly drivenRunIds = new Set<string>();

  constructor(
    @InjectRepository(InitiativeRunEntity)
    private readonly runRepo: Repository<InitiativeRunEntity>,
    @InjectRepository(InitiativeWorkItemEntity)
    private readonly itemRepo: Repository<InitiativeWorkItemEntity>,
    @InjectRepository(InitiativeArtifactEntity)
    private readonly artifactRepo: Repository<InitiativeArtifactEntity>,
    @InjectRepository(InitiativeFindingEntity)
    private readonly findingRepo: Repository<InitiativeFindingEntity>,
    private readonly runs: InitiativeRunsService,
    private readonly initiatives: InitiativesService,
    private readonly context: InitiativeContextService,
    private readonly remoteAgents: RemoteAgentsSessionService,
  ) {}

  onModuleInit(): void {
    this.runs.registerDriver(this);
    // Turns run in this process: after a restart (or a crashed replica) their runs would stay active forever, block
    // the step and count against the workspace limit. Streaming keeps `updated_at` fresh while a turn really works.
    this.sweepTimer = setInterval(() => void this.failInterruptedRuns(), INTERRUPTED_RUN_SWEEP_MS);
    this.sweepTimer.unref?.();
    void this.failInterruptedRuns();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  /** Active runs without any update for a long time failed (retry continues them). Returns how many. */
  async failInterruptedRuns(staleAfterMs = INTERRUPTED_RUN_STALE_MS): Promise<number> {
    try {
      const result = await this.runRepo
        .createQueryBuilder()
        .update(InitiativeRunEntity)
        .set({
          status: 'failed',
          failureCode: 'RUN_INTERRUPTED',
          failureMessage:
            'The run was interrupted (no progress for a long time, e.g. after a restart). Retry continues it.',
          streamingText: null,
          finishedAt: () => 'now()',
          version: () => 'version + 1',
          updatedAt: () => 'now()',
        })
        .where('status IN (:...statuses)', { statuses: ['pending', 'working'] })
        .andWhere('updated_at < :before', { before: new Date(Date.now() - staleAfterMs) })
        .andWhere(this.drivenRunIds.size ? 'id NOT IN (:...driven)' : '1 = 1', { driven: [...this.drivenRunIds] })
        .returning('*')
        .execute();
      const rows = (result.raw ?? []) as Array<Record<string, unknown>>;

      for (const raw of rows) {
        const run = await this.load(String(raw['id']));

        if (run) {
          this.runs.emitRun({ clientId: run.clientId }, run);
        }
      }

      return rows.length;
    } catch (error) {
      this.logger.warn(`Sweeping interrupted initiative runs failed: ${(error as Error).message}`);

      return 0;
    }
  }

  startTurn(runId: string, message: string, firstTurn: boolean): void {
    void this.runTurn(runId, message, firstTurn).catch((error: unknown) => {
      this.logger.warn(`Initiative run ${runId} turn failed: ${(error as Error).message}`);
    });
  }

  private async load(runId: string): Promise<InitiativeRunEntity | null> {
    return await this.runRepo.findOne({ where: { id: runId } });
  }

  private async isClosed(runId: string): Promise<boolean> {
    const run = await this.load(runId);

    return !run || ['cancelled', 'discarded', 'accepted'].includes(run.status);
  }

  private async runTurn(runId: string, message: string, firstTurn: boolean): Promise<void> {
    const run = await this.load(runId);

    if (!run) {
      return;
    }

    const initiative = await this.initiatives.getEntityOrThrow(run.initiativeId);
    const step = findInitiativeStep(run.step) as InitiativeStepDefinition;

    if (firstTurn) {
      // pending → working (follow-up turns were moved to working by the message call).
      await this.runRepo.manager
        .transaction((em) => this.runs.transition(em, run.id, ['pending', 'working'], { status: 'working' }))
        .catch(() => undefined);
    }

    const epic = run.targetWorkItemId ? await this.itemRepo.findOne({ where: { id: run.targetWorkItemId } }) : null;
    const sessionContext = await this.context.buildSessionContext(initiative, {
      artifactIds: run.targetArtifactId ? [run.targetArtifactId] : [],
      epicId: epic?.id ?? null,
    });
    const prompt = firstTurn
      ? buildInitiativeStepPrompt({
          step,
          mode: run.mode,
          style: run.style,
          initiative: {
            title: initiative.title,
            path: initiative.path,
            iteration: initiative.iteration,
            ref: `initiative:${initiative.longSha}`,
          },
          target: await this.describeTarget(run, epic),
          contextRefs: sessionContext.initiativeContextRefs.map((ref) => `${ref.kind}:${ref.sha}`),
          userMessage: await this.firstMessage(run, message),
        })
      : buildInitiativeFollowUpPrompt(message);
    let lastText = '';
    // Heartbeat: a turn can work for a long time without text (tools); keep `updated_at` fresh so the sweep of
    // interrupted runs (other replicas, restarts) never fails a run that is still being driven.
    const heartbeat = setInterval(() => {
      void this.runRepo.update({ id: run.id, status: 'working' }, { updatedAt: new Date() }).catch(() => undefined);
    }, RUN_HEARTBEAT_MS);

    heartbeat.unref?.();
    this.drivenRunIds.add(run.id);

    try {
      for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt++) {
        let streamed = '';
        const result = await this.remoteAgents.sendChatStreaming({
          clientId: run.clientId,
          agentId: run.agentId,
          message: attempt === 0 ? prompt : buildInitiativeRepairPrompt(),
          correlationId: `${run.id}:${attempt === 0 ? 'turn' : 'repair'}:${randomUUID()}`,
          continue: !(firstTurn && attempt === 0),
          resumeSessionSuffix: run.resumeSessionSuffix,
          ephemeral: true,
          model: run.model ?? undefined,
          contextInjection: {
            includeWorkspace: false,
            environmentIds: [run.agentId],
            autoEnrichmentEnabled: false,
            ...sessionContext,
          },
          statisticsInteractionKind: StatisticsInteractionKind.INITIATIVE_RUN_TURN,
          onDeltaText: async (delta) => {
            streamed += delta;
            await this.stream(run.id, run.clientId, streamed);
          },
        });

        if (await this.isClosed(run.id)) {
          return;
        }

        lastText = result.text || streamed;

        const status = parseInitiativeTurnStatusFromText(lastText);

        if (status) {
          await this.applyTurn(run.id, status, lastText);

          return;
        }
      }

      await this.fail(
        run.id,
        InitiativeRunFailureCode.AGENT_NO_STATUS,
        'The agent answered without a usable status block',
        lastText,
      );
    } catch (error) {
      if (await this.isClosed(run.id)) {
        return;
      }

      this.logger.warn(`Initiative run ${run.id}: ${(error as Error).message}`);
      await this.fail(run.id, InitiativeRunFailureCode.AGENT_PROVIDER_ERROR, 'The agent turn failed', lastText);
    } finally {
      clearInterval(heartbeat);
      this.drivenRunIds.delete(run.id);
    }
  }

  private async describeTarget(run: InitiativeRunEntity, epic: InitiativeWorkItemEntity | null) {
    if (epic) {
      return { label: `epic ${epic.key} "${epic.title}"` };
    }

    if (run.targetArtifactId) {
      const artifact = await this.artifactRepo.findOne({ where: { id: run.targetArtifactId } });

      return artifact
        ? {
            label: `${INITIATIVE_ARTIFACT_TYPE_LABELS[artifact.type]} "${artifact.title}" (v${artifact.currentVersion})`,
            ref: `artifact:${artifact.longSha}`,
          }
        : undefined;
    }

    return undefined;
  }

  /** The user's request plus, for correct course, the findings it starts from (as data). */
  private async firstMessage(run: InitiativeRunEntity, message: string): Promise<string | undefined> {
    const findings = run.findingIds?.length
      ? await this.findingRepo.find({ where: { id: In(run.findingIds), initiativeId: run.initiativeId } })
      : [];
    const parts = [message.trim()];

    if (findings.length > 0) {
      parts.push(
        'Findings to address:',
        ...findings.map(
          (finding) =>
            `- [${finding.severity}] ${finding.body.replace(/\n+/g, ' ').slice(0, 2_000)}` +
            `${finding.evidence?.length ? ` (evidence: ${finding.evidence.join(', ')})` : ''}`,
        ),
      );
    }

    const joined = parts.filter(Boolean).join('\n');

    return joined || undefined;
  }

  private async stream(runId: string, clientId: string, text: string): Promise<void> {
    const now = Date.now();

    if (now - (this.lastStreamAt.get(runId) ?? 0) < STREAM_THROTTLE_MS) {
      return;
    }

    this.lastStreamAt.set(runId, now);

    const visible = text.length > STREAM_MAX_LENGTH ? text.slice(text.length - STREAM_MAX_LENGTH) : text;
    const updated = await this.runRepo.update({ id: runId, status: 'working' }, { streamingText: visible });

    if (updated.affected) {
      const run = await this.load(runId);

      if (run) {
        this.runs.emitRun({ clientId }, run);
      }
    }
  }

  /** Store the turn: transcript, merged result, status (needs input / ready). */
  private async applyTurn(runId: string, status: InitiativeTurnStatus, text: string): Promise<void> {
    const current = await this.load(runId);

    if (!current) {
      return;
    }

    const previous = current.result ?? null;
    // Results are complete by protocol; fields a turn omitted keep their previous value (a question turn does not
    // erase the draft the user is reviewing).
    const merged: InitiativeTurnStatus = {
      ...status,
      draftMarkdown: status.draftMarkdown ?? previous?.draftMarkdown,
      workItems: status.workItems.length ? status.workItems : (previous?.workItems ?? []),
      epic: status.epic ?? previous?.epic,
      findings: status.findings.length ? status.findings : (previous?.findings ?? []),
      decisions: status.decisions.length ? status.decisions : (previous?.decisions ?? []),
      verdict: status.verdict ?? previous?.verdict,
      proposal: status.proposal ?? previous?.proposal,
    };
    const runStatus = status.status === 'ready' ? 'ready' : 'needs_input';
    const visible = status.message ?? (stripInitiativeTurnStatusBlock(text) || status.summary || '(no message)');

    await this.runRepo.manager.transaction(async (em) => {
      await this.runs.transition(em, runId, ['working'], { status: runStatus, result: merged, streamingText: null });
      await this.runs.appendTurn(em, current, 'agent', visible, null);
    });
    this.lastStreamAt.delete(runId);

    const run = (await this.load(runId)) as InitiativeRunEntity;

    this.runs.emitRun({ clientId: run.clientId }, run);
    this.initiatives.publish(
      runStatus === 'ready' ? 'initiative.run.ready' : 'initiative.run.needs_input',
      run.clientId,
      {
        initiativeId: run.initiativeId,
        runId: run.id,
        step: run.step,
        summary: status.summary ?? null,
      },
    );
  }

  private async fail(runId: string, code: InitiativeRunFailureCode, message: string, text: string): Promise<void> {
    const run = await this.load(runId);

    if (!run) {
      return;
    }

    try {
      await this.runRepo.manager.transaction(async (em) => {
        await this.runs.transition(em, runId, ['pending', 'working'], {
          status: 'failed',
          failureCode: code,
          failureMessage: message,
          streamingText: null,
          finishedAt: new Date(),
        });

        if (text.trim()) {
          await this.runs.appendTurn(em, run, 'agent', stripInitiativeTurnStatusBlock(text) || text, null);
        }

        await this.initiatives.appendActivity(
          run.initiativeId,
          InitiativeActionType.RUN_FAILED,
          INITIATIVE_SYSTEM_ACTOR,
          { runId, code },
          em,
        );
      });
    } catch {
      return;
    }

    const failed = (await this.load(runId)) as InitiativeRunEntity;

    this.runs.emitRun({ clientId: failed.clientId }, failed);
    this.initiatives.publish('initiative.run.failed', failed.clientId, {
      initiativeId: failed.initiativeId,
      runId,
      step: failed.step,
      code,
    });
  }
}
