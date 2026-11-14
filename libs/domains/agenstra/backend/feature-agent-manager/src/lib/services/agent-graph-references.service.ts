import {
  AGENT_GRAPH_LIMITS,
  type AgentGraphPromptDetail,
  type AgentGraphPromptReference,
  type AgentGraphPromptSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import type { AgentGraphPromptEntity } from '../entities/agent-graph-prompt.entity';
import type { AgentEventEnvelope } from '../providers/agent-events.types';
import { AgentGraphPromptsRepository } from '../repositories/agent-graph-prompts.repository';
import { AgentGraphsRepository } from '../repositories/agent-graphs.repository';
import type { ContextInjectionPayload } from '../types/context-injection.types';
import type { AgentGraphLayerData } from '../utils/agent-graph-builder.utils';
import {
  attachedAgentGraphReferences,
  availableAgentGraphReferences,
  buildAgentGraphReferencesLayer,
  countAgentGraphReferences,
  mergeAgentGraphReferences,
  referencedAgentGraphMountIds,
  summarizeAgentGraphImplicitContext,
  toolCallAgentGraphReferences,
  type AgentGraphImplicitContext,
} from '../utils/agent-graph-references.utils';

interface ActiveTurn {
  agentId: string;
  correlationId: string;
  chatSessionId: string | null;
  messageId: string | null;
  origin: AgentGraphPromptSummary['origin'];
  excerpt: string | null;
  startedAt: Date;
  workingDirectory: string;
  mcpServers: string[];
  references: AgentGraphPromptReference[];
  seenToolCalls: Set<string>;
  lastActivity: number;
}

/** Turns without an end signal are dropped after this long (and persisted as they are). */
const ACTIVE_TURN_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ACTIVE_TURNS = 500;
const TRIM_EVERY_WRITES = 25;

export interface AgentGraphTurnStart {
  agentId: string;
  correlationId: string;
  chatSessionId?: string | null;
  origin: AgentGraphPromptSummary['origin'];
  prompt: string;
  workingDirectory: string;
  contextInjection?: ContextInjectionPayload;
}

/**
 * Records, per prompt (turn), which context was attached explicitly, which was available implicitly, and what the
 * turn used or modified (tool calls). Only references are stored (ids, names, paths); never contents, commands or
 * patterns. Records are bounded per environment.
 */
@Injectable()
export class AgentGraphReferencesService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentGraphReferencesService.name);
  private readonly active = new Map<string, ActiveTurn>();
  private readonly turnFinishedListeners = new Set<(agentId: string) => void>();
  private writes = 0;
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly promptsRepository: AgentGraphPromptsRepository,
    private readonly graphsRepository: AgentGraphsRepository,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 10 * 60_000);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  registerTurnFinishedListener(listener: (agentId: string) => void): () => void {
    this.turnFinishedListeners.add(listener);

    return () => this.turnFinishedListeners.delete(listener);
  }

  /** Remember the implicit configuration of an environment (names only), captured whenever its config syncs. */
  async captureImplicitContext(agentId: string, effective: Record<string, unknown>): Promise<void> {
    try {
      await this.graphsRepository.upsert(agentId, { implicitContext: summarizeAgentGraphImplicitContext(effective) });
    } catch (error) {
      this.logger.debug(`Implicit context of agent ${agentId} not stored: ${String(error)}`);
    }
  }

  /**
   * Start recording a turn. The turn is registered synchronously (tool events may follow immediately); available
   * references (configuration / instruction files) are added once loaded. Never throws.
   */
  beginTurn(start: AgentGraphTurnStart): void {
    const key = this.key(start.agentId, start.correlationId);
    const turn: ActiveTurn = {
      agentId: start.agentId,
      correlationId: start.correlationId,
      chatSessionId: start.chatSessionId ?? null,
      messageId: null,
      origin: start.origin,
      // Hidden / ephemeral turns (automation, plan sessions) never surface their prompt text; only the references.
      excerpt: start.origin === 'chat' ? excerptOf(start.prompt) : null,
      startedAt: new Date(),
      workingDirectory: start.workingDirectory,
      mcpServers: [],
      references: mergeAgentGraphReferences([], attachedAgentGraphReferences(start.contextInjection)),
      seenToolCalls: new Set(),
      lastActivity: Date.now(),
    };

    if (this.active.size >= MAX_ACTIVE_TURNS) {
      this.sweep(true);
    }

    this.active.set(key, turn);

    void (async () => {
      const row = await this.graphsRepository.findStatus(start.agentId);
      const implicit: AgentGraphImplicitContext | null = row?.implicitContext ?? null;

      turn.mcpServers = implicit?.mcpServers ?? [];
      turn.references = mergeAgentGraphReferences(
        turn.references,
        availableAgentGraphReferences(implicit, row?.instructionFiles ?? []),
      );

      // Only persist the start when the turn is still running (endTurn persists the final state itself).
      if (this.active.get(key) === turn) {
        await this.persist(turn, false);
      }
    })().catch((error: unknown) => {
      this.logger.debug(`Prompt references for agent ${start.agentId} not recorded: ${String(error)}`);
    });
  }

  setMessageId(agentId: string, correlationId: string, messageId: string | undefined): void {
    const turn = this.active.get(this.key(agentId, correlationId));

    if (turn && messageId) {
      turn.messageId = messageId;
    }
  }

  /**
   * Tool calls of the turn → used / modified references (once per tool call id). OpenCode often announces a call
   * before its input is known, so arguments are taken from the first call or result event that carries them.
   */
  recordEvent(agentId: string, event: AgentEventEnvelope): void {
    if (event.kind !== 'toolCall' && event.kind !== 'toolResult') {
      return;
    }

    const turn = this.active.get(this.key(agentId, event.correlationId));

    if (!turn) {
      return;
    }

    const { toolCallId, name } = event.payload;
    const args = (event.payload as { args?: unknown }).args;
    const failed = event.kind === 'toolCall' ? event.payload.status === 'failed' : event.payload.isError === true;

    // Calls announced without input wait for a later event; results without arguments still count the tool itself.
    if (
      failed ||
      !name ||
      !toolCallId ||
      turn.seenToolCalls.has(toolCallId) ||
      (!hasArguments(args) && event.kind === 'toolCall')
    ) {
      return;
    }

    turn.seenToolCalls.add(toolCallId);
    turn.lastActivity = Date.now();
    turn.references = mergeAgentGraphReferences(
      turn.references,
      toolCallAgentGraphReferences(name, hasArguments(args) ? args : {}, {
        workingDirectory: turn.workingDirectory,
        mcpServers: turn.mcpServers,
      }),
    );
  }

  /** Persist the finished turn and notify listeners (graph rebuild signal). Never throws. */
  async endTurn(agentId: string, correlationId: string): Promise<void> {
    const key = this.key(agentId, correlationId);
    const turn = this.active.get(key);

    if (!turn) {
      return;
    }

    this.active.delete(key);

    try {
      await this.persist(turn, true);
      await this.rememberMountReferences(turn);
    } catch (error) {
      this.logger.debug(`Prompt references for agent ${agentId} not persisted: ${String(error)}`);
    }

    for (const listener of this.turnFinishedListeners) {
      try {
        listener(agentId);
      } catch {
        // Listeners must not break the chat flow.
      }
    }
  }

  async list(agentId: string, limit: number): Promise<AgentGraphPromptSummary[]> {
    return (await this.promptsRepository.findLatest(agentId, limit)).map((row) => this.toSummary(row));
  }

  async detail(agentId: string, correlationId: string): Promise<AgentGraphPromptDetail | null> {
    const active = this.active.get(this.key(agentId, correlationId));

    if (active) {
      return { ...this.activeSummary(active), references: active.references };
    }

    const row = await this.promptsRepository.findByCorrelationId(agentId, correlationId);

    return row ? { ...this.toSummary(row), references: row.references } : null;
  }

  async promptsReferencing(agentId: string, ref: string, limit: number): Promise<AgentGraphPromptSummary[]> {
    return (await this.promptsRepository.findReferencing(agentId, ref, limit)).map((row) => this.toSummary(row));
  }

  /** References layer of the latest prompts (including turns still running). */
  async layer(agentId: string, prompts: number): Promise<AgentGraphLayerData> {
    const rows = await this.promptsRepository.findLatest(agentId, prompts);
    const details: AgentGraphPromptDetail[] = rows.map((row) => {
      const active = this.active.get(this.key(agentId, row.correlationId));

      return active
        ? { ...this.activeSummary(active), references: active.references }
        : { ...this.toSummary(row), references: row.references };
    });

    return buildAgentGraphReferencesLayer(details);
  }

  private async persist(turn: ActiveTurn, finished: boolean): Promise<void> {
    await this.promptsRepository.upsert({
      agentId: turn.agentId,
      correlationId: turn.correlationId,
      chatSessionId: turn.chatSessionId,
      messageId: turn.messageId,
      origin: turn.origin,
      excerpt: turn.excerpt,
      startedAt: turn.startedAt,
      finishedAt: finished ? new Date() : null,
      counts: countAgentGraphReferences(turn.references),
      references: turn.references,
    });

    this.writes += 1;

    if (this.writes % TRIM_EVERY_WRITES === 0) {
      await this.promptsRepository.trim(turn.agentId, AGENT_GRAPH_LIMITS.maxPromptRecords);
    }
  }

  /** Environments this one reached through `/opt/workspace/<mount id>` (cross-environment edges). */
  private async rememberMountReferences(turn: ActiveTurn): Promise<void> {
    const mountIds = referencedAgentGraphMountIds(turn.references.map((entry) => entry.path ?? '').filter(Boolean));

    if (mountIds.length === 0) {
      return;
    }

    const row = await this.graphsRepository.findStatus(turn.agentId);
    const merged = [...new Set([...(row?.referencedMountIds ?? []), ...mountIds])].slice(0, 200);

    await this.graphsRepository.upsert(turn.agentId, { referencedMountIds: merged });
  }

  private sweep(force = false): void {
    const now = Date.now();
    const expired = [...this.active.entries()].filter(
      ([, turn]) => force || now - turn.lastActivity > ACTIVE_TURN_TTL_MS,
    );
    // Forced sweeps (map full) only drop the oldest half.
    const victims = force
      ? expired.sort((a, b) => a[1].lastActivity - b[1].lastActivity).slice(0, Math.ceil(expired.length / 2))
      : expired;

    for (const [key, turn] of victims) {
      this.active.delete(key);
      void this.persist(turn, true).catch(() => undefined);
    }
  }

  private key(agentId: string, correlationId: string): string {
    return `${agentId}:${correlationId}`;
  }

  private activeSummary(turn: ActiveTurn): AgentGraphPromptSummary {
    return {
      id: turn.correlationId,
      environmentId: turn.agentId,
      chatSessionId: turn.chatSessionId,
      messageId: turn.messageId,
      origin: turn.origin,
      ...(turn.excerpt ? { excerpt: turn.excerpt } : {}),
      startedAt: turn.startedAt.toISOString(),
      finishedAt: null,
      counts: countAgentGraphReferences(turn.references),
    };
  }

  private toSummary(row: AgentGraphPromptEntity): AgentGraphPromptSummary {
    return {
      id: row.correlationId,
      environmentId: row.agentId,
      chatSessionId: row.chatSessionId,
      messageId: row.messageId,
      origin: row.origin,
      ...(row.excerpt ? { excerpt: row.excerpt } : {}),
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      counts: { attached: 0, available: 0, used: 0, modified: 0, ...(row.counts ?? {}) },
    };
  }
}

function hasArguments(args: unknown): boolean {
  return !!args && typeof args === 'object' && Object.keys(args as object).length > 0;
}

/** First characters of the prompt, without the hidden context block. */
function excerptOf(prompt: string): string | null {
  const visible = prompt
    .replace(/<hidden-context>[\s\S]*?<\/hidden-context>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return visible ? visible.slice(0, AGENT_GRAPH_LIMITS.promptExcerptLength) : null;
}
