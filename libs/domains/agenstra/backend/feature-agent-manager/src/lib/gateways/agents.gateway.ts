import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { BadRequestException, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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
import { isReservedChatResumeSessionSuffix } from '../constants/chat-session.constants';
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
import { AgentChatSessionsService } from '../services/agent-chat-sessions.service';
import { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import { AgentMessageEventsService } from '../services/agent-message-events.service';
import { AgentMessagesService } from '../services/agent-messages.service';
import { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import { OpenCodePtyService } from '../providers/opencode/opencode-pty.service';
import { AgentsService } from '../services/agents.service';
import { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import { WorkspaceChangeNotifierService } from '../services/workspace-change-notifier.service';
import { ContextInjectionPayload } from '../types/context-injection.types';
import { PROMPT_ENHANCEMENT_RESUME_SESSION_SUFFIX } from '../utils/chat-enhancement-prompt.utils';
import { isNonGenericContainerType } from '../utils/context-injection-prompt.utils';
import { finalizeStreamingTranscriptParts } from '../utils/materialize-streaming-deltas-for-transcript';
import { PROMPT_TICKET_BODY_RESUME_SESSION_SUFFIX } from '../utils/ticket-body-prompt.utils';

interface LoginPayload {
  agentId: string;
  password: string;
  /** Restore this session; defaults to primary when omitted. */
  chatId?: string;
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
  /** User-visible chat session id; defaults to primary when omitted (ignored for reserved ACP suffixes). */
  chatId?: string;
  contextInjection?: ContextInjectionPayload;
}

interface RestoreChatPayload {
  chatId: string;
  /** Load messages older than this persisted message id (same chat). Omit for latest page. */
  beforeMessageId?: string;
  /** Page size; default 20, max 50. */
  limit?: number;
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

interface TerminalResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
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
  chatId?: string;
  /** Persisted `agent_messages.id` when available. */
  id?: string;
}

interface AgentChatMessageData {
  from: ChatActor.AGENT;
  response: AgentResponseObject | string; // Parsed JSON object or raw string if parsing fails
  timestamp: string;
  chatId?: string;
  /** Persisted `agent_messages.id` when available. */
  id?: string;
}

type ChatMessageData = UserChatMessageData | AgentChatMessageData;

interface FileUpdateNotificationData {
  socketId: string;
  filePath: string;
  timestamp: string;
  reason?: string;
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
  chatId?: string;
}

interface ChatMessageBatchData {
  chatId: string;
  messages: ChatMessageData[];
  filterResults: MessageFilterResultData[];
  events: AgentEventEnvelope[];
  hasMoreOlder: boolean;
  replace: boolean;
  oldestMessageId: string | null;
}

interface RestoreChatSuccessData {
  chatId: string;
  message: string;
  hasMoreOlder: boolean;
  oldestMessageId: string | null;
  messageCount: number;
}

interface RestoreChatHistoryResult {
  chatId: string;
  hasMoreOlder: boolean;
  oldestMessageId: string | null;
  messageCount: number;
}

const DEFAULT_RESTORE_CHAT_LIMIT = 20;
const MAX_RESTORE_CHAT_LIMIT = 50;

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
@WebSocketGateway({
  namespace: process.env.WEBSOCKET_NAMESPACE || 'socket/agents',
  cors: {
    origin: resolveWebsocketCorsOrigin(),
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
  // Stats broadcasting interval in milliseconds
  private readonly intervalMs = parseInt(process.env.CONTAINER_STATS_SCHEDULER_INTERVAL ?? '15000', 10);

  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly openCodePtyService: OpenCodePtyService,
    private readonly agentMessagesService: AgentMessagesService,
    private readonly agentMessageEventsService: AgentMessageEventsService,
    private readonly agentChatSessionsService: AgentChatSessionsService,
    private readonly agentProviderFactory: AgentProviderFactory,
    private readonly chatFilterFactory: ChatFilterFactory,
    private readonly promptContextComposer: PromptContextComposerService,
    private readonly agentSessionHydrationService: AgentSessionHydrationService,
    private readonly gitStateBroadcast: AgentGitStateBroadcastService,
    private readonly workspaceChangeNotifier: WorkspaceChangeNotifierService,
  ) {}

  onModuleInit(): void {
    this.gitStateBroadcast.registerBroadcaster((agentId) => this.broadcastGitStateChanged(agentId));
    this.workspaceChangeNotifier.registerIndexBroadcaster((agentId, event, data) => {
      this.broadcastToAgent(agentId, event, createSuccessResponse(data));
    });
    this.workspaceChangeNotifier.registerFileUpdateBroadcaster((agentId, data) => {
      this.broadcastToAgent(agentId, 'fileUpdateNotification', createSuccessResponse<FileUpdateNotificationData>(data));
    });
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
      void this.openCodePtyService.closeAll(sessionIds).catch((error) => {
        const err = error as { message?: string };

        this.logger.warn(`Failed to close terminal sessions on disconnect: ${err.message}`);
      });

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

  private broadcastChatEvent(agentUuid: string, event: AgentEventEnvelope, chatSessionId?: string): void {
    this.broadcastToAgent(agentUuid, 'chatEvent', createSuccessResponse<AgentEventEnvelope>(event));
    void this.agentMessageEventsService.persistEvent(agentUuid, event, chatSessionId);

    if (event.kind === 'toolResult' && !event.payload.isError && toolMayMutateGitWorkspace(event.payload.name)) {
      this.gitStateBroadcast.notifyGitStateMayHaveChanged(agentUuid);
      this.workspaceChangeNotifier.notifyRebuildRequired(agentUuid, `tool:${event.payload.name}`);
    }
  }

  /**
   * Persist + broadcast status frames that mark question/permission prompts as answered.
   * Required so reload does not re-offer prompts that were already replied via HTTP
   * (OpenCode does not always emit a durable `*.replied` event for those).
   */
  publishInteractionAnswered(agentId: string, questionIds: string[], message?: string): void {
    const uniqueIds = [...new Set(questionIds.map((id) => id.trim()).filter(Boolean))];

    for (const questionId of uniqueIds) {
      const base = toAgentEventEnvelopeBase(agentId, `interaction-reply-${questionId}`, 0);
      const envelope: AgentEventEnvelope = {
        ...base,
        kind: 'status',
        payload: {
          message: message ?? `Answered ${questionId}`,
          title: 'Answered',
          questionId,
        },
      };

      this.broadcastChatEvent(agentId, envelope);
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

  /**
   * Persist (when not ephemeral) then emit an agent chatMessage, including the entity id when saved.
   */
  private async emitAgentChatMessage(
    agentUuid: string,
    ephemeral: boolean,
    requestSocket: Socket,
    response: AgentResponseObject | string,
    timestamp: string,
    opts: {
      chatSessionId?: string;
      chatIdFields: { chatId?: string };
      filtered?: boolean;
    },
  ): Promise<void> {
    let messageId: string | undefined;

    if (!ephemeral) {
      try {
        const persisted = await this.agentMessagesService.createAgentMessage(
          agentUuid,
          response,
          opts.filtered === true,
          opts.chatSessionId,
        );

        messageId = persisted.id;
      } catch (persistError) {
        const err = persistError as { message?: string };

        this.logger.warn(`Failed to persist agent message: ${err.message}`);
      }
    }

    this.emitChatPayloadToViewers(
      agentUuid,
      ephemeral,
      requestSocket,
      'chatMessage',
      createSuccessResponse<ChatMessageData>({
        ...(messageId ? { id: messageId } : {}),
        from: ChatActor.AGENT,
        response,
        timestamp,
        ...opts.chatIdFields,
      }),
    );
  }

  /**
   * Persist (when not ephemeral) then emit a user chatMessage, including the entity id when saved.
   */
  private async emitUserChatMessage(
    agentUuid: string,
    ephemeral: boolean,
    requestSocket: Socket,
    text: string,
    timestamp: string,
    opts: {
      chatSessionId?: string;
      chatIdFields: { chatId?: string };
      filtered?: boolean;
    },
  ): Promise<void> {
    let messageId: string | undefined;

    if (!ephemeral) {
      try {
        const persisted = await this.agentMessagesService.createUserMessage(
          agentUuid,
          text,
          opts.filtered === true,
          opts.chatSessionId,
        );

        messageId = persisted.id;
      } catch (persistError) {
        const err = persistError as { message?: string };

        this.logger.warn(`Failed to persist user message: ${err.message}`);
      }
    }

    this.emitChatPayloadToViewers(
      agentUuid,
      ephemeral,
      requestSocket,
      'chatMessage',
      createSuccessResponse<ChatMessageData>({
        ...(messageId ? { id: messageId } : {}),
        from: ChatActor.USER,
        text,
        timestamp,
        ...opts.chatIdFields,
      }),
    );
  }

  private emitOrPersistChatEvent(
    agentUuid: string,
    ephemeral: boolean,
    requestSocket: Socket,
    envelope: AgentEventEnvelope,
    chatSessionId?: string,
    chatId?: string,
  ): void {
    const event: AgentEventEnvelope = chatId ? { ...envelope, chatId } : envelope;

    if (ephemeral) {
      requestSocket.emit('chatEvent', createSuccessResponse<AgentEventEnvelope>(event));

      return;
    }

    this.broadcastChatEvent(agentUuid, event, chatSessionId);
  }

  private async resolveChatContext(
    agentId: string,
    data: { chatId?: string; resumeSessionSuffix?: string; ephemeral?: boolean },
  ): Promise<{
    resumeSessionSuffix: string | undefined;
    chatSessionId: string | undefined;
    chatId: string | undefined;
    /** Hidden ACP suffixes must never persist or broadcast into user-visible chats. */
    hidden: boolean;
  }> {
    if (isReservedChatResumeSessionSuffix(data.resumeSessionSuffix)) {
      // Ignore chatId: reserved suffixes are isolated ACP sessions, not user chat rows.
      return {
        resumeSessionSuffix: data.resumeSessionSuffix,
        chatSessionId: undefined,
        chatId: undefined,
        hidden: true,
      };
    }

    const rawChatId = typeof data.chatId === 'string' ? data.chatId.trim() : '';

    if (rawChatId && !AgentsGateway.isUuidV4(rawChatId)) {
      throw new BadRequestException('chatId must be a valid UUID');
    }

    const session = await this.agentChatSessionsService.resolveSessionForChat(agentId, rawChatId || undefined);

    return {
      resumeSessionSuffix: session.resumeSessionSuffix || undefined,
      chatSessionId: session.id,
      chatId: session.id,
      hidden: false,
    };
  }

  private static isUuidV4(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  /**
   * Agent streams emit a final `{ type: "result", ... }` frame when the model finishes, but the
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
      'status',
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
      workspaceContainerType: contextInjection.workspaceContainerType,
      environmentContainerTypes: contextInjection.environmentContainerTypes ?? [],
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
          workspaceContainerType: contextInjection.workspaceContainerType,
          environmentContainerTypes: contextInjection.environmentContainerTypes ?? [],
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
    chatSessionId?: string,
    chatId?: string,
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
        ...(chatId ? { chatId } : {}),
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
        const persisted = await this.agentMessagesService.createAgentMessage(
          agentUuid,
          responseToUse,
          outgoingFilterResult.status === 'filtered',
          chatSessionId,
        );

        this.broadcastToAgent(
          agentUuid,
          'chatMessage',
          createSuccessResponse<ChatMessageData>({
            id: persisted.id,
            from: ChatActor.AGENT,
            response: responseToUse,
            timestamp: agentResponseTimestamp,
            ...(chatId ? { chatId } : {}),
          }),
        );
      } catch (persistError) {
        const err = persistError as { message?: string };

        this.logger.warn(`Failed to persist agent message: ${err.message}`);
        this.broadcastToAgent(
          agentUuid,
          'chatMessage',
          createSuccessResponse<ChatMessageData>({
            from: ChatActor.AGENT,
            response: responseToUse,
            timestamp: agentResponseTimestamp,
            ...(chatId ? { chatId } : {}),
          }),
        );
      }
    }
  }

  /** Agent stream `thinking` frames: derive a short phase string for `chatEvent` payloads. */
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
    const environmentContainerTypes: NonNullable<ContextInjectionPayload['environmentContainerTypes']> = [];
    const needsAgentLookup = includeWorkspace || requestedIds.length > 0;
    const currentAgent = needsAgentLookup ? await this.agentsRepository.findById(agentUuid) : null;

    for (const environmentId of requestedIds) {
      if (environmentId === agentUuid) {
        allowedIds.push(environmentId);

        if (currentAgent && isNonGenericContainerType(currentAgent.containerType)) {
          environmentContainerTypes.push({
            id: environmentId,
            containerType: currentAgent.containerType,
          });
        }

        continue;
      }

      const entity = await this.agentsRepository.findById(environmentId);

      if (entity) {
        allowedIds.push(environmentId);

        if (isNonGenericContainerType(entity.containerType)) {
          environmentContainerTypes.push({
            id: environmentId,
            containerType: entity.containerType,
          });
        }
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

    const workspaceContainerType =
      includeWorkspace && currentAgent && isNonGenericContainerType(currentAgent.containerType)
        ? currentAgent.containerType
        : undefined;

    return {
      includeWorkspace,
      autoEnrichmentEnabled,
      environmentIds: allowedIds,
      ticketShas,
      ticketContexts,
      knowledgeShas,
      knowledgeContexts,
      workspaceContainerType,
      environmentContainerTypes,
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
            ...(response.args !== undefined ? { args: response.args } : {}),
            ...(typeof response.title === 'string' ? { title: response.title } : {}),
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
            ...(typeof response.subtype === 'string' ? { subtype: response.subtype } : {}),
            ...(typeof response.session_id === 'string' ? { sessionId: response.session_id } : {}),
          },
        },
      ];
    }

    if (response.type === 'status') {
      const message =
        typeof response.result === 'string'
          ? response.result
          : typeof response.message === 'string'
            ? response.message
            : '';

      if (message) {
        const title = typeof response.title === 'string' ? response.title : undefined;
        const questionId =
          typeof response.questionId === 'string'
            ? response.questionId
            : typeof response['permissionID'] === 'string'
              ? (response['permissionID'] as string)
              : undefined;

        return [
          {
            ...base,
            kind: 'status',
            payload: {
              message,
              ...(title ? { title } : {}),
              ...(questionId ? { questionId } : {}),
            },
          },
        ];
      }
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

      // Check if socket was already authenticated (e.g., double login on same connection)
      const wasAlreadyAuthenticated = this.authenticatedClients.has(socket.id);
      const wasRecovered = Boolean(socket.recovered);
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

      // Push container status ASAP (do not wait on chat restore) so the console can show
      // start/stop/restart as soon as the environment is selected. Chat restore runs in parallel.
      const restorePromise =
        !wasAlreadyAuthenticated || wasRecovered
          ? this.restoreChatHistory(agentUuid, socket, { chatId: data.chatId }).catch((restoreError: unknown) => {
              const err = restoreError as { message?: string; stack?: string };

              this.logger.warn(
                `Failed to restore chat history for agent ${agentUuid} on login: ${err.message}`,
                err.stack,
              );
            })
          : Promise.resolve().then(() => {
              this.logger.debug(
                `Skipping chat history restoration for agent ${agentUuid} on socket ${socket.id} because socket was already authenticated`,
              );
            });

      await Promise.all([this.startStatsBroadcasting(agentUuid), restorePromise]);
    } catch (error) {
      socket.emit('loginError', createErrorResponse('Invalid credentials', 'LOGIN_ERROR'));
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Login error for agent ${agentId}: ${err.message}`, err.stack);
    }
  }

  /**
   * Restore chat history as a single `chatMessageBatch` for an agent chat session.
   * @param agentUuid - The UUID of the agent
   * @param socket - The socket instance to emit to
   * @param options.chatId - Optional chat session id; defaults to primary
   * @param options.beforeMessageId - When set, load older page (replace=false); omit for latest (replace=true)
   * @param options.limit - Page size (default 20, max 50)
   */
  private async restoreChatHistory(
    agentUuid: string,
    socket: Socket,
    options?: { chatId?: string; beforeMessageId?: string; limit?: number },
  ): Promise<RestoreChatHistoryResult> {
    const session = await this.agentChatSessionsService.resolveSessionForChat(agentUuid, options?.chatId);
    const replace = !options?.beforeMessageId;
    const limit = AgentsGateway.clampRestoreChatLimit(options?.limit);
    const beforeMessageId = options?.beforeMessageId ?? null;

    try {
      const { messages: chatHistory, hasMoreOlder } = await this.agentMessagesService.getChatHistoryPageBefore(
        agentUuid,
        session.id,
        beforeMessageId,
        limit,
      );

      if (chatHistory.length === 0) {
        this.logger.debug(`No chat history found for agent ${agentUuid} chat ${session.id}`);

        // Always emit a batch (even empty) so clients can clear loadingInitial and show empty state.
        socket.emit(
          'chatMessageBatch',
          createSuccessResponse<ChatMessageBatchData>({
            chatId: session.id,
            messages: [],
            filterResults: [],
            events: [],
            hasMoreOlder: false,
            replace,
            oldestMessageId: null,
          }),
        );

        return {
          chatId: session.id,
          hasMoreOlder: false,
          oldestMessageId: null,
          messageCount: 0,
        };
      }

      this.logger.log(`Restoring ${chatHistory.length} messages for agent ${agentUuid} chat ${session.id}`);

      const messages: ChatMessageData[] = [];
      const filterResults: MessageFilterResultData[] = [];

      for (const messageEntity of chatHistory) {
        const timestamp = messageEntity.createdAt.toISOString();

        if (messageEntity.filtered) {
          const direction: 'incoming' | 'outgoing' = messageEntity.actor === 'user' ? 'incoming' : 'outgoing';

          filterResults.push({
            direction,
            status: 'filtered',
            message: messageEntity.message,
            appliedFilters: [],
            matchedFilter: undefined,
            action: 'flag',
            timestamp,
            chatId: session.id,
          });
        }

        if (messageEntity.actor === 'user') {
          messages.push({
            id: messageEntity.id,
            from: ChatActor.USER,
            text: messageEntity.message,
            timestamp,
            chatId: session.id,
          });
        } else if (messageEntity.actor === 'agent') {
          let response: AgentResponseObject | string;

          try {
            response = JSON.parse(messageEntity.message) as AgentResponseObject;
          } catch {
            let toParse = messageEntity.message;
            const firstBrace = toParse.indexOf('{');

            if (firstBrace !== -1) {
              toParse = toParse.slice(firstBrace);
            }

            const lastBrace = toParse.lastIndexOf('}');

            if (lastBrace !== -1) {
              toParse = toParse.slice(0, lastBrace + 1);
            }

            try {
              response = JSON.parse(toParse) as AgentResponseObject;
            } catch {
              response = toParse;
            }
          }

          messages.push({
            id: messageEntity.id,
            from: ChatActor.AGENT,
            response,
            timestamp,
            chatId: session.id,
          });
        }
      }

      const firstCreatedAt = chatHistory[0]?.createdAt;
      const lastCreatedAt = chatHistory[chatHistory.length - 1]?.createdAt;
      const events =
        firstCreatedAt && lastCreatedAt
          ? await this.agentMessageEventsService.listRecentEvents(agentUuid, 400, {
              kinds: ['toolCall', 'toolResult', 'question', 'thinking', 'status'],
              chatSessionId: session.id,
              since: firstCreatedAt,
              until: lastCreatedAt,
            })
          : [];

      const oldestMessageId = chatHistory[0]?.id ?? null;

      socket.emit(
        'chatMessageBatch',
        createSuccessResponse<ChatMessageBatchData>({
          chatId: session.id,
          messages,
          filterResults,
          events: events.map((event) => ({ ...event, chatId: session.id })),
          hasMoreOlder,
          replace,
          oldestMessageId,
        }),
      );

      this.logger.debug(
        `Successfully restored ${chatHistory.length} messages for agent ${agentUuid} chat ${session.id}`,
      );

      return {
        chatId: session.id,
        hasMoreOlder,
        oldestMessageId,
        messageCount: chatHistory.length,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.warn(
        `Failed to restore chat history for agent ${agentUuid} chat ${session.id}: ${err.message}`,
        err.stack,
      );

      // Emit an empty replace batch so clients leave the loading state.
      if (replace) {
        socket.emit(
          'chatMessageBatch',
          createSuccessResponse<ChatMessageBatchData>({
            chatId: session.id,
            messages: [],
            filterResults: [],
            events: [],
            hasMoreOlder: false,
            replace: true,
            oldestMessageId: null,
          }),
        );
      }

      // Don't fail login if history restoration fails after session resolve
      return {
        chatId: session.id,
        hasMoreOlder: false,
        oldestMessageId: null,
        messageCount: 0,
      };
    }
  }

  private static clampRestoreChatLimit(limit?: number): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
      return DEFAULT_RESTORE_CHAT_LIMIT;
    }

    return Math.min(MAX_RESTORE_CHAT_LIMIT, Math.max(1, Math.floor(limit)));
  }

  /**
   * Restore a specific chat session's history for the authenticated client.
   * Client is responsible for clearing the local thread before calling (latest page uses replace=true).
   */
  @SubscribeMessage('restoreChat')
  async handleRestoreChat(@MessageBody() data: RestoreChatPayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    const chatId = typeof data?.chatId === 'string' ? data.chatId.trim() : '';

    if (!chatId) {
      socket.emit('error', createErrorResponse('chatId is required', 'INVALID_PAYLOAD'));

      return;
    }

    if (!AgentsGateway.isUuidV4(chatId)) {
      socket.emit('error', createErrorResponse('chatId must be a valid UUID', 'INVALID_CHAT_ID'));

      return;
    }

    const beforeRaw = typeof data?.beforeMessageId === 'string' ? data.beforeMessageId.trim() : '';
    const beforeMessageId = beforeRaw || undefined;

    if (beforeMessageId && !AgentsGateway.isUuidV4(beforeMessageId)) {
      socket.emit('error', createErrorResponse('beforeMessageId must be a valid UUID', 'INVALID_MESSAGE_ID'));

      return;
    }

    try {
      const result = await this.restoreChatHistory(agentUuid, socket, {
        chatId,
        beforeMessageId,
        limit: data?.limit,
      });

      socket.emit(
        'restoreChatSuccess',
        createSuccessResponse<RestoreChatSuccessData>({
          chatId: result.chatId,
          message: 'Chat history restored',
          hasMoreOlder: result.hasMoreOlder,
          oldestMessageId: result.oldestMessageId,
          messageCount: result.messageCount,
        }),
      );
    } catch (error) {
      socket.emit('error', createErrorResponse('Failed to restore chat history', 'RESTORE_CHAT_ERROR'));
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Restore chat error for agent ${agentUuid}: ${err.message}`, err.stack);
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
    const wantsStream = data.responseMode === 'stream';
    const responseMode: AgentResponseMode = wantsStream ? 'stream' : data.responseMode === 'sync' ? 'sync' : 'single';
    let sequence = 0;
    // Create timestamp immediately for consistent message ordering
    const chatTimestamp = new Date().toISOString();
    let chatContext: Awaited<ReturnType<AgentsGateway['resolveChatContext']>>;

    try {
      chatContext = await this.resolveChatContext(agentUuid, data);
    } catch (error) {
      const err = error as { message?: string };
      const code = error instanceof BadRequestException ? 'INVALID_CHAT_ID' : 'CHAT_ERROR';

      socket.emit('error', createErrorResponse(err.message || 'Invalid or unknown chat session', code));

      return;
    }

    // Reserved ACP suffixes must never persist/broadcast into user-visible chat history.
    const ephemeral = data.ephemeral === true || chatContext.hidden;
    const { chatSessionId, chatId } = chatContext;
    const chatIdFields = chatId ? { chatId } : {};
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
        ...chatIdFields,
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

      await this.emitUserChatMessage(agentUuid, ephemeral, socket, fakeUserMessage, droppedResponseTimestamp, {
        chatSessionId,
        chatIdFields,
        filtered: false,
      });

      this.emitOrPersistChatEvent(
        agentUuid,
        ephemeral,
        socket,
        {
          ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
          kind: 'userMessage',
          payload: { text: fakeUserMessage },
        },
        chatSessionId,
        chatId,
      );

      return;
    }

    // Use modified message if filter provided one, otherwise use original
    const filteredMessage = incomingFilterResult.modifiedMessage ?? message;
    const pendingHydrationSummary = this.agentSessionHydrationService.consumePendingSummary(agentUuid);
    const messageWithHydration = this.prependHiddenHydrationContext(filteredMessage, pendingHydrationSummary);
    const contextInjection = await this.normalizeContextInjection(agentUuid, data.contextInjection);
    const messageToUse = this.promptContextComposer.composeChatMessage(messageWithHydration, contextInjection);
    const enrichmentTranscriptParts = this.buildEnrichmentTranscriptParts(contextInjection, correlationId);

    // Run first-message init before persisting so getChatHistory still sees an empty transcript.
    if (!ephemeral && !this.agentsWithFirstMessageSent.has(agentUuid)) {
      const existingHistory = await this.agentMessagesService.getChatHistory(agentUuid, 1, 0);

      if (existingHistory.length === 0) {
        const entity = await this.agentsRepository.findById(agentUuid);
        const containerId = entity?.containerId;

        if (containerId) {
          try {
            const provider = this.agentProviderFactory.getProvider(entity.agentType || 'opencode');

            await provider.sendInitialization(agentUuid, containerId, { model: data.model });
            this.logger.debug(`Sent initialization message to agent ${agentUuid}`);
          } catch (error) {
            const err = error as { message?: string; stack?: string };

            this.logger.warn(`Failed to send initialization message to agent ${agentUuid}: ${err.message}`, err.stack);
          }
        }
      }

      this.agentsWithFirstMessageSent.add(agentUuid);
    }

    await this.emitUserChatMessage(agentUuid, ephemeral, socket, filteredMessage, chatTimestamp, {
      chatSessionId,
      chatIdFields,
      filtered: incomingFilterResult.status === 'filtered',
    });

    this.emitOrPersistChatEvent(
      agentUuid,
      ephemeral,
      socket,
      {
        ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
        kind: 'userMessage',
        payload: { text: filteredMessage },
      },
      chatSessionId,
      chatId,
    );

    if (contextInjection) {
      this.emitOrPersistChatEvent(
        agentUuid,
        ephemeral,
        socket,
        {
          ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
          kind: 'toolCall',
          payload: {
            toolCallId: `enrichment-${correlationId}`,
            name: 'enrichment',
            args: {
              includeWorkspace: contextInjection.includeWorkspace === true,
              environmentIds: contextInjection.environmentIds ?? [],
              workspaceContainerType: contextInjection.workspaceContainerType,
              environmentContainerTypes: contextInjection.environmentContainerTypes ?? [],
              ticketShas: contextInjection.ticketShas ?? [],
              ticketContextCount: contextInjection.ticketContexts?.length ?? 0,
              knowledgeShas: contextInjection.knowledgeShas ?? [],
              knowledgeContextCount: contextInjection.knowledgeContexts?.length ?? 0,
            },
            status: 'succeeded',
          },
        },
        chatSessionId,
        chatId,
      );
      this.emitOrPersistChatEvent(
        agentUuid,
        ephemeral,
        socket,
        {
          ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
          kind: 'toolResult',
          payload: {
            toolCallId: `enrichment-${correlationId}`,
            name: 'enrichment',
            result: {
              applied: true,
              includeWorkspace: contextInjection.includeWorkspace === true,
              environmentIds: contextInjection.environmentIds ?? [],
              workspaceContainerType: contextInjection.workspaceContainerType,
              environmentContainerTypes: contextInjection.environmentContainerTypes ?? [],
              ticketShas: contextInjection.ticketShas ?? [],
              ticketContextCount: contextInjection.ticketContexts?.length ?? 0,
              knowledgeShas: contextInjection.knowledgeShas ?? [],
              knowledgeContextCount: contextInjection.knowledgeContexts?.length ?? 0,
            },
            isError: false,
          },
        },
        chatSessionId,
        chatId,
      );
    }

    this.emitOrPersistChatEvent(
      agentUuid,
      ephemeral,
      socket,
      {
        ...toAgentEventEnvelopeBase(agentUuid, correlationId, sequence++),
        kind: 'thinking',
        payload: {},
      },
      chatSessionId,
      chatId,
    );

    try {
      // Get agent details for display
      const agent = await this.agentsService.findOne(agentUuid);

      this.logger.log(`Agent ${agent.name} (${agentUuid}) says: ${message}`);

      // Forward message to the agent's container stdin
      // Use modified message if filter provided one
      const entity = await this.agentsRepository.findById(agentUuid);
      const containerId = entity?.containerId;

      if (containerId) {
        // Get the appropriate provider based on agent type
        try {
          const provider = this.agentProviderFactory.getProvider(entity.agentType || 'opencode');
          const supportsStreaming =
            wantsStream &&
            responseMode !== 'sync' &&
            provider.getCapabilities().supportsStreaming &&
            Boolean(provider.streamChatEvents || provider.sendMessageStream);
          const agentResponseTimestamp = new Date().toISOString();

          if (supportsStreaming) {
            let buffered = '';
            let aggregatedText = '';
            const streamedUnified: AgentResponseObject[] = [];
            let streamingTurnPersisted = false;
            const consumeParsedResponse = async (parsed: AgentResponseObject | string): Promise<void> => {
              if (!parsed || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) {
                return;
              }

              if (typeof parsed === 'object') {
                streamedUnified.push(parsed);
              }

              const events = this.agentResponseToChatEvents(agentUuid, correlationId, sequence++, parsed);

              for (const ev of events) {
                if (ev.kind === 'assistantDelta') {
                  aggregatedText += ev.payload.delta;
                } else if (ev.kind === 'assistantMessage') {
                  const text = ev.payload.text;

                  if (typeof text === 'string' && text.length > 0) {
                    aggregatedText = text;
                  }
                }

                this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev, chatSessionId, chatId);
              }

              if (
                !ephemeral &&
                !streamingTurnPersisted &&
                typeof parsed === 'object' &&
                this.isStreamingTerminalUnifiedResponse(parsed)
              ) {
                const built = this.mergeTranscriptPartsIntoFinalResponse(
                  this.buildFinalStreamingResponse(streamedUnified, aggregatedText),
                  enrichmentTranscriptParts,
                );

                if (built) {
                  await this.persistFilteredAgentChatResponse(
                    agentUuid,
                    agentResponseTimestamp,
                    built,
                    chatSessionId,
                    chatId,
                  );
                  streamingTurnPersisted = true;
                }
              }
            };
            const useStructuredStream = Boolean(provider.streamChatEvents);

            if (useStructuredStream) {
              for await (const parsed of provider.streamChatEvents!(agent.id, containerId, messageToUse, {
                model: data.model,
                continue: data.continue,
                resumeSessionSuffix: chatContext.resumeSessionSuffix,
              })) {
                await consumeParsedResponse(parsed);
              }
            } else if (provider.sendMessageStream) {
              const consumeStreamingRawLine = async (rawLine: string): Promise<void> => {
                const parseables = provider.toParseableStrings(rawLine);

                for (const toParse of parseables) {
                  try {
                    const parsed = provider.toUnifiedResponse(toParse);

                    if (!parsed) {
                      continue;
                    }

                    await consumeParsedResponse(parsed);
                  } catch (parseError) {
                    const parseErr = parseError as { message?: string };

                    this.logger.warn(`Failed to parse streaming agent line: ${parseErr.message}`);
                    await consumeParsedResponse(toParse);
                  }
                }
              };

              for await (const chunk of provider.sendMessageStream(agent.id, containerId, messageToUse, {
                model: data.model,
                continue: data.continue,
                resumeSessionSuffix: chatContext.resumeSessionSuffix,
              })) {
                buffered += chunk;
                const parts = buffered.split('\n');

                buffered = parts.pop() ?? '';

                for (const rawLine of parts) {
                  await consumeStreamingRawLine(rawLine);
                }
              }

              if (buffered.trim().length > 0) {
                await consumeStreamingRawLine(buffered);
                buffered = '';
              }
            }

            if (!ephemeral && !streamingTurnPersisted) {
              const finalResponse = this.mergeTranscriptPartsIntoFinalResponse(
                this.buildFinalStreamingResponse(streamedUnified, aggregatedText),
                enrichmentTranscriptParts,
              );

              if (finalResponse) {
                await this.persistFilteredAgentChatResponse(
                  agentUuid,
                  agentResponseTimestamp,
                  finalResponse,
                  chatSessionId,
                  chatId,
                );
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
              resumeSessionSuffix: chatContext.resumeSessionSuffix,
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
                      ...chatIdFields,
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

                    await this.emitAgentChatMessage(
                      agentUuid,
                      ephemeral,
                      socket,
                      fakeAgentResponse,
                      agentResponseTimestamp,
                      { chatSessionId, chatIdFields, filtered: false },
                    );

                    const events = this.agentResponseToChatEvents(
                      agentUuid,
                      correlationId,
                      sequence++,
                      fakeAgentResponse,
                    );

                    for (const ev of events) {
                      this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev, chatSessionId, chatId);
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

                  await this.emitAgentChatMessage(agentUuid, ephemeral, socket, responseToUse, agentResponseTimestamp, {
                    chatSessionId,
                    chatIdFields,
                    filtered: outgoingFilterResult.status === 'filtered',
                  });

                  const events = this.agentResponseToChatEvents(agentUuid, correlationId, sequence++, responseToUse);

                  for (const ev of events) {
                    this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev, chatSessionId, chatId);
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
                      ...chatIdFields,
                    }),
                  );

                  if (outgoingFilterResult.status === 'dropped') {
                    const fakeAgentResponse = {
                      type: 'error',
                      is_error: true,
                      result: 'MESSAGE_DROPPED',
                      message: `Message was dropped by filter: ${outgoingFilterResult.matchedFilter?.reason || 'No reason provided'}`,
                    };

                    await this.emitAgentChatMessage(
                      agentUuid,
                      ephemeral,
                      socket,
                      fakeAgentResponse,
                      agentResponseTimestamp,
                      { chatSessionId, chatIdFields, filtered: false },
                    );

                    const events = this.agentResponseToChatEvents(
                      agentUuid,
                      correlationId,
                      sequence++,
                      fakeAgentResponse,
                    );

                    for (const ev of events) {
                      this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev, chatSessionId, chatId);
                    }

                    return;
                  }

                  const stringResponseToUse = outgoingFilterResult.modifiedMessage ?? toParse;

                  await this.emitAgentChatMessage(
                    agentUuid,
                    ephemeral,
                    socket,
                    stringResponseToUse,
                    agentResponseTimestamp,
                    {
                      chatSessionId,
                      chatIdFields,
                      filtered: outgoingFilterResult.status === 'filtered',
                    },
                  );

                  const events = this.agentResponseToChatEvents(
                    agentUuid,
                    correlationId,
                    sequence++,
                    stringResponseToUse,
                  );

                  for (const ev of events) {
                    this.emitOrPersistChatEvent(agentUuid, ephemeral, socket, ev, chatSessionId, chatId);
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
      const err = error as { message?: string; stack?: string };
      const errorCode = err.message?.includes('permission denied')
        ? 'ACP_PERMISSION_DENIED'
        : err.message?.includes('ACP')
          ? 'ACP_SESSION_FAILED'
          : 'CHAT_ERROR';

      socket.emit('error', createErrorResponse('Error processing chat message', errorCode));

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

      const provider = this.agentProviderFactory.getProvider(entity.agentType || 'opencode');
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

      const provider = this.agentProviderFactory.getProvider(entity.agentType || 'opencode');
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

      const sessionId = data.sessionId || `${socket.id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      let sessions = this.terminalSessionsBySocket.get(socket.id);

      if (!sessions) {
        sessions = new Set<string>();
        this.terminalSessionsBySocket.set(socket.id, sessions);
      }

      sessions.add(sessionId);

      try {
        await this.openCodePtyService.open(
          agentUuid,
          containerId,
          sessionId,
          { shell: data.shell?.trim() || undefined },
          {
            onOutput: (output) => {
              if (socket.connected) {
                try {
                  socket.emit('terminalOutput', createSuccessResponse({ sessionId, data: output }));
                } catch (emitError) {
                  this.logger.warn(`Failed to emit terminal output for session ${sessionId}: ${emitError}`);
                }
              }
            },
            onClosed: () => {
              this.notifyTerminalClosed(socket, sessionId);
            },
          },
        );
      } catch (openError) {
        sessions.delete(sessionId);

        if (sessions.size === 0) {
          this.terminalSessionsBySocket.delete(socket.id);
        }

        throw openError;
      }

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
      await this.openCodePtyService.write(sessionId, inputData);
    } catch (error) {
      const err = error as { message?: string };

      if (err.message?.includes('not found')) {
        this.notifyTerminalClosed(socket, sessionId);
      } else {
        socket.emit('error', createErrorResponse('Error sending terminal input', 'TERMINAL_ERROR'));
        this.logger.error(`Terminal input error for session ${sessionId}: ${err.message}`);
      }
    }
  }

  /**
   * Handle terminal resize (cols/rows forwarded to OpenCode PTY).
   */
  @SubscribeMessage('terminalResize')
  async handleTerminalResize(@MessageBody() data: TerminalResizePayload, @ConnectedSocket() socket: Socket) {
    const agentUuid = this.authenticatedClients.get(socket.id);

    if (!agentUuid) {
      socket.emit('error', createErrorResponse('Unauthorized. Please login first.', 'UNAUTHORIZED'));

      return;
    }

    const { sessionId, cols, rows } = data;

    if (!sessionId || !Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
      socket.emit('error', createErrorResponse('sessionId, cols, and rows are required', 'INVALID_PAYLOAD'));

      return;
    }

    const socketSessions = this.terminalSessionsBySocket.get(socket.id);

    if (!socketSessions || !socketSessions.has(sessionId)) {
      socket.emit('error', createErrorResponse('Terminal session not found or access denied', 'TERMINAL_ERROR'));

      return;
    }

    try {
      await this.openCodePtyService.resize(sessionId, cols, rows);
    } catch (error) {
      const err = error as { message?: string };

      socket.emit('error', createErrorResponse('Error resizing terminal session', 'TERMINAL_ERROR'));
      this.logger.error(`Terminal resize error for session ${sessionId}: ${err.message}`);
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
      await this.openCodePtyService.close(sessionId);
      this.notifyTerminalClosed(socket, sessionId);
      this.logger.log(`Closed terminal session ${sessionId} for agent ${agentUuid} on socket ${socket.id}`);
    } catch (error) {
      const err = error as { message?: string };

      if (err.message?.includes('not found')) {
        this.notifyTerminalClosed(socket, sessionId);
      } else {
        socket.emit('error', createErrorResponse('Error closing terminal session', 'TERMINAL_ERROR'));
        this.logger.error(`Terminal close error for session ${sessionId}: ${err.message}`);
      }
    }
  }

  /**
   * Emit terminalClosed once and drop socket session tracking.
   */
  private notifyTerminalClosed(socket: Socket, sessionId: string): void {
    const socketSessions = this.terminalSessionsBySocket.get(socket.id);

    if (!socketSessions?.has(sessionId)) {
      return;
    }

    socketSessions.delete(sessionId);

    if (socketSessions.size === 0) {
      this.terminalSessionsBySocket.delete(socket.id);
    }

    if (socket.connected) {
      try {
        socket.emit('terminalClosed', createSuccessResponse({ sessionId }));
      } catch (emitError) {
        this.logger.warn(`Failed to emit terminal closed for session ${sessionId}: ${emitError}`);
      }
    }
  }

  /**
   * Start periodic stats broadcasting for an agent.
   * Always sends a fresh snapshot immediately (status first, then full stats when running)
   * so newly selected environments update the UI without waiting for the interval or chat restore.
   * @param agentUuid - The UUID of the agent
   */
  private async startStatsBroadcasting(agentUuid: string): Promise<void> {
    // Get agent entity to find container
    const entity = await this.agentsRepository.findById(agentUuid);
    const containerId = entity?.containerId;

    if (!containerId) {
      this.logger.debug(`No container found for agent ${agentUuid}, skipping stats broadcasting`);

      return;
    }

    // Always push a fresh snapshot for this login/selection — even if an interval already exists.
    await this.broadcastContainerStats(agentUuid, containerId, { preferFastStatus: true });

    if (this.statsIntervalsByAgent.has(agentUuid)) {
      this.logger.debug(`Stats broadcasting already active for agent ${agentUuid}; refreshed snapshot only`);

      return;
    }

    // Start stats broadcasting interval
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
    }, this.intervalMs);

    this.statsIntervalsByAgent.set(agentUuid, interval);
    this.logger.debug(`Started stats broadcasting for agent ${agentUuid}`);
  }

  /**
   * Broadcast container status and stats to all clients authenticated to an agent.
   * Always sends container status (running/stopped). Stats are included only when the container is running.
   * @param agentUuid - The UUID of the agent
   * @param containerId - The container ID
   * @param options.preferFastStatus - Emit status immediately, then enrich with Docker stats when running
   */
  private async broadcastContainerStats(
    agentUuid: string,
    containerId: string,
    options?: { preferFastStatus?: boolean },
  ): Promise<void> {
    try {
      const status = await this.dockerService.getContainerStatus(containerId);
      const statsTimestamp = new Date().toISOString();
      const preferFastStatus = options?.preferFastStatus === true;

      if (preferFastStatus) {
        // Status alone is enough for start/stop/restart controls — do not wait on Docker stats.
        this.broadcastToAgent(
          agentUuid,
          'containerStats',
          createSuccessResponse({
            agentId: agentUuid,
            status,
            stats: null,
            timestamp: statsTimestamp,
          }),
        );

        if (!status.running) {
          return;
        }
      }

      let stats: Awaited<ReturnType<DockerService['getContainerStats']>> | null = null;

      if (status.running) {
        try {
          stats = await this.dockerService.getContainerStats(containerId);
        } catch (statsError) {
          const err = statsError as { message?: string; stack?: string };

          this.logger.warn(`Failed to get container stats for agent ${agentUuid}: ${err.message}`, err.stack);

          if (preferFastStatus) {
            // Status-only snapshot already sent; avoid a second empty payload.
            return;
          }
        }
      }

      this.broadcastToAgent(
        agentUuid,
        'containerStats',
        createSuccessResponse({
          agentId: agentUuid,
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
