import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import { GIT_STATE_CHANGED_EVENT, toolMayMutateGitWorkspace } from '../constants/agent-git-state.constants';
import { AgentEventEnvelope, AgentInteractionQueryPayload, AgentResponseMode } from '../providers/agent-events.types';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentResponseObject } from '../providers/agent-provider.interface';
import { ChatFilterFactory } from '../providers/chat-filter.factory';
import {
  AppliedFilterInfo,
  FilterApplicationResult,
  FilterContext,
  FilterDirection,
} from '../providers/chat-filter.interface';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import { AgentMessageEventsService } from '../services/agent-message-events.service';
import { AgentMessagesService } from '../services/agent-messages.service';
import { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import { AgentsService } from '../services/agents.service';
import { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import { PROMPT_ENHANCEMENT_RESUME_SESSION_SUFFIX } from '../utils/chat-enhancement-prompt.utils';
import { finalizeStreamingTranscriptParts } from '../utils/materialize-streaming-deltas-for-transcript';
import { PROMPT_TICKET_BODY_RESUME_SESSION_SUFFIX } from '../utils/ticket-body-prompt.utils';

interface LoginPayload {
  agentId: string;
  password: string;
}

interface ChatPayload {
  model?: string;
  message: string;
  correlationId?: string;
  responseMode?: AgentResponseMode;
  /** When true, do not persist user/agent rows in `agent_messages` (background / autonomous runs). */
  ephemeral?: boolean;
  continue?: boolean;
  resumeSessionSuffix?: string;
  contextInjection?: ContextInjectionPayload;
}

interface EnhanceChatPayload {
  model?: string;
  message: string;
  correlationId: string;
  contextInjection?: ContextInjectionPayload;
}

interface GenerateTicketBodyPayload {
  model?: string;
  title: string;
  correlationId: string;
  /** Parent chain + subtasks (plain text), same convention as ticket prototype prompts. */
  hierarchyContext?: string;
  contextInjection?: ContextInjectionPayload;
}

interface ContextInjectionPayload {
  includeWorkspace?: boolean;
  environmentIds?: string[];
  ticketShas?: string[];
  ticketContexts?: string[];
  knowledgeShas?: string[];
  knowledgeContexts?: string[];
  autoEnrichmentEnabled?: boolean;
}

interface ChatEnhanceSuccessData {
  correlationId: string;
  success: true;
  enhancedText: string;
}

interface ChatEnhanceFailureData {
  correlationId: string;
  success: false;
  error: { message: string; code?: string; details?: string };
}

interface FileUpdatePayload {
  filePath: string;
}

interface GitStateChangedData {
  agentId: string;
  timestamp: string;
}

interface CreateTerminalPayload {
  sessionId?: string;
  shell?: string;
}

interface TerminalInputPayload {
  sessionId: string;
  data: string;
}

interface CloseTerminalPayload {
  sessionId: string;
}

enum ChatActor {
  AGENT = 'agent',
  USER = 'user',
}

/**
 * Standardized WebSocket response interfaces following best practices.
 * All responses include a timestamp for debugging and traceability.
 */

interface BaseResponse {
  timestamp: string;
}

interface SuccessResponse<T = unknown> extends BaseResponse {
  success: true;
  data: T;
}

interface ErrorResponse extends BaseResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: string;
  };
}

// Specific response types
interface LoginSuccessData {
  message: string;
  agentId: string;
  agentName: string;
}

interface LogoutSuccessData {
  message: string;
  agentId: string | null;
  agentName: string | null;
}

interface UserChatMessageData {
  from: ChatActor.USER;
  text: string;
  timestamp: string;
}

interface AgentChatMessageData {
  from: ChatActor.AGENT;
  response: AgentResponseObject | string; // Parsed JSON object or raw string if parsing fails
  timestamp: string;
}

type ChatMessageData = UserChatMessageData | AgentChatMessageData;

interface FileUpdateNotificationData {
  socketId: string;
  filePath: string;
  timestamp: string;
}

interface MessageFilterResultData {
  direction: 'incoming' | 'outgoing';
  status: 'allowed' | 'filtered' | 'dropped';
  message: string;
  modifiedMessage?: string;
  appliedFilters: Array<{
    type: string;
    displayName: string;
    matched: boolean;
    reason?: string;
  }>;
  matchedFilter?: {
    type: string;
    displayName: string;
    matched: boolean;
    reason?: string;
  };
  action?: 'drop' | 'flag';
  timestamp: string;
}

// Helper functions to create standardized responses
const createSuccessResponse = <T>(data: T): SuccessResponse<T> => ({
  success: true,
  data,
  timestamp: new Date().toISOString(),
});
const createErrorResponse = (message: string, code?: string, details?: string): ErrorResponse => ({
  success: false,
  error: {
    message,
    ...(code && { code }),
    ...(details && { details }),
  },
  timestamp: new Date().toISOString(),
});

function toAgentEventEnvelopeBase(
  agentId: string,
  correlationId: string,
  sequence: number,
): Omit<AgentEventEnvelope, 'kind' | 'payload'> {
  return {
    eventId: uuidv4(),
    agentId,
    correlationId,
    sequence,
    timestamp: new Date().toISOString(),
  };
}

/**
 * WebSocket gateway for agent chat functionality.
 * Handles WebSocket connections, authentication, and chat message broadcasting.
 * Authenticates sessions exclusively against the database-backed agent management system.
 */
@WebSocketGateway(parseInt(process.env.WEBSOCKET_PORT || '8080'), {
  namespace: process.env.WEBSOCKET_NAMESPACE || 'agents',
  cors: {
    origin: process.env.WEBSOCKET_CORS_ORIGIN || '*',
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: parseInt(process.env.SOCKET_MAX_DISCONNECTION_DURATION || '120000'), // 2 minutes default
    skipMiddlewares: true,
  },
})
export class AgentsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AgentsGateway.name);

  // Store authenticated agents by socket.id
  // Maps socket.id -> agent UUID
  private authenticatedClients = new Map<string, string>();
  // Store socket references by socket.id for reliable broadcasting
  // Maps socket.id -> Socket instance
  private socketById = new Map<string, Socket>();
  // Store terminal sessions: socket.id + sessionId -> sessionId
  // This ensures terminal sessions are client-specific (socket.id based)
  private terminalSessionsBySocket = new Map<string, Set<string>>();
  // Track agents that have received their first initialization message
  // Maps agent UUID -> boolean (true if initialization message was sent)
  private agentsWithFirstMessageSent = new Set<string>();
  // Track stats intervals per agent UUID
  // Maps agent UUID -> NodeJS.Timeout
  private statsIntervalsByAgent = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly agentMessagesService: AgentMessagesService,
    private readonly agentMessageEventsService: AgentMessageEventsService,
    private readonly agentProviderFactory: AgentProviderFactory,
    private readonly chatFilterFactory: ChatFilterFactory,
    private readonly promptContextComposer: PromptContextComposerService,
    private readonly agentSessionHydrationService: AgentSessionHydrationService,
    private readonly gitStateBroadcast: AgentGitStateBroadcastService,
  ) {}

  onModuleInit(): void {
    this.gitStateBroadcast.registerBroadcaster((agentId) => this.broadcastGitStateChanged(agentId));
  }

  /**
   * Handle client connection.
   * @param socket - The connected socket instance
   */
  handleConnection(socket: Socket) {
    if (socket.recovered) {
      this.logger.log(`Client reconnected with state recovery: ${socket.id}`);
    } else {
      this.logger.log(`Client connected: ${socket.id}`);
    }

    // Store socket reference for reliable broadcasting
    this.socketById.set(socket.id, socket);
  }

  /**
   * Handle client disconnection.
   * Cleans up authenticated session and socket reference.
   * @param socket - The disconnected socket instance
   */
  handleDisconnect(socket: Socket) {
    this.logger.log(`Client disconnected: ${socket.id}`);
    const agentUuid = this.authenticatedClients.get(socket.id);

    this.authenticatedClients.delete(socket.id);
    this.socketById.delete(socket.id);
    // Clean up all terminal sessions for this socket
    const sessionIds = this.terminalSessionsBySocket.get(socket.id);

    if (sessionIds) {
      for (const sessionId of sessionIds) {
        try {
          this.dockerService.closeTerminalSession(sessionId);
        } catch (error) {
          const err = error as { message?: string };

          this.logger.warn(`Failed to close terminal session ${sessionId} on disconnect: ${err.message}`);
        }
      }

      this.terminalSessionsBySocket.delete(socket.id);
    }

    // Clean up stats interval if this was the last socket for this agent
    if (agentUuid) {
      this.cleanupStatsIntervalIfNeeded(agentUuid);
    }
  }

  /**
   * Find an agent by UUID or name.
   * Attempts UUID lookup first, then falls back to name lookup.
   * @param identifier - Agent UUID or name
   * @returns Agent UUID if found, null otherwise
   */
  private async findAgentIdByIdentifier(identifier: string): Promise<string | null> {
    // Try UUID lookup first
    const agentById = await this.agentsRepository.findById(identifier);

    if (agentById) {
      return agentById.id;
    }

    // Fallback to name lookup
    const agentByName = await this.agentsRepository.findByName(identifier);

    if (agentByName) {
      return agentByName.id;
    }

    return null;
  }

  /**
   * Broadcast a message to all clients authenticated to a specific agent.
   * This ensures agent-specific messages are only sent to clients logged into that agent.
   * @param agentUuid - The UUID of the agent
   * @param event - The event name to emit
   * @param data - The data to send
   */
  private broadcastToAgent(agentUuid: string, event: string, data: unknown): void {
    // Find all socket IDs authenticated to this agent
    const socketIds: string[] = [];

    for (const [socketId, authenticatedAgentUuid] of this.authenticatedClients.entries()) {
      if (authenticatedAgentUuid === agentUuid) {
        socketIds.push(socketId);
      }
    }

    // Emit to each authenticated socket using stored socket references
    let successCount = 0;

    for (const socketId of socketIds) {
      const socket = this.socketById.get(socketId);

      if (socket && socket.connected) {
        try {
          socket.emit(event, data);
          successCount++;
        } catch (emitError) {
          this.logger.warn(`Failed to emit ${event} to socket ${socketId}: ${emitError}`);
          // Remove stale socket reference if emit fails
          this.socketById.delete(socketId);
        }
      } else if (socket && !socket.connected) {
        // Clean up disconnected socket reference
        this.socketById.delete(socketId);
        this.authenticatedClients.delete(socketId);
      }
    }

    if (successCount > 0) {
      this.logger.debug(`Broadcasted ${event} to ${successCount} client(s) for agent ${agentUuid}`);
    }
  }

  private broadcastChatEvent(agentUuid: string, event: AgentEventEnvelope): void {
    this.broadcastToAgent(agentUuid, 'chatEvent', createSuccessResponse<AgentEventEnvelope>(event));
    void this.agentMessageEventsService.persistEvent(agentUuid, event);

    if (event.kind === 'toolResult' && !event.payload.isError && toolMayMutateGitWorkspace(event.payload.name)) {
      this.gitStateBroadcast.notifyGitStateMayHaveChanged(agentUuid);
    }
  }

  private broadcastGitStateChanged(agentUuid: string): void {
    this.broadcastToAgent(
      agentUuid,
      GIT_STATE_CHANGED_EVENT,
      createSuccessResponse<GitStateChangedData>({
        agentId: agentUuid,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  /**
   * Ephemeral chat turns (e.g. autonomous ticket runs) only notify the requesting socket so other
   * sessions on the same agent do not show that traffic in the console chat.
   */
  private emitChatPayloadToViewers(
    agentUuid: string,
    ephemeral: boolean,
    requestSocket: Socket,
    event: string,
    data: unknown,
  ): void {
    if (ephemeral) {
      requestSocket.emit(event, data);

      return;
    }

    this.broadcastToAgent(agentUuid, event, data);
  }

  private emitOrPersistChatEvent(
    agentUuid: string,
    ephemeral: boolean,
    requestSocket: Socket,
    envelope: AgentEventEnvelope,
  ): void {
    if (ephemeral) {
      requestSocket.emit('chatEvent', createSuccessResponse<AgentEventEnvelope>(envelope));

      return;
    }

    this.broadcastChatEvent(agentUuid, envelope);
  }

  /**
   * Cursor stream-json emits a final `{ type: "result", ... }` line when the model finishes, but the
   * Docker exec stream may stay open until the process exits. We persist as soon as we see that frame
   * so `agent_messages` is written even when stdout/stderr have not ended yet.
   */
  private isStreamingTerminalUnifiedResponse(obj: AgentResponseObject): boolean {
    return typeof obj === 'object' && obj !== null && String((obj as { type?: unknown }).type) === 'result';
  }

  private buildFinalStreamingResponse(
    streamedUnified: AgentResponseObject[],
    aggregatedText: string,
  ): AgentResponseObject | null {
    const finalText = aggregatedText.trim();
    const structuredStreamTypes = new Set([
      'tool',
      'tool_call',
      'toolCall',
      'tool_result',
      'toolResult',
      'question',
      'thinking',
      'interaction_query',
      'interactionQuery',
      // Final NDJSON `result` frame must count as structured so delta+result turns become agenstra_turn
      // instead of collapsing to a lone `result` blob that drops tool history.
      'result',
    ]);
    const hasStructuredStreamParts = streamedUnified.some((p) => structuredStreamTypes.has(String(p.type)));

    if (streamedUnified.length > 0 && (hasStructuredStreamParts || !finalText)) {
      const streamEmittedResult = streamedUnified.some((p) => String(p.type) === 'result');
      const parts = finalizeStreamingTranscriptParts(streamedUnified);

      // Keep prior rule: never duplicate the final NDJSON `result` with a synthetic `aggregatedText` blob.
      // After materializing deltas, skip synthetic append when any `result` part exists (from stream or flushes).
      if (finalText && !streamEmittedResult && !parts.some((p) => String(p.type) === 'result')) {
        parts.push({ type: 'result', subtype: 'success', result: finalText });
      }

      const hasCanonicalAnswer = parts.some((p) => String(p.type) === 'result');

      if (hasCanonicalAnswer) {
        return {
          type: 'agenstra_turn',
          subtype: 'success',
          parts: parts.filter((p) => String(p.type) !== 'delta'),
        };
      }

      return { type: 'agenstra_turn', subtype: 'success', parts };
    }

    if (finalText) {
      return { type: 'result', subtype: 'success', result: finalText };
    }

    return null;
  }

  private buildEnrichmentTranscriptParts(
    contextInjection: ContextInjectionPayload | undefined,
    correlationId: string,
  ): AgentResponseObject[] {
    if (!contextInjection) {
      return [];
    }

    const toolCallId = `enrichment-${correlationId}`;
    const enrichmentArgs = {
      includeWorkspace: contextInjection.includeWorkspace === true,
      autoEnrichmentEnabled: contextInjection.autoEnrichmentEnabled !== false,
      environmentIds: contextInjection.environmentIds ?? [],
      ticketShas: contextInjection.ticketShas ?? [],
      ticketContextCount: contextInjection.ticketContexts?.length ?? 0,
      knowledgeShas: contextInjection.knowledgeShas ?? [],
      knowledgeContextCount: contextInjection.knowledgeContexts?.length ?? 0,
    };

    return [
      {
        type: 'tool_call',
        toolCallId,
        name: 'enrichment',
        args: enrichmentArgs,
        status: 'succeeded',
      },
      {
        type: 'tool_result',
        toolCallId,
        name: 'enrichment',
        result: {
          applied: true,
          includeWorkspace: contextInjection.includeWorkspace === true,
          autoEnrichmentEnabled: contextInjection.autoEnrichmentEnabled !== false,
          environmentIds: contextInjection.environmentIds ?? [],
          ticketShas: contextInjection.ticketShas ?? [],
          ticketContextCount: contextInjection.ticketContexts?.length ?? 0,
          knowledgeShas: contextInjection.knowledgeShas ?? [],
          knowledgeContextCount: contextInjection.knowledgeContexts?.length ?? 0,
        },
        isError: false,
      },
    ];
  }

  private mergeTranscriptPartsIntoFinalResponse(
    finalResponse: AgentResponseObject | null,
    prependParts: AgentResponseObject[],
  ): AgentResponseObject | null {
    if (!finalResponse || prependParts.length === 0) {
      return finalResponse;
    }

    if (finalResponse.type === 'agenstra_turn' && Array.isArray(finalResponse.parts)) {
      return {
        ...finalResponse,
        parts: [...prependParts, ...finalResponse.parts],
      };
    }

    return {
      type: 'agenstra_turn',
      subtype: 'success',
      parts: [...prependParts, finalResponse],
    };
  }

  private prependHiddenHydrationContext(message: string, summary?: string): string {
    const trimmedSummary = summary?.trim();

    if (!trimmedSummary) {
      return message;
    }

    return [
      '[SYSTEM INTERNAL - HIDDEN HYDRATION CONTEXT]',
      'The following summary is from the prior session before container recreation.',
      'Use it only as context continuity and do not mention this hydration block to the user.',
      '',
      trimmedSummary,
      '',
      '[END HIDDEN HYDRATION CONTEXT]',
      '',
      message,
    ].join('\n');
  }

  private async persistFilteredAgentChatResponse(
    agentUuid: string,
    agentResponseTimestamp: string,
    finalResponse: AgentResponseObject,
  ): Promise<void> {
    const outgoingFilterResult = await this.applyFilters(JSON.stringify(finalResponse), FilterDirection.OUTGOING, {
      agentId: agentUuid,
      actor: 'agent',
    });

    this.broadcastToAgent(
      agentUuid,
      'messageFilterResult',
      createSuccessResponse<MessageFilterResultData>({
        direction: 'outgoing',
        ...outgoingFilterResult,
      }),
    );

    if (outgoingFilterResult.status !== 'dropped') {
      let responseToUse: AgentResponseObject | string = finalResponse;

      if (outgoingFilterResult.modifiedMessage !== undefined) {
        try {
          responseToUse = JSON.parse(outgoingFilterResult.modifiedMessage);
        } catch {
          responseToUse = outgoingFilterResult.modifiedMessage;
        }
      }

      try {
        await this.agentMessagesService.createAgentMessage(
          agentUuid,
          responseToUse,
          outgoingFilterResult.status === 'filtered',
        );
      } catch (persistError) {
        const err = persistError as { message?: string };

        this.logger.warn(`Failed to persist agent message: ${err.message}`);
      }

      this.broadcastToAgent(
        agentUuid,
        'chatMessage',
        createSuccessResponse<ChatMessageData>({
          from: ChatActor.AGENT,
          response: responseToUse,
          timestamp: agentResponseTimestamp,
        }),
      );
    }
  }

  /** Cursor stream-json `thinking` lines: derive a short phase string for `chatEvent` payloads. */
  private extractThinkingPhaseForChatEvent(response: AgentResponseObject): string | undefined {
    const o = response as Record<string, unknown>;
    const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    let text = pick(o['text']) || pick(o['thinking']) || pick(o['phase']) || pick(o['summary']) || pick(o['message']);

    if (!text) {
      const msg = o['message'];

      if (msg && typeof msg === 'object') {
        const content = (msg as { content?: unknown }).content;

        if (Array.isArray(content)) {
          text = content
            .map((part) => {
              if (!part || typeof part !== 'object') {
                return '';
              }

              const p = part as { type?: unknown; text?: unknown };

              return p.type === 'text' && typeof p.text === 'string' ? p.text : '';
            })
            .join('')
            .trim();
        }
      }
    }

    if (!text) {
      return undefined;
    }

    const collapsed = text.replace(/\s+/g, ' ').trim();

    return collapsed.length <= 120 ? collapsed : `${collapsed.slice(0, 119)}…`;
  }

  private async normalizeContextInjection(
    agentUuid: string,
    contextInjection?: ContextInjectionPayload,
  ): Promise<ContextInjectionPayload | undefined> {
    if (!contextInjection) {
      return undefined;
    }

    const includeWorkspace = contextInjection.includeWorkspace === true;
    const autoEnrichmentEnabled = contextInjection.autoEnrichmentEnabled !== false;
    const requestedIds = Array.from(
      new Set((contextInjection.environmentIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0)),
    );
    const ticketShas = Array.from(
      new Set((contextInjection.ticketShas ?? []).map((sha) => sha.trim()).filter((sha) => sha.length > 0)),
    );
    const ticketContexts = Array.from(
      new Set((contextInjection.ticketContexts ?? []).map((ctx) => ctx.trim()).filter((ctx) => ctx.length > 0)),
    );
    const knowledgeShas = Array.from(
      new Set((contextInjection.knowledgeShas ?? []).map((sha) => sha.trim()).filter((sha) => sha.length > 0)),
    );
    const knowledgeContexts = Array.from(
      new Set((contextInjection.knowledgeContexts ?? []).map((ctx) => ctx.trim()).filter((ctx) => ctx.length > 0)),
    );
    const allowedIds: string[] = [];

    for (const environmentId of requestedIds) {
      if (environmentId === agentUuid) {
        allowedIds.push(environmentId);
        continue;
      }

      const entity = await this.agentsRepository.findById(environmentId);

      if (entity) {
        allowedIds.push(environmentId);
      }
    }

    if (
      !includeWorkspace &&
      !autoEnrichmentEnabled &&
      allowedIds.length === 0 &&
      ticketShas.length === 0 &&
      ticketContexts.length === 0 &&
      knowledgeShas.length === 0 &&
      knowledgeContexts.length === 0
    ) {
      return undefined;
    }

    return {
      includeWorkspace,
      autoEnrichmentEnabled,
      environmentIds: allowedIds,
      ticketShas,
      ticketContexts,
      knowledgeShas,
      knowledgeContexts,
    };
  }

  private agentResponseToChatEvents(
    agentUuid: string,
    correlationId: string,
    sequence: number,
    response: AgentResponseObject | string,
  ): AgentEventEnvelope[] {
    const base = toAgentEventEnvelopeBase(agentUuid, correlationId, sequence);

    if (typeof response === 'string') {
      return [
        {
          ...base,
          kind: 'assistantMessage',
          payload: { text: response },
        },
      ];
    }

    // Heuristic mapping for current providers:
    // - Default: treat `result` as final assistant text.
    // - If provider emits delta-like structures, map to assistantDelta.
    // - Tool calls/questions are mapped opportunistically when common keys are present.
    if (response.type === 'delta' && typeof response.delta === 'string') {
      return [
        {
          ...base,
          kind: 'assistantDelta',
          payload: { delta: response.delta },
        },
      ];
    }

    if (response.type === 'thinking') {
      const phase = this.extractThinkingPhaseForChatEvent(response);

      return [
        {
          ...base,
          kind: 'thinking',
          payload: phase ? { phase } : {},
        },
      ];
    }

    if (response.type === 'interaction_query' || response.type === 'interactionQuery') {
      return [
        {
          ...base,
          kind: 'interactionQuery',
          payload: { ...(response as Record<string, unknown>) } as AgentInteractionQueryPayload,
        },
      ];
    }

    if (
      (response.type === 'tool' || response.type === 'tool_call') &&
      typeof response.name === 'string' &&
      typeof response.toolCallId === 'string'
    ) {
      return [
        {
          ...base,
          kind: 'toolCall',
          payload: {
            toolCallId: response.toolCallId,
            name: response.name,
            args: response.args,
            status: (response.status as 'started' | 'inProgress' | 'succeeded' | 'failed') ?? 'inProgress',
          },
        },
      ];
    }

    if (response.type === 'tool_result' && typeof response.toolCallId === 'string') {
      const name = typeof response.name === 'string' ? response.name : 'tool';

      return [
        {
          ...base,
          kind: 'toolResult',
          payload: {
            toolCallId: response.toolCallId,
            name,
            result: response.result,
            isError: Boolean(response.isError),
          },
        },
      ];
    }

    if (
      response.type === 'question' &&
      typeof response.questionId === 'string' &&
      typeof response.prompt === 'string'
    ) {
      const options = Array.isArray(response.options)
        ? response.options
            .filter((o) => o && typeof o === 'object')
            .map((o) => o as { id?: unknown; label?: unknown })
            .filter((o) => typeof o.id === 'string' && typeof o.label === 'string')
            .map((o) => ({ id: o.id as string, label: o.label as string }))
        : [];

      return [
        {
          ...base,
          kind: 'question',
          payload: {
            questionId: response.questionId,
            prompt: response.prompt,
            options,
            allowMultiple: typeof response.allowMultiple === 'boolean' ? response.allowMultiple : undefined,
          },
        },
      ];
    }

    const text =
      typeof response.result === 'string'
        ? response.result
        : response.result !== undefined && response.result !== null
          ? String(response.result)
          : '';

    return [
      {
        ...base,
        kind: 'assistantMessage',
        payload: { text },
      },
    ];
  }

  /**
   * Handle agent login authentication.
   * Authenticates against database-backed agent management system.
   * @param data - Login payload containing agentId (UUID or name) and password
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('login')
  async handleLogin(@MessageBody() data: LoginPayload, @ConnectedSocket() socket: Socket) {
    const { agentId, password } = data;

    try {
      // Find agent by UUID or name
      const agentUuid = await this.findAgentIdByIdentifier(agentId);

      if (!agentUuid) {
        socket.emit('loginError', createErrorResponse('Invalid credentials', 'INVALID_CREDENTIALS'));
        this.logger.warn(`Failed login attempt: agent not found (${agentId})`);

        return;
      }

      // Verify credentials
      const isValid = await this.agentsService.verifyCredentials(agentUuid, password);

      if (!isValid) {
        socket.emit('loginError', createErrorResponse('Invalid credentials', 'INVALID_CREDENTIALS'));
        this.logger.warn(`Failed login attempt: invalid password for agent ${agentUuid}`);

        return;
      }

      // Check if socket was already authenticated (e.g., via connection state recovery)
      const wasAlreadyAuthenticated = this.authenticatedClients.has(socket.id);
      const wasRecovered = socket.recovered;

      // Store authenticated session
      this.authenticatedClients.set(socket.id, agentUuid);

      // Get agent details for welcome message
      const agent = await this.agentsService.findOne(agentUuid);

      socket.emit(
        'loginSuccess',
        createSuccessResponse<LoginSuccessData>({
          message: `Welcome, ${agent.name}!`,
          agentId: agentUuid,
          agentName: agent.name,
        }),
      );
      this.logger.log(`Agent ${agent.name} (${agentUuid}) authenticated on socket ${socket.id}`);

      // Only restore chat history if:
      // 1. The socket was not recovered (Socket.IO's connection state recovery already restores messages)
      // 2. The socket was not already authenticated (to avoid restoring history twice)
      // This prevents duplicate messages when logging in after reconnection
      if (!wasRecovered && !wasAlreadyAuthenticated) {
        // Restore chat history
        await this.restoreChatHistory(agentUuid, socket);
      } else {
        this.logger.debug(
          `Skipping chat history restoration for agent ${agentUuid} on socket ${socket.id} because socket was ${wasRecovered ? 'recovered' : 'already authenticated'}`,
        );
      }

      // Start periodic stats broadcasting and send first stats immediately
      await this.startStatsBroadcasting(agentUuid);
    } catch (error) {
      socket.emit('loginError', createErrorResponse('Invalid credentials', 'LOGIN_ERROR'));
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Login error for agent ${agentId}: ${err.message}`, err.stack);
    }
  }

  /**
   * Restore and re-emit chat history for an agent.
   * Messages are emitted in chronological order by their creation date.
   * @param agentUuid - The UUID of the agent
   * @param socket - The socket instance to emit messages to
   */
  private async restoreChatHistory(agentUuid: string, socket: Socket): Promise<void> {
    try {
      // Get total message count to calculate offset for latest messages
      const totalCount = await this.agentMessagesService.countMessages(agentUuid);
      const limit = 20;
      // Calculate offset to get the latest 20 messages
      // If totalCount <= 20, offset is 0 (get all messages)
      // Otherwise, offset = totalCount - 20 (skip older messages)
      const offset = Math.max(0, totalCount - limit);
      // Fetch chat history (ordered chronologically by createdAt ASC)
      // Only restore the most recent 20 messages
      const chatHistory = await this.agentMessagesService.getChatHistory(agentUuid, limit, offset);

      if (chatHistory.length === 0) {
        this.logger.debug(`No chat history found for agent ${agentUuid}`);

        return;
      }

      this.logger.log(`Restoring ${chatHistory.length} messages for agent ${agentUuid}`);

      // Emit each message in chronological order
      for (const messageEntity of chatHistory) {
        const timestamp = messageEntity.createdAt.toISOString();

        // If message was filtered, send filter result before the message (maintains chronological order)
        if (messageEntity.filtered) {
          const direction: 'incoming' | 'outgoing' = messageEntity.actor === 'user' ? 'incoming' : 'outgoing';
          // Create a simplified filter result for restored messages
          // We don't have the full filter details, but we know it was flagged (not dropped, since it was persisted)
          const filterResult: MessageFilterResultData = {
            direction,
            status: 'filtered',
            message: messageEntity.message,
            appliedFilters: [], // We don't have historical filter details
            matchedFilter: undefined,
            action: 'flag', // Since it was persisted, it must have been flagged, not dropped
            timestamp,
          };

          socket.emit('messageFilterResult', createSuccessResponse<MessageFilterResultData>(filterResult));
        }

        if (messageEntity.actor === 'user') {
          // User message: emit with text field
          socket.emit(
            'chatMessage',
            createSuccessResponse<ChatMessageData>({
              from: ChatActor.USER,
              text: messageEntity.message,
              timestamp,
            }),
          );
        } else if (messageEntity.actor === 'agent') {
          // Agent message: apply the same cleaning and parsing logic as live communication
          // The stored message might be:
          // 1. A JSON string (from successful parse) - will parse successfully
          // 2. A cleaned string (toParse from failed parse) - might parse now or remain as string
          let toParse = messageEntity.message;
          // Apply the same cleaning logic as in handleChat
          // Remove everything before the first { in the string
          const firstBrace = toParse.indexOf('{');

          if (firstBrace !== -1) {
            toParse = toParse.slice(firstBrace);
          }

          // Remove everything after the last } in the string
          const lastBrace = toParse.lastIndexOf('}');

          if (lastBrace !== -1) {
            toParse = toParse.slice(0, lastBrace + 1);
          }

          let response: AgentResponseObject | string;

          try {
            // Try to parse the cleaned string
            const parsed = JSON.parse(toParse);

            response = parsed;
          } catch {
            // If parsing fails, use the cleaned string (same as live communication)
            response = toParse;
          }

          socket.emit(
            'chatMessage',
            createSuccessResponse<ChatMessageData>({
              from: ChatActor.AGENT,
              response,
              timestamp,
            }),
          );
        }
      }

      // Restore persisted tool events for the same visible history window.
      // This keeps enrichment/tool indicators after reload without duplicating user/assistant chat messages.
      const since = chatHistory[0]?.createdAt;
      const persistedToolEvents = await this.agentMessageEventsService.listRecentEvents(agentUuid, 400, {
        kinds: ['toolCall', 'toolResult'],
        ...(since ? { since } : {}),
      });

      for (const event of persistedToolEvents) {
        socket.emit('chatEvent', createSuccessResponse<AgentEventEnvelope>(event));
      }

      this.logger.debug(`Successfully restored ${chatHistory.length} messages for agent ${agentUuid}`);
    } catch (error) {
      const err = error as { message?: string; stack?: string };

      this.logger.warn(`Failed to restore chat history for agent ${agentUuid}: ${err.message}`, err.stack);
      // Don't fail login if history restoration fails
    }
  }

  /**
   * Handle chat message broadcasting.
   * Only authenticated agents can send messages.
   * @param data - Chat payload containing message text
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('chat')
  async handleChat(@MessageBody() data: ChatPayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    const message = data.message?.trim();

    if (!message) {
      return;
    }

    const correlationId =
      typeof data.correlationId === 'string' && data.correlationId.trim() ? data.correlationId.trim() : uuidv4();
    const ephemeral = data.ephemeral === true;
    const wantsStream = data.responseMode === 'stream';
    const responseMode: AgentResponseMode = wantsStream ? 'stream' : data.responseMode === 'sync' ? 'sync' : 'single';
    let sequence = 0;
    // Create timestamp immediately for consistent message ordering
    const chatTimestamp = new Date().toISOString();
    // Apply incoming filters before processing (single hook point for incoming messages)
    const incomingFilterResult = await this.applyFilters(message, FilterDirection.INCOMING, {
      agentId: agentUuid,
      actor: 'user',
    });

    this.emitChatPayloadToViewers(
      agentUuid,
      ephemeral,
      socket,
      'messageFilterResult',
      createSuccessResponse<MessageFilterResultData>({
        direction: 'incoming',
        ...incomingFilterResult,
      }),
    );

    // If filter says to drop, create fake user message and persist it
    if (incomingFilterResult.status === 'dropped') {
      this.logger.debug(
        `Dropped incoming message for agent ${agentUuid} due to filter: ${incomingFilterResult.matchedFilter?.reason || 'No reason provided'}`,
      );

      // Create fake user message indicating message was dropped
      // This appears on the user side of the chat, not the agent side
      const droppedResponseTimestamp = new Date().toISOString();
      const fakeUserMessage = `Message was dropped by filter: ${incomingFilterResult.matchedFilter?.reason || 'No reason provided'}`;

      if (!ephemeral) {
        try {
          await this.agentMessagesService.createUserMessage(agentUuid, fakeUserMessage, false);
        } catch (persistError) {
          const err = persistError as { message?: string };

          this.logger.warn(`Failed to persist dropped message response: ${err.message}`);
        }
      }

      this.emitChatPayloadToViewers(
        agentUuid,
        ephemeral,
        socket,
        'chatMessage',
        createSuccessResponse<ChatMessageData>({
          from: ChatActor.USER,
          text: fakeUserMessage,
          timestamp: droppedResponseTimestamp,
        }),
      );

      this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, {
        ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
        kind: 'userMessage',
        payload: { text: fakeUserMessage },
      });

      return;
    }

    // Use modified message if filter provided one, otherwise use original
    const filteredMessage = incomingFilterResult.modifiedMessage ?? message;
    const pendingHydrationSummary = this.agentSessionHydrationService.consumePendingSummary(agentUuid);
    const messageWithHydration = this.prependHiddenHydrationContext(filteredMessage, pendingHydrationSummary);
    const contextInjection = await this.normalizeContextInjection(agentUuid, data.contextInjection);
    const messageToUse = this.promptContextComposer.composeChatMessage(messageWithHydration, contextInjection);
    const enrichmentTranscriptParts = this.buildEnrichmentTranscriptParts(contextInjection, correlationId);

    this.emitChatPayloadToViewers(
      agentUuid,
      ephemeral,
      socket,
      'chatMessage',
      createSuccessResponse<ChatMessageData>({
        from: ChatActor.USER,
        text: filteredMessage,
        timestamp: chatTimestamp,
      }),
    );

    this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, {
      ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
      kind: 'userMessage',
      payload: { text: filteredMessage },
    });

    if (contextInjection) {
      this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, {
        ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
        kind: 'toolCall',
        payload: {
          toolCallId: `enrichment-${correlationId}`,
          name: 'enrichment',
          args: {
            includeWorkspace: contextInjection.includeWorkspace === true,
            environmentIds: contextInjection.environmentIds ?? [],
            ticketShas: contextInjection.ticketShas ?? [],
            ticketContextCount: contextInjection.ticketContexts?.length ?? 0,
            knowledgeShas: contextInjection.knowledgeShas ?? [],
            knowledgeContextCount: contextInjection.knowledgeContexts?.length ?? 0,
          },
          status: 'succeeded',
        },
      });
      this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, {
        ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
        kind: 'toolResult',
        payload: {
          toolCallId: `enrichment-${correlationId}`,
          name: 'enrichment',
          result: {
            applied: true,
            includeWorkspace: contextInjection.includeWorkspace === true,
            environmentIds: contextInjection.environmentIds ?? [],
            ticketShas: contextInjection.ticketShas ?? [],
            ticketContextCount: contextInjection.ticketContexts?.length ?? 0,
            knowledgeShas: contextInjection.knowledgeShas ?? [],
            knowledgeContextCount: contextInjection.knowledgeContexts?.length ?? 0,
          },
          isError: false,
        },
      });
    }

    this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, {
      ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
      kind: 'thinking',
      payload: {},
    });

    try {
      // Get agent details for display
      const agent = await this.agentsService.findOne(agentUuid);

      this.logger.log(`Agent ${agent.name} (${agentUuid}) says: ${message}`);

      // Check if this is the first message for this agent
      // Send initialization message if agent has no chat history and hasn't received first message
      if (!this.agentsWithFirstMessageSent.has(agentUuid)) {
        const chatHistory = await this.agentMessagesService.getChatHistory(agentUuid, 1, 0);

        if (chatHistory.length === 0) {
          // This is the first message ever - send dummy initialization message first
          const entity = await this.agentsRepository.findById(agentUuid);
          const containerId = entity?.containerId;

          if (containerId) {
            try {
              // Get the appropriate provider based on agent type
              const provider = this.agentProviderFactory.getProvider(entity.agentType || 'cursor');

              await provider.sendInitialization(agent.id, containerId, { model: data.model });
              this.logger.debug(`Sent initialization message to agent ${agentUuid}`);
            } catch (error) {
              const err = error as { message?: string; stack?: string };

              this.logger.warn(
                `Failed to send initialization message to agent ${agentUuid}: ${err.message}`,
                err.stack,
              );
              // Continue with normal flow even if initialization fails
            }
          }

          // Mark agent as having received first message
          this.agentsWithFirstMessageSent.add(agentUuid);
        } else {
          // Agent has chat history, mark as initialized
          this.agentsWithFirstMessageSent.add(agentUuid);
        }
      }

      // Persist user message (with filtered flag if filter matched)
      // Use modified message if filter provided one
      if (!ephemeral) {
        try {
          await this.agentMessagesService.createUserMessage(
            agentUuid,
            filteredMessage,
            incomingFilterResult.status === 'filtered',
          );
        } catch (persistError) {
          const err = persistError as { message?: string };

          this.logger.warn(`Failed to persist user message: ${err.message}`);
          // Continue with message broadcasting even if persistence fails
        }
      }

      // Forward message to the agent's container stdin
      // Use modified message if filter provided one
      const entity = await this.agentsRepository.findById(agentUuid);
      const containerId = entity?.containerId;

      if (containerId) {
        // Get the appropriate provider based on agent type
        try {
          const provider = this.agentProviderFactory.getProvider(entity.agentType || 'cursor');
          const supportsStreaming =
            wantsStream &&
            responseMode !== 'sync' &&
            provider.getCapabilities().supportsStreaming &&
            provider.sendMessageStream;
          const agentResponseTimestamp = new Date().toISOString();

          if (supportsStreaming) {
            let buffered = '';
            let aggregatedText = '';
            const streamedUnified: AgentResponseObject[] = [];
            let streamingTurnPersisted = false;
            const consumeStreamingRawLine = async (rawLine: string): Promise<void> => {
              const parseables = provider.toParseableStrings(rawLine);

              for (const toParse of parseables) {
                try {
                  const parsed = provider.toUnifiedResponse(toParse);

                  if (!parsed) continue;

                  streamedUnified.push(parsed);
                  const events = this.agentResponseToChatEvents(agentUuid, correlationId, sequence++, parsed);

                  for (const ev of events) {
                    if (ev.kind === 'assistantDelta') {
                      aggregatedText += ev.payload.delta;
                    } else if (ev.kind === 'assistantMessage') {
                      // Full replacement: deltas already built the prose; final `result` NDJSON repeats it.
                      // Multiple `result` lines must not be concatenated or persisted text becomes 2–3× duplicate.
                      const t = ev.payload.text;

                      if (typeof t === 'string' && t.length > 0) {
                        aggregatedText = t;
                      }
                    }

                    this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev);
                  }

                  if (!ephemeral && !streamingTurnPersisted && this.isStreamingTerminalUnifiedResponse(parsed)) {
                    const built = this.mergeTranscriptPartsIntoFinalResponse(
                      this.buildFinalStreamingResponse(streamedUnified, aggregatedText),
                      enrichmentTranscriptParts,
                    );

                    if (built) {
                      await this.persistFilteredAgentChatResponse(agentUuid, agentResponseTimestamp, built);
                      streamingTurnPersisted = true;
                    }
                  }
                } catch (parseError) {
                  const parseErr = parseError as { message?: string };

                  this.logger.warn(`Failed to parse streaming agent line: ${parseErr.message}`);
                  const events = this.agentResponseToChatEvents(agentUuid, correlationId, sequence++, toParse);

                  for (const ev of events) {
                    if (ev.kind === 'assistantDelta') {
                      aggregatedText += ev.payload.delta;
                    } else if (ev.kind === 'assistantMessage') {
                      const t = ev.payload.text;

                      if (typeof t === 'string' && t.length > 0) {
                        aggregatedText = t;
                      }
                    }

                    this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev);
                  }
                }
              }
            };

            for await (const chunk of provider.sendMessageStream(agent.id, containerId, messageToUse, {
              model: data.model,
              continue: data.continue,
              resumeSessionSuffix: data.resumeSessionSuffix,
            })) {
              buffered += chunk;
              const parts = buffered.split('\n');

              buffered = parts.pop() ?? '';

              for (const rawLine of parts) {
                await consumeStreamingRawLine(rawLine);
              }
            }

            // NDJSON producers often omit a trailing newline on the last frame; without this flush,
            // the final line never runs through consumeStreamingRawLine and nothing is persisted.
            if (buffered.trim().length > 0) {
              await consumeStreamingRawLine(buffered);
              buffered = '';
            }

            if (!ephemeral && !streamingTurnPersisted) {
              const finalResponse = this.mergeTranscriptPartsIntoFinalResponse(
                this.buildFinalStreamingResponse(streamedUnified, aggregatedText),
                enrichmentTranscriptParts,
              );

              if (finalResponse) {
                await this.persistFilteredAgentChatResponse(agentUuid, agentResponseTimestamp, finalResponse);
              } else {
                const finalTextLen = aggregatedText.trim().length;

                this.logger.warn(
                  `Streaming completed with no persistable agent response for agent ${agentUuid} ` +
                    `(correlationId=${correlationId}, streamedUnified=${streamedUnified.length}, finalTextLen=${finalTextLen})`,
                );
              }
            }
          } else {
            const agentResponse = await provider.sendMessage(agent.id, containerId, messageToUse, {
              model: data.model,
              continue: data.continue,
              resumeSessionSuffix: data.resumeSessionSuffix,
            });

            if (agentResponse && agentResponse.trim()) {
              const lines = provider.toParseableStrings(agentResponse);

              for (const toParse of lines) {
                try {
                  const parsedResponse = provider.toUnifiedResponse(toParse);

                  if (!parsedResponse) {
                    continue;
                  }

                  const agentResponseString = JSON.stringify(parsedResponse);
                  const outgoingFilterResult = await this.applyFilters(agentResponseString, FilterDirection.OUTGOING, {
                    agentId: agentUuid,
                    actor: 'agent',
                  });

                  this.emitChatPayloadToViewers(
                    agentUuid,
                    ephemeral,
                    socket,
                    'messageFilterResult',
                    createSuccessResponse<MessageFilterResultData>({
                      direction: 'outgoing',
                      ...outgoingFilterResult,
                    }),
                  );

                  if (outgoingFilterResult.status === 'dropped') {
                    this.logger.debug(
                      `Dropped outgoing message for agent ${agentUuid} due to filter: ${outgoingFilterResult.matchedFilter?.reason || 'No reason provided'}`,
                    );

                    const fakeAgentResponse = {
                      type: 'error',
                      is_error: true,
                      result: 'MESSAGE_DROPPED',
                      message: `Message was dropped by filter: ${outgoingFilterResult.matchedFilter?.reason || 'No reason provided'}`,
                    };

                    if (!ephemeral) {
                      try {
                        await this.agentMessagesService.createAgentMessage(agentUuid, fakeAgentResponse, false);
                      } catch (persistError) {
                        const err = persistError as { message?: string };

                        this.logger.warn(`Failed to persist dropped message response: ${err.message}`);
                      }
                    }

                    this.emitChatPayloadToViewers(
                      agentUuid,
                      ephemeral,
                      socket,
                      'chatMessage',
                      createSuccessResponse<ChatMessageData>({
                        from: ChatActor.AGENT,
                        response: fakeAgentResponse,
                        timestamp: agentResponseTimestamp,
                      }),
                    );

                    const events = this.agentResponseToChatEvents(
                      agentUuid,
                      correlationId,
                      sequence++,
                      fakeAgentResponse,
                    );

                    for (const ev of events) {
                      this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev);
                    }

                    return;
                  }

                  let responseToUse: AgentResponseObject | string = parsedResponse;

                  if (outgoingFilterResult.modifiedMessage !== undefined) {
                    try {
                      responseToUse = JSON.parse(outgoingFilterResult.modifiedMessage);
                    } catch {
                      responseToUse = outgoingFilterResult.modifiedMessage;
                    }
                  }

                  if (!ephemeral) {
                    try {
                      await this.agentMessagesService.createAgentMessage(
                        agentUuid,
                        responseToUse,
                        outgoingFilterResult.status === 'filtered',
                      );
                    } catch (persistError) {
                      const err = persistError as { message?: string };

                      this.logger.warn(`Failed to persist agent message: ${err.message}`);
                    }
                  }

                  this.emitChatPayloadToViewers(
                    agentUuid,
                    ephemeral,
                    socket,
                    'chatMessage',
                    createSuccessResponse<ChatMessageData>({
                      from: ChatActor.AGENT,
                      response: responseToUse,
                      timestamp: agentResponseTimestamp,
                    }),
                  );

                  const events = this.agentResponseToChatEvents(agentUuid, correlationId, sequence++, responseToUse);

                  for (const ev of events) {
                    this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev);
                  }
                } catch (parseError) {
                  const parseErr = parseError as { message?: string };

                  this.logger.warn(`Failed to parse agent response as JSON: ${parseErr.message}`);

                  const outgoingFilterResult = await this.applyFilters(toParse, FilterDirection.OUTGOING, {
                    agentId: agentUuid,
                    actor: 'agent',
                  });

                  this.emitChatPayloadToViewers(
                    agentUuid,
                    ephemeral,
                    socket,
                    'messageFilterResult',
                    createSuccessResponse<MessageFilterResultData>({
                      direction: 'outgoing',
                      ...outgoingFilterResult,
                    }),
                  );

                  if (outgoingFilterResult.status === 'dropped') {
                    const fakeAgentResponse = {
                      type: 'error',
                      is_error: true,
                      result: 'MESSAGE_DROPPED',
                      message: `Message was dropped by filter: ${outgoingFilterResult.matchedFilter?.reason || 'No reason provided'}`,
                    };

                    if (!ephemeral) {
                      try {
                        await this.agentMessagesService.createAgentMessage(agentUuid, fakeAgentResponse, false);
                      } catch (persistError) {
                        const err = persistError as { message?: string };

                        this.logger.warn(`Failed to persist dropped message response: ${err.message}`);
                      }
                    }

                    this.emitChatPayloadToViewers(
                      agentUuid,
                      ephemeral,
                      socket,
                      'chatMessage',
                      createSuccessResponse<ChatMessageData>({
                        from: ChatActor.AGENT,
                        response: fakeAgentResponse,
                        timestamp: agentResponseTimestamp,
                      }),
                    );

                    const events = this.agentResponseToChatEvents(
                      agentUuid,
                      correlationId,
                      sequence++,
                      fakeAgentResponse,
                    );

                    for (const ev of events) {
                      this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev);
                    }

                    return;
                  }

                  const stringResponseToUse = outgoingFilterResult.modifiedMessage ?? toParse;

                  if (!ephemeral) {
                    try {
                      await this.agentMessagesService.createAgentMessage(
                        agentUuid,
                        stringResponseToUse,
                        outgoingFilterResult.status === 'filtered',
                      );
                    } catch (persistError) {
                      const err = persistError as { message?: string };

                      this.logger.warn(`Failed to persist agent message: ${err.message}`);
                    }
                  }

                  this.emitChatPayloadToViewers(
                    agentUuid,
                    ephemeral,
                    socket,
                    'chatMessage',
                    createSuccessResponse<ChatMessageData>({
                      from: ChatActor.AGENT,
                      response: stringResponseToUse,
                      timestamp: agentResponseTimestamp,
                    }),
                  );

                  const events = this.agentResponseToChatEvents(
                    agentUuid,
                    correlationId,
                    sequence++,
                    stringResponseToUse,
                  );

                  for (const ev of events) {
                    this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev);
                  }
                }
              }
            }
          }
        } catch (error) {
          const err = error as { message?: string; stack?: string };

          this.logger.error(`Error getting agent response: ${err.message}`, err.stack);
          // Don't fail the chat message, just log the error
        }
      }
    } catch (error) {
      socket.emit('error', createErrorResponse('Error processing chat message', 'CHAT_ERROR'));
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Chat error for agent ${agentUuid}: ${err.message}`, err.stack);
    }
  }

  /**
   * Improve the user's draft prompt in an isolated session (no chat history persistence, unicast result).
   */
  @SubscribeMessage('enhanceChat')
  async handleEnhanceChat(@MessageBody() data: EnhanceChatPayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    const correlationId = typeof data?.correlationId === 'string' ? data.correlationId.trim() : '';
    const message = data?.message?.trim();

    if (!correlationId || !message) {
      socket.emit(
        'chatEnhanceResult',
        createSuccessResponse<ChatEnhanceFailureData>({
          correlationId: correlationId || 'unknown',
          success: false,
          error: { message: 'correlationId and message are required', code: 'INVALID_PAYLOAD' },
        }),
      );

      return;
    }

    const incomingFilterResult = await this.applyFilters(message, FilterDirection.INCOMING, {
      agentId: agentUuid,
      actor: 'user',
    });

    if (incomingFilterResult.status === 'dropped') {
      socket.emit(
        'chatEnhanceResult',
        createSuccessResponse<ChatEnhanceFailureData>({
          correlationId,
          success: false,
          error: {
            message: incomingFilterResult.matchedFilter?.reason || 'Message was dropped by filter',
            code: 'FILTER_DROPPED',
          },
        }),
      );

      return;
    }

    const messageToUse = incomingFilterResult.modifiedMessage ?? message;
    const contextInjection = await this.normalizeContextInjection(agentUuid, data.contextInjection);
    const composed = this.promptContextComposer.composeEnhanceMessage(messageToUse, contextInjection);
    const timeoutMs = parseInt(process.env.CHAT_ENHANCE_TIMEOUT_MS || '120000', 10);
    const runWithTimeout = <T>(promise: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Enhancement timed out')), timeoutMs);

        promise
          .then((value) => {
            clearTimeout(timer);
            resolve(value);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });

    try {
      const agent = await this.agentsService.findOne(agentUuid);
      const entity = await this.agentsRepository.findById(agentUuid);
      const containerId = entity?.containerId;

      if (!containerId) {
        socket.emit(
          'chatEnhanceResult',
          createSuccessResponse<ChatEnhanceFailureData>({
            correlationId,
            success: false,
            error: { message: 'Agent container not available', code: 'NO_CONTAINER' },
          }),
        );

        return;
      }

      const provider = this.agentProviderFactory.getProvider(entity.agentType || 'cursor');
      const rawResponse = await runWithTimeout(
        provider.sendMessage(agent.id, containerId, composed, {
          model: data.model,
          continue: false,
          resumeSessionSuffix: PROMPT_ENHANCEMENT_RESUME_SESSION_SUFFIX,
        }),
      );
      const lines = provider.toParseableStrings(rawResponse);
      let extractedText: string | undefined;

      for (const toParse of lines) {
        try {
          const parsed = provider.toUnifiedResponse(toParse);

          if (!parsed) {
            continue;
          }

          const outgoingFilter = await this.applyFilters(JSON.stringify(parsed), FilterDirection.OUTGOING, {
            agentId: agentUuid,
            actor: 'agent',
          });

          if (outgoingFilter.status === 'dropped') {
            socket.emit(
              'chatEnhanceResult',
              createSuccessResponse<ChatEnhanceFailureData>({
                correlationId,
                success: false,
                error: {
                  message: outgoingFilter.matchedFilter?.reason || 'Enhancement output was dropped by filter',
                  code: 'FILTER_DROPPED',
                },
              }),
            );

            return;
          }

          let useObj: AgentResponseObject | string = parsed;

          if (outgoingFilter.modifiedMessage !== undefined) {
            try {
              useObj = JSON.parse(outgoingFilter.modifiedMessage) as AgentResponseObject;
            } catch {
              useObj = outgoingFilter.modifiedMessage;
            }
          }

          const text =
            typeof useObj === 'object' && useObj !== null && typeof useObj.result === 'string'
              ? useObj.result.trim()
              : typeof useObj === 'string'
                ? useObj.trim()
                : '';

          if (text) {
            extractedText = text;
            break;
          }
        } catch {
          const outgoingFilter = await this.applyFilters(toParse, FilterDirection.OUTGOING, {
            agentId: agentUuid,
            actor: 'agent',
          });

          if (outgoingFilter.status === 'dropped') {
            socket.emit(
              'chatEnhanceResult',
              createSuccessResponse<ChatEnhanceFailureData>({
                correlationId,
                success: false,
                error: {
                  message: outgoingFilter.matchedFilter?.reason || 'Enhancement output was dropped by filter',
                  code: 'FILTER_DROPPED',
                },
              }),
            );

            return;
          }

          const str = (outgoingFilter.modifiedMessage ?? toParse).trim();

          if (str) {
            extractedText = str;
            break;
          }
        }
      }

      if (!extractedText) {
        socket.emit(
          'chatEnhanceResult',
          createSuccessResponse<ChatEnhanceFailureData>({
            correlationId,
            success: false,
            error: { message: 'Could not parse enhancement result from agent', code: 'PARSE_ERROR' },
          }),
        );

        return;
      }

      socket.emit(
        'chatEnhanceResult',
        createSuccessResponse<ChatEnhanceSuccessData>({
          correlationId,
          success: true,
          enhancedText: extractedText,
        }),
      );
    } catch (error) {
      const err = error as { message?: string };

      socket.emit(
        'chatEnhanceResult',
        createSuccessResponse<ChatEnhanceFailureData>({
          correlationId,
          success: false,
          error: {
            message: err.message || 'Enhancement failed',
            code: 'ENHANCE_ERROR',
          },
        }),
      );
    }
  }

  /**
   * Generate ticket body text from title in an isolated session (unicast ticketBodyResult).
   */
  @SubscribeMessage('generateTicketBody')
  async handleGenerateTicketBody(@MessageBody() data: GenerateTicketBodyPayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    const correlationId = typeof data?.correlationId === 'string' ? data.correlationId.trim() : '';
    const title = data?.title?.trim();

    if (!correlationId || !title) {
      socket.emit(
        'ticketBodyResult',
        createSuccessResponse<ChatEnhanceFailureData>({
          correlationId: correlationId || 'unknown',
          success: false,
          error: { message: 'correlationId and title are required', code: 'INVALID_PAYLOAD' },
        }),
      );

      return;
    }

    const incomingFilterResult = await this.applyFilters(title, FilterDirection.INCOMING, {
      agentId: agentUuid,
      actor: 'user',
    });

    if (incomingFilterResult.status === 'dropped') {
      socket.emit(
        'ticketBodyResult',
        createSuccessResponse<ChatEnhanceFailureData>({
          correlationId,
          success: false,
          error: {
            message: incomingFilterResult.matchedFilter?.reason || 'Title was dropped by filter',
            code: 'FILTER_DROPPED',
          },
        }),
      );

      return;
    }

    const titleToUse = incomingFilterResult.modifiedMessage ?? title;
    const hierarchyContext =
      typeof data?.hierarchyContext === 'string' && data.hierarchyContext.trim() !== ''
        ? data.hierarchyContext.trim()
        : undefined;
    const contextInjection = await this.normalizeContextInjection(agentUuid, data.contextInjection);
    const composed = this.promptContextComposer.composeTicketBodyMessage(
      titleToUse,
      hierarchyContext,
      contextInjection,
    );
    const timeoutMs = parseInt(process.env.CHAT_ENHANCE_TIMEOUT_MS || '120000', 10);
    const runWithTimeout = <T>(promise: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Ticket body generation timed out')), timeoutMs);

        promise
          .then((value) => {
            clearTimeout(timer);
            resolve(value);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });

    try {
      const agent = await this.agentsService.findOne(agentUuid);
      const entity = await this.agentsRepository.findById(agentUuid);
      const containerId = entity?.containerId;

      if (!containerId) {
        socket.emit(
          'ticketBodyResult',
          createSuccessResponse<ChatEnhanceFailureData>({
            correlationId,
            success: false,
            error: { message: 'Agent container not available', code: 'NO_CONTAINER' },
          }),
        );

        return;
      }

      const provider = this.agentProviderFactory.getProvider(entity.agentType || 'cursor');
      const rawResponse = await runWithTimeout(
        provider.sendMessage(agent.id, containerId, composed, {
          model: data.model,
          continue: false,
          resumeSessionSuffix: PROMPT_TICKET_BODY_RESUME_SESSION_SUFFIX,
        }),
      );
      const lines = provider.toParseableStrings(rawResponse);
      let extractedText: string | undefined;

      for (const toParse of lines) {
        try {
          const parsed = provider.toUnifiedResponse(toParse);

          if (!parsed) {
            continue;
          }

          const outgoingFilter = await this.applyFilters(JSON.stringify(parsed), FilterDirection.OUTGOING, {
            agentId: agentUuid,
            actor: 'agent',
          });

          if (outgoingFilter.status === 'dropped') {
            socket.emit(
              'ticketBodyResult',
              createSuccessResponse<ChatEnhanceFailureData>({
                correlationId,
                success: false,
                error: {
                  message: outgoingFilter.matchedFilter?.reason || 'Output was dropped by filter',
                  code: 'FILTER_DROPPED',
                },
              }),
            );

            return;
          }

          let useObj: AgentResponseObject | string = parsed;

          if (outgoingFilter.modifiedMessage !== undefined) {
            try {
              useObj = JSON.parse(outgoingFilter.modifiedMessage) as AgentResponseObject;
            } catch {
              useObj = outgoingFilter.modifiedMessage;
            }
          }

          const text =
            typeof useObj === 'object' && useObj !== null && typeof useObj.result === 'string'
              ? useObj.result.trim()
              : typeof useObj === 'string'
                ? useObj.trim()
                : '';

          if (text) {
            extractedText = text;
            break;
          }
        } catch {
          const outgoingFilter = await this.applyFilters(toParse, FilterDirection.OUTGOING, {
            agentId: agentUuid,
            actor: 'agent',
          });

          if (outgoingFilter.status === 'dropped') {
            socket.emit(
              'ticketBodyResult',
              createSuccessResponse<ChatEnhanceFailureData>({
                correlationId,
                success: false,
                error: {
                  message: outgoingFilter.matchedFilter?.reason || 'Output was dropped by filter',
                  code: 'FILTER_DROPPED',
                },
              }),
            );

            return;
          }

          const str = (outgoingFilter.modifiedMessage ?? toParse).trim();

          if (str) {
            extractedText = str;
            break;
          }
        }
      }

      if (!extractedText) {
        socket.emit(
          'ticketBodyResult',
          createSuccessResponse<ChatEnhanceFailureData>({
            correlationId,
            success: false,
            error: { message: 'Could not parse ticket body from agent', code: 'PARSE_ERROR' },
          }),
        );

        return;
      }

      socket.emit(
        'ticketBodyResult',
        createSuccessResponse<ChatEnhanceSuccessData>({
          correlationId,
          success: true,
          enhancedText: extractedText,
        }),
      );
    } catch (error) {
      const err = error as { message?: string };

      socket.emit(
        'ticketBodyResult',
        createSuccessResponse<ChatEnhanceFailureData>({
          correlationId,
          success: false,
          error: {
            message: err.message || 'Ticket body generation failed',
            code: 'TICKET_BODY_ERROR',
          },
        }),
      );
    }
  }

  /**
   * Handle file update notification.
   * Broadcasts file update to all clients authenticated to the same agent.
   * Only authenticated agents can send file updates.
   * @param data - File update payload containing filePath
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('fileUpdate')
  async handleFileUpdate(@MessageBody() data: FileUpdatePayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    const filePath = data?.filePath?.trim();

    // Validate payload
    if (!filePath) {
      socket.emit('error', createErrorResponse('filePath is required', 'INVALID_PAYLOAD'));

      return;
    }

    try {
      // Get agent details for logging
      const agent = await this.agentsService.findOne(agentUuid);

      this.logger.log(`Agent ${agent.name} (${agentUuid}) updated file ${filePath} on socket ${socket.id}`);

      const updateTimestamp = new Date().toISOString();

      // Broadcast file update notification to all clients authenticated to this agent
      // The notification includes the socket ID so clients can determine if the update
      // came from themselves (same socket ID) or another client (different socket ID)
      this.broadcastToAgent(
        agentUuid,
        'fileUpdateNotification',
        createSuccessResponse<FileUpdateNotificationData>({
          socketId: socket.id,
          filePath,
          timestamp: updateTimestamp,
        }),
      );
      this.gitStateBroadcast.notifyGitStateMayHaveChanged(agentUuid);
    } catch (error) {
      socket.emit('error', createErrorResponse('Error processing file update', 'FILE_UPDATE_ERROR'));
      const err = error as { message?: string; stack?: string };

      this.logger.error(`File update error for agent ${agentUuid}: ${err.message}`, err.stack);
    }
  }

  /**
   * Handle agent logout.
   * Removes authenticated session and confirms logout.
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('logout')
  async handleLogout(@ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (agentUuid) {
      // Remove authenticated session
      this.authenticatedClients.delete(socket.id);

      // Clean up stats interval if this was the last socket for this agent
      this.cleanupStatsIntervalIfNeeded(agentUuid);

      try {
        // Get agent details for logging
        const agent = await this.agentsService.findOne(agentUuid);

        this.logger.log(`Agent ${agent.name} (${agentUuid}) logged out from socket ${socket.id}`);

        socket.emit(
          'logoutSuccess',
          createSuccessResponse<LogoutSuccessData>({
            message: 'Logged out successfully',
            agentId: agentUuid,
            agentName: agent.name,
          }),
        );
      } catch (error) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(`Failed to get agent details during logout: ${err.message}`, err.stack);
        // Still emit success since session is already cleared
        socket.emit(
          'logoutSuccess',
          createSuccessResponse<LogoutSuccessData>({
            message: 'Logged out successfully',
            agentId: agentUuid,
            agentName: 'Unknown',
          }),
        );
      }
    } else {
      // Not authenticated, but still acknowledge logout (idempotent)
      socket.emit(
        'logoutSuccess',
        createSuccessResponse<LogoutSuccessData>({
          message: 'Logged out successfully',
          agentId: null,
          agentName: null,
        }),
      );
      this.logger.debug(`Logout requested for unauthenticated socket ${socket.id}`);
    }
  }

  /**
   * Handle terminal session creation.
   * Creates a new TTY session for the authenticated agent's container.
   * Terminal sessions are client-specific (socket.id based).
   * @param data - Create terminal payload containing optional sessionId and shell
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('createTerminal')
  async handleCreateTerminal(@MessageBody() data: CreateTerminalPayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    try {
      // Get agent entity to find container
      const entity = await this.agentsRepository.findById(agentUuid);
      const containerId = entity?.containerId;

      if (!containerId) {
        socket.emit('error', createErrorResponse('Agent container not found', 'TERMINAL_ERROR'));

        return;
      }

      // Generate session ID: socket.id + timestamp to ensure uniqueness
      const sessionId = data.sessionId || `${socket.id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      // Create terminal session
      const stream = await this.dockerService.createTerminalSession(containerId, sessionId, data.shell || 'sh');
      // Track session for this socket
      let sessions = this.terminalSessionsBySocket.get(socket.id);

      if (!sessions) {
        sessions = new Set<string>();
        this.terminalSessionsBySocket.set(socket.id, sessions);
      }

      sessions.add(sessionId);

      // Set up stream data handler to forward output to client
      stream.on('data', (chunk: Buffer) => {
        if (socket.connected) {
          try {
            socket.emit('terminalOutput', createSuccessResponse({ sessionId, data: chunk.toString('utf-8') }));
          } catch (emitError) {
            this.logger.warn(`Failed to emit terminal output for session ${sessionId}: ${emitError}`);
          }
        }
      });

      // Handle stream end/close to notify client
      stream.on('end', () => {
        if (socket.connected) {
          try {
            socket.emit('terminalClosed', createSuccessResponse({ sessionId }));
          } catch (emitError) {
            this.logger.warn(`Failed to emit terminal closed for session ${sessionId}: ${emitError}`);
          }
        }

        // Clean up session tracking
        const socketSessions = this.terminalSessionsBySocket.get(socket.id);

        if (socketSessions) {
          socketSessions.delete(sessionId);

          if (socketSessions.size === 0) {
            this.terminalSessionsBySocket.delete(socket.id);
          }
        }
      });

      stream.on('close', () => {
        if (socket.connected) {
          try {
            socket.emit('terminalClosed', createSuccessResponse({ sessionId }));
          } catch (emitError) {
            this.logger.warn(`Failed to emit terminal closed for session ${sessionId}: ${emitError}`);
          }
        }

        // Clean up session tracking
        const socketSessions = this.terminalSessionsBySocket.get(socket.id);

        if (socketSessions) {
          socketSessions.delete(sessionId);

          if (socketSessions.size === 0) {
            this.terminalSessionsBySocket.delete(socket.id);
          }
        }
      });

      // Emit success response
      socket.emit('terminalCreated', createSuccessResponse({ sessionId }));
      this.logger.log(`Created terminal session ${sessionId} for agent ${agentUuid} on socket ${socket.id}`);
    } catch (error) {
      socket.emit('error', createErrorResponse('Error creating terminal session', 'TERMINAL_ERROR'));
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Terminal creation error for agent ${agentUuid}: ${err.message}`, err.stack);
    }
  }

  /**
   * Handle terminal input.
   * Sends input data to a terminal session.
   * Only the socket that created the session can send input (enforced by sessionId format).
   * @param data - Terminal input payload containing sessionId and data
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('terminalInput')
  async handleTerminalInput(@MessageBody() data: TerminalInputPayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    const { sessionId, data: inputData } = data;

    if (!sessionId || !inputData) {
      socket.emit('error', createErrorResponse('sessionId and data are required', 'INVALID_PAYLOAD'));

      return;
    }

    // Verify session belongs to this socket
    const socketSessions = this.terminalSessionsBySocket.get(socket.id);

    if (!socketSessions || !socketSessions.has(sessionId)) {
      socket.emit('error', createErrorResponse('Terminal session not found or access denied', 'TERMINAL_ERROR'));

      return;
    }

    try {
      await this.dockerService.sendTerminalInput(sessionId, inputData);
    } catch (error) {
      const err = error as { message?: string };

      if (err.message?.includes('not found')) {
        // Session was closed, clean up tracking
        if (socketSessions) {
          socketSessions.delete(sessionId);

          if (socketSessions.size === 0) {
            this.terminalSessionsBySocket.delete(socket.id);
          }
        }

        socket.emit('terminalClosed', createSuccessResponse({ sessionId }));
      } else {
        socket.emit('error', createErrorResponse('Error sending terminal input', 'TERMINAL_ERROR'));
        this.logger.error(`Terminal input error for session ${sessionId}: ${err.message}`);
      }
    }
  }

  /**
   * Handle terminal session closure.
   * Closes a terminal session.
   * Only the socket that created the session can close it (enforced by sessionId format).
   * @param data - Close terminal payload containing sessionId
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('closeTerminal')
  async handleCloseTerminal(@MessageBody() data: CloseTerminalPayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    const { sessionId } = data;

    if (!sessionId) {
      socket.emit('error', createErrorResponse('sessionId is required', 'INVALID_PAYLOAD'));

      return;
    }

    // Verify session belongs to this socket
    const socketSessions = this.terminalSessionsBySocket.get(socket.id);

    if (!socketSessions || !socketSessions.has(sessionId)) {
      socket.emit('error', createErrorResponse('Terminal session not found or access denied', 'TERMINAL_ERROR'));

      return;
    }

    try {
      await this.dockerService.closeTerminalSession(sessionId);
      // Clean up session tracking
      socketSessions.delete(sessionId);

      if (socketSessions.size === 0) {
        this.terminalSessionsBySocket.delete(socket.id);
      }

      socket.emit('terminalClosed', createSuccessResponse({ sessionId }));
      this.logger.log(`Closed terminal session ${sessionId} for agent ${agentUuid} on socket ${socket.id}`);
    } catch (error) {
      const err = error as { message?: string };

      if (err.message?.includes('not found')) {
        // Session already closed, clean up tracking
        if (socketSessions) {
          socketSessions.delete(sessionId);

          if (socketSessions.size === 0) {
            this.terminalSessionsBySocket.delete(socket.id);
          }
        }

        socket.emit('terminalClosed', createSuccessResponse({ sessionId }));
      } else {
        socket.emit('error', createErrorResponse('Error closing terminal session', 'TERMINAL_ERROR'));
        this.logger.error(`Terminal close error for session ${sessionId}: ${err.message}`);
      }
    }
  }

  /**
   * Start periodic stats broadcasting for an agent.
   * Sends the first stats immediately, then continues periodically.
   * @param agentUuid - The UUID of the agent
   */
  private async startStatsBroadcasting(agentUuid: string): Promise<void> {
    // Check if stats interval already exists for this agent
    if (this.statsIntervalsByAgent.has(agentUuid)) {
      this.logger.debug(`Stats broadcasting already active for agent ${agentUuid}`);

      return;
    }

    // Get agent entity to find container
    const entity = await this.agentsRepository.findById(agentUuid);
    const containerId = entity?.containerId;

    if (!containerId) {
      this.logger.debug(`No container found for agent ${agentUuid}, skipping stats broadcasting`);

      return;
    }

    // Send first stats immediately
    await this.broadcastContainerStats(agentUuid, containerId);

    // Set up periodic stats broadcasting (every 5 seconds)
    const interval = setInterval(async () => {
      // Check if agent still has authenticated clients
      const hasAuthenticatedClients = Array.from(this.authenticatedClients.values()).includes(agentUuid);

      if (!hasAuthenticatedClients) {
        // No more authenticated clients, clean up interval
        this.cleanupStatsInterval(agentUuid);

        return;
      }

      try {
        await this.broadcastContainerStats(agentUuid, containerId);
      } catch (error) {
        const err = error as { message?: string };

        this.logger.warn(`Failed to broadcast stats for agent ${agentUuid}: ${err.message}`);
        // Continue broadcasting even if one attempt fails
      }
    }, 5000); // 5 seconds interval

    this.statsIntervalsByAgent.set(agentUuid, interval);
    this.logger.debug(`Started stats broadcasting for agent ${agentUuid}`);
  }

  /**
   * Broadcast container status and stats to all clients authenticated to an agent.
   * Always sends container status (running/stopped). Stats are included only when the container is running.
   * @param agentUuid - The UUID of the agent
   * @param containerId - The container ID
   */
  private async broadcastContainerStats(agentUuid: string, containerId: string): Promise<void> {
    try {
      const status = await this.dockerService.getContainerStatus(containerId);
      const statsTimestamp = new Date().toISOString();
      let stats: Awaited<ReturnType<DockerService['getContainerStats']>> | null = null;

      if (status.running) {
        try {
          stats = await this.dockerService.getContainerStats(containerId);
        } catch (statsError) {
          const err = statsError as { message?: string; stack?: string };

          this.logger.warn(`Failed to get container stats for agent ${agentUuid}: ${err.message}`, err.stack);
        }
      }

      this.broadcastToAgent(
        agentUuid,
        'containerStats',
        createSuccessResponse({
          status,
          stats,
          timestamp: statsTimestamp,
        }),
      );
    } catch (error) {
      const err = error as { message?: string; stack?: string };

      this.logger.warn(`Failed to get container status for agent ${agentUuid}: ${err.message}`, err.stack);
    }
  }

  /**
   * Clean up stats interval for an agent if no more authenticated clients exist.
   * @param agentUuid - The UUID of the agent
   */
  private cleanupStatsIntervalIfNeeded(agentUuid: string): void {
    // Check if there are any authenticated clients for this agent
    const hasAuthenticatedClients = Array.from(this.authenticatedClients.values()).includes(agentUuid);

    if (!hasAuthenticatedClients) {
      this.cleanupStatsInterval(agentUuid);
    }
  }

  /**
   * Clean up stats interval for an agent.
   * @param agentUuid - The UUID of the agent
   */
  private cleanupStatsInterval(agentUuid: string): void {
    const interval = this.statsIntervalsByAgent.get(agentUuid);

    if (interval) {
      clearInterval(interval);
      this.statsIntervalsByAgent.delete(agentUuid);
      this.logger.debug(`Stopped stats broadcasting for agent ${agentUuid}`);
    }
  }

  /**
   * Apply filters to a message based on direction.
   * This is the single hook point for filtering messages.
   * Filters are applied sequentially, and if a filter modifies the message,
   * subsequent filters will receive the modified message.
   * @param message - The message content to filter
   * @param direction - The filter direction (incoming or outgoing)
   * @param context - Optional context about the message
   * @returns Filter application result with all applied filters and final status
   */
  private async applyFilters(
    message: string,
    direction: FilterDirection,
    context?: FilterContext,
  ): Promise<FilterApplicationResult> {
    const filters = this.chatFilterFactory.getFiltersByDirection(direction);
    const appliedFilters: AppliedFilterInfo[] = [];
    let matchedFilter: AppliedFilterInfo | undefined;
    let currentMessage = message; // Track message as it may be modified by filters
    let finalModifiedMessage: string | undefined; // Track the final modified message

    // Apply all applicable filters sequentially
    for (const filter of filters) {
      try {
        const result = await filter.filter(currentMessage, context);
        const filterInfo: AppliedFilterInfo = {
          type: filter.getType(),
          displayName: filter.getDisplayName(),
          matched: result.filtered,
          reason: result.filtered ? result.reason : undefined,
        };

        appliedFilters.push(filterInfo);

        if (result.filtered) {
          // If this is the first filter to match, record it as the matched filter
          if (!matchedFilter) {
            matchedFilter = filterInfo;
          }

          // If filter modified the message, use the modified version for subsequent filters
          if (result.modifiedMessage !== undefined) {
            currentMessage = result.modifiedMessage;
            finalModifiedMessage = result.modifiedMessage; // Track the latest modification
            this.logger.debug(
              `Message modified by ${filter.getType()} (${filter.getDisplayName()}): ${result.reason || 'No reason provided'}`,
            );
          } else {
            this.logger.debug(
              `Message filtered by ${filter.getType()} (${filter.getDisplayName()}): ${result.reason || 'No reason provided'}`,
            );
          }

          // If action is 'drop', stop processing immediately (dropped messages cannot be modified)
          if (result.action === 'drop') {
            return {
              message,
              modifiedMessage: result.modifiedMessage, // Should be undefined for drop
              status: 'dropped',
              appliedFilters,
              matchedFilter,
              action: result.action,
              timestamp: new Date().toISOString(),
            };
          }

          // For 'flag' action, continue processing to allow subsequent filters to modify
          // The final modifiedMessage will be from the last filter that modified it
        }
      } catch (error) {
        const err = error as { message?: string; stack?: string };

        this.logger.warn(`Filter ${filter.getType()} failed: ${err.message}`, err.stack);
        // Record filter as applied but failed
        appliedFilters.push({
          type: filter.getType(),
          displayName: filter.getDisplayName(),
          matched: false,
          reason: `Filter error: ${err.message}`,
        });
        // Continue with other filters even if one fails
      }
    }

    // All filters processed
    // If any filter matched, return filtered status with final modified message
    if (matchedFilter) {
      return {
        message,
        modifiedMessage: finalModifiedMessage, // Final modified message from the last filter that modified it
        status: 'filtered',
        appliedFilters,
        matchedFilter,
        action: 'flag', // All matched filters must have been 'flag' (drop would have returned earlier)
        timestamp: new Date().toISOString(),
      };
    }

    // No filters matched, message is allowed
    return {
      message,
      status: 'allowed',
      appliedFilters,
      timestamp: new Date().toISOString(),
    };
  }
}
