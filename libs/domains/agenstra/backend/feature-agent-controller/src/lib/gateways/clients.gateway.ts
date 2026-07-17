import { createCorrelationAwareSocketIoClient } from '@forepath/shared/backend/util-http-context';
import {
  AuthenticationType,
  ClientAgentCredentialsRepository,
  ClientUsersRepository,
  SocketAuthService,
  buildRequestFromSocketUser,
  ensureClientAccess,
} from '@forepath/identity/backend';
import { BadRequestException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { Socket as ClientSocket } from 'socket.io-client';

import { FilterDropDirection } from '../entities/statistics-chat-filter-drop.entity';
import { FilterFlagDirection } from '../entities/statistics-chat-filter-flag.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { ClientsRepository } from '../repositories/clients.repository';
import { AgentConsoleStatusService } from '../services/agent-console-status.service';
import { AutoContextResolverService } from '../services/auto-context-resolver.service';
import { ClientAutomationChatRealtimeService } from '../services/client-automation-chat-realtime.service';
import { ClientWorkspaceConfigurationOverridesProxyService } from '../services/client-workspace-configuration-overrides-proxy.service';
import { ClientsService } from '../services/clients.service';
import { KnowledgeTreeService } from '../services/knowledge-tree.service';
import { StatisticsService } from '../services/statistics.service';
import { TicketAutomationChatSyncService } from '../services/ticket-automation-chat-sync.service';
import { TicketBoardRealtimeService } from '../services/ticket-board-realtime.service';
import { TicketsService } from '../services/tickets.service';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';

interface SetClientPayload {
  clientId: string;
}

interface ForwardPayload {
  event: string;
  payload: unknown;
  agentId?: string;
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

/**
 * WebSocket gateway for client context management.
 * Handles WebSocket connections, authentication, and client context setup.
 * Authenticates sessions exclusively against the database-backed client management system.
 */
@WebSocketGateway(parseInt(process.env.WEBSOCKET_PORT || '8081'), {
  namespace: process.env.WEBSOCKET_NAMESPACE || 'clients',
  cors: {
    origin: process.env.WEBSOCKET_CORS_ORIGIN || '*',
  },
})
export class ClientsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ClientsGateway.name);

  // Maps socket.id to selected clientId
  private selectedClientBySocket = new Map<string, string>();
  // Maps socket.id to remote socket connection (client's agent WS)
  // Using ClientSocket type from socket.io-client (type-only import to avoid runtime dependency)
  private remoteSocketBySocket = new Map<string, ClientSocket>();
  // Track which agentIds are logged-in per socket (avoid repeated logins)
  private loggedInAgentsBySocket = new Map<string, Set<string>>();
  // Track setClient operations in progress per socket to prevent duplicate calls
  private settingClientBySocket = new Map<string, string>();
  // Track reconnection state per remote socket (keyed by local socket.id)
  private remoteReconnectionState = new Map<
    string,
    {
      reconnecting: boolean;
      reconnectAttempts: number;
      lastError?: string;
    }
  >();
  // Track clientId per remote socket for context (keyed by local socket.id)
  private clientIdBySocket = new Map<string, string>();
  // Track last agentId and message for statistics (last forward with agentId)
  private lastAgentIdBySocket = new Map<string, string>();
  private lastChatMessageBySocket = new Map<string, string>();
  /** Local Socket.IO sockets by id (Namespace typings do not expose sockets.get). */
  private readonly localSocketById = new Map<string, Socket>();
  private readonly workspaceAutoEnrichCacheTtlMs = 15_000;
  private readonly workspaceAutoEnrichCache = new Map<
    string,
    { expiresAt: number; enabledGlobal?: boolean; vectorMaxCosineDistance?: number }
  >();

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
    private readonly socketAuthService: SocketAuthService,
    private readonly statisticsService: StatisticsService,
    private readonly clientAutomationChatRealtime: ClientAutomationChatRealtimeService,
    private readonly ticketAutomationChatSync: TicketAutomationChatSyncService,
    private readonly ticketsService: TicketsService,
    private readonly knowledgeTreeService: KnowledgeTreeService,
    private readonly autoContextResolverService: AutoContextResolverService,
    private readonly workspaceConfigurationOverridesProxy: ClientWorkspaceConfigurationOverridesProxyService,
    private readonly agentConsoleStatusService: AgentConsoleStatusService,
    private readonly notificationPublisher: AgenstraNotificationPublisher,
  ) {}

  afterInit(server: Server): void {
    this.clientAutomationChatRealtime.attachServer(server);
    // When using namespace: 'clients', NestJS passes the namespace (not root Server) to afterInit.
    // Namespaces don't have .of(); use server directly for middleware.
    server.use(async (socket, next) => {
      // Auth from headers (polling) or handshake.auth (WebSocket - browser cannot send custom headers)
      const authHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.Authorization;
      const userInfo = await this.socketAuthService.validateAndGetUser(authHeader);

      if (!userInfo) {
        this.logger.warn(`WebSocket connection rejected: missing or invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as Socket & { data: { userInfo: typeof userInfo } }).data = { userInfo };
      next();
    });
  }

  handleConnection(socket: Socket): void {
    this.logger.log(`Client connected: ${socket.id}`);
    this.localSocketById.set(socket.id, socket);
  }

  handleDisconnect(socket: Socket): void {
    this.logger.log(`Client disconnected: ${socket.id}`);
    this.localSocketById.delete(socket.id);
    const prevClient = this.selectedClientBySocket.get(socket.id);

    if (prevClient) {
      void socket.leave(TicketBoardRealtimeService.clientRoom(prevClient));
    }

    this.selectedClientBySocket.delete(socket.id);
    const remote = this.remoteSocketBySocket.get(socket.id);

    if (remote) {
      try {
        remote.removeAllListeners();
        remote.disconnect();
      } catch {
        // ignore
      }

      this.remoteSocketBySocket.delete(socket.id);
    }

    this.loggedInAgentsBySocket.delete(socket.id);
    this.settingClientBySocket.delete(socket.id);
    this.remoteReconnectionState.delete(socket.id);
    this.clientIdBySocket.delete(socket.id);
    this.lastAgentIdBySocket.delete(socket.id);
    this.lastChatMessageBySocket.delete(socket.id);
  }

  /**
   * Handle client context setup.
   * SECURITY: All responses (setClientSuccess, error) are sent only to the initiating socket.
   * Each socket gets its own isolated remote connection to the agent-manager gateway.
   * @param data - SetClient payload containing clientId
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('setClient')
  async handleSetClient(@MessageBody() data: SetClientPayload, @ConnectedSocket() socket: Socket) {
    const clientId = data?.clientId;

    if (!clientId) {
      // SECURITY: Error sent only to the initiating socket, not broadcast
      socket.emit('error', { message: 'clientId is required' });

      return;
    }

    // Prevent duplicate setClient calls for the same socket and clientId
    const currentSettingClientId = this.settingClientBySocket.get(socket.id);
    const currentSelectedClientId = this.selectedClientBySocket.get(socket.id);

    // Skip if already setting this clientId for this socket
    if (currentSettingClientId === clientId) {
      this.logger.debug(`setClient already in progress for socket ${socket.id} and clientId ${clientId}`);

      return;
    }

    // Skip if already selected (unless it's a different clientId, which would be a change)
    if (currentSelectedClientId === clientId && !currentSettingClientId) {
      this.logger.debug(`Client ${clientId} already selected for socket ${socket.id}`);
      void socket.join(TicketBoardRealtimeService.clientRoom(clientId));
      // Still emit success to acknowledge the request
      socket.emit('setClientSuccess', { message: 'Client context already set', clientId });

      return;
    }

    // Mark as setting to prevent duplicate calls
    this.settingClientBySocket.set(socket.id, clientId);

    try {
      const userInfo = (socket as Socket & { data?: { userInfo?: Parameters<typeof buildRequestFromSocketUser>[0] } })
        .data?.userInfo;

      if (!userInfo) {
        this.settingClientBySocket.delete(socket.id);
        socket.emit('error', { message: 'Unauthorized' });

        return;
      }

      await ensureClientAccess(
        this.clientsRepository,
        this.clientUsersRepository,
        clientId,
        buildRequestFromSocketUser(userInfo),
      );

      const previousSelectedClientId = this.selectedClientBySocket.get(socket.id);

      if (previousSelectedClientId && previousSelectedClientId !== clientId) {
        await socket.leave(TicketBoardRealtimeService.clientRoom(previousSelectedClientId));
      }

      await socket.join(TicketBoardRealtimeService.clientRoom(clientId));

      const client = await this.clientsRepository.findByIdOrThrow(clientId as string);

      this.selectedClientBySocket.set(socket.id, clientId);

      // Clean up any existing remote socket for this local socket before creating a new one
      const existingRemote = this.remoteSocketBySocket.get(socket.id);

      if (existingRemote) {
        this.logger.debug(`Cleaning up existing remote socket for socket ${socket.id} before creating new one`);

        try {
          existingRemote.removeAllListeners();
          existingRemote.disconnect();
        } catch {
          // ignore cleanup errors
        }

        this.remoteSocketBySocket.delete(socket.id);
      }

      // establish remote socket connection to the client's agents namespace
      const authHeader = await this.getAuthHeader(clientId);

      await validateClientEndpointWithDnsOrThrow(client.endpoint);
      const tlsPolicy = getClientEndpointTlsPolicy(this.logger);
      const remoteUrl = this.buildAgentsWsUrl(client.endpoint, client.agentWsPort);
      const remote = createCorrelationAwareSocketIoClient(remoteUrl, {
        transports: ['websocket'],
        extraHeaders: { Authorization: authHeader },
        rejectUnauthorized: tlsPolicy.rejectUnauthorized,
        reconnection: true,
        reconnectionAttempts: parseInt(process.env.SOCKET_RECONNECTION_ATTEMPTS || '5'),
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
      });

      // Log when remote socket is created for debugging
      this.logger.debug(`Created remote socket for clientId ${clientId}, socket.id ${socket.id}`);
      // Log socket configuration
      this.logger.debug(
        `Remote socket config: reconnection=${remote.io?.opts?.reconnection}, reconnectionAttempts=${remote.io?.opts?.reconnectionAttempts}`,
      );
      // Store clientId for this remote socket
      this.clientIdBySocket.set(socket.id, clientId);
      // Initialize reconnection state
      this.remoteReconnectionState.set(socket.id, {
        reconnecting: false,
        reconnectAttempts: 0,
      });
      // Wire remote->local: forward application events back to the original socket
      // SECURITY: Each remote socket connection is isolated to its specific local socket via closure.
      // Events from the remote socket are only forwarded to the local socket that owns this remote connection.
      // This ensures agent-specific messages are only received by clients authenticated to that agent.
      // Filter out Socket.IO internal connection events to prevent connection issues
      const internalEvents = new Set([
        'connect',
        'disconnect',
        'connect_error',
        'reconnect',
        'reconnect_attempt',
        'reconnecting',
        'reconnect_error',
        'reconnect_failed',
        'ping',
        'pong',
      ]);

      // Handle Socket.IO internal error events separately (don't forward to avoid disconnection)
      // Internal errors are Error instances, application errors are plain objects
      remote.on('error', () => {
        // Don't forward - this is a Socket.IO internal error
      });
      remote.onAny((event, ...args) => {
        // SECURITY: The 'socket' variable is captured from the closure, ensuring events are only
        // forwarded to the specific local socket that initiated this remote connection.
        // This maintains isolation between different client connections.
        // For 'error' events, check if it's an internal Socket.IO error (Error instance)
        // vs application-level error (plain object from agents gateway)
        if (event === 'error' && args.length > 0 && args[0] instanceof Error) {
          return;
        }

        // Record statistics for chat events before forwarding
        const currentClientId = this.clientIdBySocket.get(socket.id);
        const lastAgentId = this.lastAgentIdBySocket.get(socket.id);
        const userInfo = (socket as Socket & { data?: { userInfo?: { userId?: string } } }).data?.userInfo;
        const userId = userInfo?.userId;

        if (event === 'chatEnhanceResult' && currentClientId && lastAgentId && args.length > 0) {
          const data = args[0] as { success?: boolean; data?: Record<string, unknown> };
          const payload: Record<string, unknown> | undefined = data?.success ? data.data : data;

          if (payload?.success === true && typeof payload.enhancedText === 'string') {
            const text = payload.enhancedText;
            const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
            const charCount = text.length;

            this.statisticsService
              .recordChatOutput(
                currentClientId,
                lastAgentId,
                wordCount,
                charCount,
                userId,
                StatisticsInteractionKind.PROMPT_ENHANCEMENT,
              )
              .catch(() => undefined);
          }
        } else if (event === 'ticketBodyResult' && currentClientId && lastAgentId && args.length > 0) {
          const data = args[0] as { success?: boolean; data?: Record<string, unknown> };
          const payload: Record<string, unknown> | undefined = data?.success ? data.data : data;

          if (payload?.success === true && typeof payload.enhancedText === 'string') {
            const text = payload.enhancedText;
            const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
            const charCount = text.length;

            this.statisticsService
              .recordChatOutput(
                currentClientId,
                lastAgentId,
                wordCount,
                charCount,
                userId,
                StatisticsInteractionKind.TICKET_BODY_GENERATION,
              )
              .catch(() => undefined);
          }
        } else if (event === 'chatMessage' && currentClientId && lastAgentId && args.length > 0) {
          const data = args[0] as { success?: boolean; data?: Record<string, unknown> };
          const payload: Record<string, unknown> | undefined = data?.success ? data.data : data;

          if (payload?.from === 'agent') {
            const resp = payload.response;
            const text = (payload.text as string) ?? (typeof resp === 'string' ? resp : JSON.stringify(resp ?? ''));
            const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
            const charCount = text.length;

            this.statisticsService
              .recordChatOutput(currentClientId, lastAgentId, wordCount, charCount, userId)
              .catch(() => undefined);

            this.notificationPublisher.publishChatMessage(currentClientId, {
              agentId: lastAgentId,
              direction: 'outgoing',
              source: 'agent',
              message: text,
              userId: userId ?? null,
            });

            void this.agentConsoleStatusService
              .onAgentChatActivity(currentClientId, lastAgentId)
              .catch(() => undefined);
          }
        } else if (event === 'gitStateChanged' && currentClientId && args.length > 0) {
          const data = args[0] as { success?: boolean; data?: { agentId?: string } };
          const payload: { agentId?: string } | undefined = data?.success ? data.data : (data as { agentId?: string });
          const agentId = payload?.agentId ?? lastAgentId;

          if (agentId) {
            void this.agentConsoleStatusService.notifyVcsStateChanged(currentClientId, agentId).catch(() => undefined);
          }
        } else if (event === 'fileUpdateNotification' && currentClientId && lastAgentId) {
          void this.agentConsoleStatusService
            .notifyVcsStateChanged(currentClientId, lastAgentId)
            .catch(() => undefined);
        } else if (event === 'messageFilterResult' && currentClientId && lastAgentId && args.length > 0) {
          const data = args[0] as { success?: boolean; data?: Record<string, unknown> };
          const payload: Record<string, unknown> | undefined = data?.success ? data.data : data;

          if (payload?.status === 'dropped') {
            const direction =
              payload.direction === 'outgoing' ? FilterDropDirection.OUTGOING : FilterDropDirection.INCOMING;
            const matchedFilter = payload?.matchedFilter as
              | { type?: string; displayName?: string; reason?: string }
              | undefined;
            // For incoming drops we have the message from our forward; for outgoing we don't
            let wordCount = 0;
            let charCount = 0;

            if (direction === FilterDropDirection.INCOMING) {
              const lastMessage = this.lastChatMessageBySocket.get(socket.id);

              wordCount = lastMessage ? lastMessage.trim().split(/\s+/).filter(Boolean).length : 0;
              charCount = lastMessage?.length ?? 0;
              this.lastChatMessageBySocket.delete(socket.id);
            }

            this.statisticsService
              .recordChatFilterDrop(
                currentClientId,
                lastAgentId,
                matchedFilter?.type ?? 'unknown',
                matchedFilter?.displayName ?? 'Unknown Filter',
                direction,
                wordCount,
                charCount,
                userId,
                matchedFilter?.reason,
              )
              .catch(() => undefined);

            this.notificationPublisher.publishFilterRuleTriggered(currentClientId, {
              agentId: lastAgentId,
              direction: direction === FilterDropDirection.OUTGOING ? 'outgoing' : 'incoming',
              status: 'dropped',
              filterType: matchedFilter?.type ?? 'unknown',
              filterDisplayName: matchedFilter?.displayName ?? 'Unknown Filter',
              reason: matchedFilter?.reason ?? null,
              wordCount,
              charCount,
              userId: userId ?? null,
            });
          } else if (payload?.status === 'filtered') {
            const flagDirection =
              payload.direction === 'outgoing' ? FilterFlagDirection.OUTGOING : FilterFlagDirection.INCOMING;
            const matchedFilter = payload?.matchedFilter as
              | { type?: string; displayName?: string; reason?: string }
              | undefined;
            let wordCount = 0;
            let charCount = 0;
            const msg = (payload?.message as string) ?? '';

            if (msg) {
              wordCount = msg.trim().split(/\s+/).filter(Boolean).length;
              charCount = msg.length;
            } else if (flagDirection === FilterFlagDirection.INCOMING) {
              const lastMessage = this.lastChatMessageBySocket.get(socket.id);

              if (lastMessage) {
                wordCount = lastMessage.trim().split(/\s+/).filter(Boolean).length;
                charCount = lastMessage.length;
              }
            }

            this.statisticsService
              .recordChatFilterFlag(
                currentClientId,
                lastAgentId,
                matchedFilter?.type ?? 'unknown',
                matchedFilter?.displayName ?? 'Unknown Filter',
                flagDirection,
                wordCount,
                charCount,
                userId,
                matchedFilter?.reason,
              )
              .catch(() => undefined);

            this.notificationPublisher.publishFilterRuleTriggered(currentClientId, {
              agentId: lastAgentId,
              direction: flagDirection === FilterFlagDirection.OUTGOING ? 'outgoing' : 'incoming',
              status: 'filtered',
              filterType: matchedFilter?.type ?? 'unknown',
              filterDisplayName: matchedFilter?.displayName ?? 'Unknown Filter',
              reason: matchedFilter?.reason ?? null,
              wordCount,
              charCount,
              userId: userId ?? null,
              messagePreview: msg || this.lastChatMessageBySocket.get(socket.id) || null,
            });
          }
        }

        // Only forward application-level events, not Socket.IO internal events
        if (!internalEvents.has(event)) {
          // Check connection state before emitting (matches agents.gateway.ts pattern)
          if (!socket.connected) {
            return;
          }

          try {
            // SECURITY: Emit only to the specific local socket (not broadcast to all clients)
            socket.emit(event, ...args);
          } catch (emitError) {
            this.logger.error(`Failed to emit event '${event}' to local socket ${socket.id}: ${emitError}`);
            // Don't rethrow - let the connection continue
          }
        }
      });
      remote.on('connect_error', (err: Error) => {
        this.logger.warn(`Remote connection error for socket ${socket.id}: ${err.message}`);
        // Log socket state for debugging
        const reconnectionEnabled = remote.io?.opts?.reconnection !== false;
        const currentClientId = this.clientIdBySocket.get(socket.id);
        const state = this.remoteReconnectionState.get(socket.id);

        this.logger.debug(
          `connect_error handler: socket.id=${socket.id}, reconnectionEnabled=${reconnectionEnabled}, remote.connected=${remote.connected}, remote.disconnected=${remote.disconnected}, state.reconnecting=${state?.reconnecting}`,
        );

        // If reconnection is enabled and socket is disconnected (not just initial connection failure),
        // treat this as a reconnection attempt even if reconnect_attempt didn't fire
        // remote.disconnected === true means the socket was connected and then disconnected
        if (reconnectionEnabled && remote.disconnected && !remote.connected && currentClientId) {
          // Ensure state exists
          let reconnectionState = state;

          if (!reconnectionState) {
            reconnectionState = {
              reconnecting: false,
              reconnectAttempts: 0,
            };
            this.remoteReconnectionState.set(socket.id, reconnectionState);
            this.logger.debug(`Initialized reconnection state in connect_error handler for socket ${socket.id}`);
          }

          // If socket is disconnected (was connected before), this is a reconnection attempt
          // Increment attempt counter and emit reconnecting event
          reconnectionState.reconnectAttempts = (reconnectionState.reconnectAttempts || 0) + 1;
          const wasReconnecting = reconnectionState.reconnecting;

          reconnectionState.reconnecting = true;
          this.logger.debug(
            `Treating connect_error as reconnection attempt ${reconnectionState.reconnectAttempts} for socket ${socket.id}, clientId ${currentClientId}, wasReconnecting=${wasReconnecting}`,
          );

          // Emit remoteReconnecting on first attempt or when attempt number changes
          if (!wasReconnecting || reconnectionState.reconnectAttempts === 1) {
            if (socket.connected) {
              try {
                this.logger.debug(
                  `Emitting remoteReconnecting from connect_error for socket ${socket.id}, clientId ${currentClientId}, attempt ${reconnectionState.reconnectAttempts}`,
                );
                socket.emit('remoteReconnecting', {
                  clientId: currentClientId,
                  attempt: reconnectionState.reconnectAttempts,
                });
              } catch (error) {
                this.logger.error(`Failed to emit remoteReconnecting from connect_error: ${error}`);
              }
            } else {
              this.logger.warn(
                `Cannot emit remoteReconnecting: local socket ${socket.id} is not connected (reconnection attempt ${reconnectionState.reconnectAttempts})`,
              );
            }
          }

          // Store error for potential reconnect_failed
          reconnectionState.lastError = err.message;

          if (socket.connected) {
            try {
              socket.emit('remoteReconnectError', { clientId: currentClientId, error: err.message });
            } catch {
              // Ignore if socket disconnected during emit
            }
          }

          return; // Don't emit error, we're handling it as reconnection
        }

        // Only emit error if reconnection is disabled
        // If reconnection is enabled, let the reconnection logic handle errors via reconnect_error/reconnect_failed
        if (socket.connected && !reconnectionEnabled) {
          // Reconnection disabled - emit error immediately
          try {
            socket.emit('error', { message: `Remote connection error: ${err.message}` });
          } catch {
            // Ignore if socket disconnected during emit
          }
        }
        // If reconnection is enabled, don't emit error here - wait for reconnect_failed event
        // The reconnect_error and reconnect_failed handlers will emit appropriate events
      });
      remote.on('disconnect', (reason: string) => {
        // Remote disconnected - log but don't disconnect local socket
        // This allows the local socket to remain connected even if remote disconnects
        const currentClientId = this.clientIdBySocket.get(socket.id);

        this.logger.warn(
          `Remote socket disconnected for socket ${socket.id}, clientId ${currentClientId || 'unknown'}, reason: ${reason}`,
        );
        // Log socket state for debugging
        const socketState = {
          connected: remote.connected,
          disconnected: remote.disconnected,
          active: (remote as { active?: boolean }).active,
          reconnecting: (remote as { reconnecting?: boolean }).reconnecting,
        };

        this.logger.debug(`Remote socket state after disconnect: ${JSON.stringify(socketState)}`);
        // Ensure state exists (it should, but be defensive)
        let state = this.remoteReconnectionState.get(socket.id);

        if (!state && currentClientId) {
          // Re-initialize state if it doesn't exist (shouldn't happen, but be safe)
          state = {
            reconnecting: false,
            reconnectAttempts: 0,
          };
          this.remoteReconnectionState.set(socket.id, state);
          this.logger.debug(`Re-initialized reconnection state for socket ${socket.id}, clientId ${currentClientId}`);
        }

        if (state) {
          // Reset reconnection state on disconnect (will be set on reconnect_attempt)
          state.reconnecting = false;
          state.reconnectAttempts = 0;
        }

        // Emit event to frontend to update connection state
        // Always try to emit, even if socket appears disconnected, as it might be reconnecting
        // The emit will fail gracefully if the socket is truly disconnected
        if (currentClientId) {
          try {
            if (socket.connected) {
              socket.emit('remoteDisconnected', { clientId: currentClientId });
              this.logger.debug(`Emitted remoteDisconnected for socket ${socket.id}, clientId ${currentClientId}`);
            } else {
              this.logger.warn(
                `Local socket ${socket.id} is not connected, but attempting to emit remoteDisconnected for clientId ${currentClientId}`,
              );

              // Try to emit anyway - it will fail gracefully if socket is truly disconnected
              // This handles the case where the frontend reconnected but the socket state check is stale
              try {
                socket.emit('remoteDisconnected', { clientId: currentClientId });
                this.logger.debug(
                  `Successfully emitted remoteDisconnected to socket ${socket.id} despite !connected check`,
                );
              } catch (emitError) {
                this.logger.debug(
                  `Failed to emit remoteDisconnected to disconnected socket ${socket.id}: ${emitError}`,
                );
              }
            }
          } catch (emitError) {
            this.logger.warn(`Error emitting remoteDisconnected to socket ${socket.id}: ${emitError}`);
          }
        }
      });
      // Handle reconnection events for remote socket
      // Note: These event listeners are attached to the remote socket instance and should persist through disconnections
      // However, if the remote socket is completely destroyed, these listeners would be lost
      remote.on('reconnect_attempt', (attempt: number) => {
        this.logger.debug(`reconnect_attempt event fired: attempt=${attempt}, socket.id=${socket.id}`);
        const currentClientId = this.clientIdBySocket.get(socket.id);
        let state = this.remoteReconnectionState.get(socket.id);

        this.logger.debug(
          `reconnect_attempt handler: socket.id=${socket.id}, clientId=${currentClientId || 'null'}, state=${!!state}`,
        );

        // Ensure state exists (it should, but be defensive)
        if (!state && currentClientId) {
          // Re-initialize state if it doesn't exist (shouldn't happen, but be safe)
          state = {
            reconnecting: false,
            reconnectAttempts: 0,
          };
          this.remoteReconnectionState.set(socket.id, state);
          this.logger.warn(
            `Re-initialized reconnection state for socket ${socket.id}, clientId ${currentClientId} during reconnect_attempt`,
          );
        }

        if (state && currentClientId) {
          state.reconnecting = true;
          state.reconnectAttempts = attempt;
          this.logger.debug(
            `Remote socket reconnection attempt ${attempt} for socket ${socket.id}, clientId ${currentClientId}`,
          );

          if (socket.connected) {
            try {
              this.logger.debug(
                `Emitting remoteReconnecting for socket ${socket.id}, clientId ${currentClientId}, attempt ${attempt}`,
              );
              socket.emit('remoteReconnecting', { clientId: currentClientId, attempt });
            } catch (error) {
              this.logger.error(`Failed to emit remoteReconnecting: ${error}`);
            }
          } else {
            this.logger.warn(
              `Cannot emit remoteReconnecting: local socket ${socket.id} is not connected (remote attempt ${attempt})`,
            );
          }
        } else {
          this.logger.warn(
            `Cannot emit remoteReconnecting: missing state or clientId for socket ${socket.id}, attempt ${attempt}, state=${!!state}, clientId=${currentClientId || 'null'}`,
          );
        }
      });
      remote.on('reconnecting', (attempt: number) => {
        this.logger.debug(`reconnecting event fired: attempt=${attempt}, socket.id=${socket.id}`);
        const state = this.remoteReconnectionState.get(socket.id);
        const currentClientId = this.clientIdBySocket.get(socket.id);

        if (state) {
          state.reconnecting = true;
          state.reconnectAttempts = attempt;
        }

        // Also emit remoteReconnecting when reconnecting fires (this is a fallback)
        if (state && currentClientId && socket.connected) {
          try {
            this.logger.debug(
              `Emitting remoteReconnecting (from reconnecting event) for socket ${socket.id}, clientId ${currentClientId}, attempt ${attempt}`,
            );
            socket.emit('remoteReconnecting', { clientId: currentClientId, attempt });
          } catch (error) {
            this.logger.error(`Failed to emit remoteReconnecting from reconnecting event: ${error}`);
          }
        }
      });
      remote.on('reconnect', () => {
        const state = this.remoteReconnectionState.get(socket.id);
        const currentClientId = this.clientIdBySocket.get(socket.id);

        if (state && currentClientId) {
          state.reconnecting = false;
          state.reconnectAttempts = 0;
          state.lastError = undefined;
          this.logger.log(`Remote socket reconnected for socket ${socket.id}, clientId ${currentClientId}`);

          if (socket.connected) {
            try {
              socket.emit('remoteReconnected', { clientId: currentClientId });

              // If setClient was in progress and this is a reconnection after initial failure,
              // emit setClientSuccess to complete the operation
              if (this.settingClientBySocket.get(socket.id) === currentClientId) {
                this.settingClientBySocket.delete(socket.id);
                socket.emit('setClientSuccess', { message: 'Client context set', clientId: currentClientId });
              }
            } catch {
              // Ignore if socket disconnected during emit
            }
          }
        }
      });
      remote.on('reconnect_error', (error: Error) => {
        const state = this.remoteReconnectionState.get(socket.id);
        const currentClientId = this.clientIdBySocket.get(socket.id);

        if (state && currentClientId) {
          state.lastError = error.message;
          this.logger.warn(
            `Remote socket reconnection error for socket ${socket.id}, clientId ${currentClientId}: ${error.message}`,
          );

          if (socket.connected) {
            try {
              socket.emit('remoteReconnectError', { clientId: currentClientId, error: error.message });
            } catch {
              // Ignore if socket disconnected during emit
            }
          }
        }
      });
      remote.on('reconnect_failed', () => {
        const state = this.remoteReconnectionState.get(socket.id);
        const currentClientId = this.clientIdBySocket.get(socket.id);

        if (state && currentClientId) {
          state.reconnecting = false;
          const errorMessage = state.lastError || 'Reconnection failed after all attempts';

          this.logger.error(`Remote socket reconnection failed for socket ${socket.id}, clientId ${currentClientId}`);

          if (socket.connected) {
            try {
              socket.emit('remoteReconnectFailed', { clientId: currentClientId, error: errorMessage });

              // If setClient was in progress and reconnection failed, emit error to complete the operation
              if (this.settingClientBySocket.get(socket.id) === currentClientId) {
                this.settingClientBySocket.delete(socket.id);
                socket.emit('error', { message: `Remote connection failed: ${errorMessage}` });
              }
            } catch {
              // Ignore if socket disconnected during emit
            }
          }
        }
      });
      // Handle connection state recovery
      remote.on('connect', async () => {
        const currentClientId = this.clientIdBySocket.get(socket.id);
        const state = this.remoteReconnectionState.get(socket.id);

        this.logger.debug(
          `Remote socket connect event fired for socket ${socket.id}, clientId ${currentClientId}, state.reconnecting=${state?.reconnecting}, state.reconnectAttempts=${state?.reconnectAttempts}`,
        );
        // Check if this is a reconnection (either state.reconnecting is true or reconnectAttempts > 0)
        const isReconnection = state && (state.reconnecting || state.reconnectAttempts > 0);

        if (state && currentClientId && state.reconnecting) {
          state.reconnecting = false;
          state.reconnectAttempts = 0;
          state.lastError = undefined;
          this.logger.log(
            `Remote socket reconnected (via connect event) for socket ${socket.id}, clientId ${currentClientId}`,
          );

          if (socket.connected) {
            try {
              socket.emit('remoteReconnected', { clientId: currentClientId });

              // If setClient was in progress and this is a reconnection after initial failure,
              // emit setClientSuccess to complete the operation
              if (this.settingClientBySocket.get(socket.id) === currentClientId) {
                this.settingClientBySocket.delete(socket.id);
                socket.emit('setClientSuccess', { message: 'Client context set', clientId: currentClientId });
              }
            } catch {
              // Ignore if socket disconnected during emit
            }
          }
        } else if (state && state.reconnectAttempts > 0) {
          // This was a reconnection but state.reconnecting wasn't set (edge case)
          this.logger.debug(
            `Remote socket connected (recovered from reconnection) for socket ${socket.id}, clientId ${currentClientId}`,
          );

          // Still emit remoteReconnected to clear the reconnecting state
          if (socket.connected && currentClientId) {
            try {
              state.reconnecting = false;
              state.reconnectAttempts = 0;
              state.lastError = undefined;
              socket.emit('remoteReconnected', { clientId: currentClientId });
            } catch {
              // Ignore if socket disconnected during emit
            }
          }
        }

        // If this is a reconnection, automatically restore all logged-in agents
        if (isReconnection && currentClientId && socket.connected && remote.connected) {
          const loggedInAgents = this.loggedInAgentsBySocket.get(socket.id);

          if (loggedInAgents && loggedInAgents.size > 0) {
            this.logger.log(
              `Restoring ${loggedInAgents.size} agent login(s) after remote reconnection for socket ${socket.id}, clientId ${currentClientId}`,
            );
            // Restore all logged-in agents asynchronously (don't block the connect handler)
            this.restoreAgentLogins(socket.id, currentClientId, Array.from(loggedInAgents), remote).catch((error) => {
              this.logger.error(`Failed to restore agent logins after reconnection for socket ${socket.id}: ${error}`);
            });
          }
        }
      });
      this.remoteSocketBySocket.set(socket.id, remote);

      // Wait for remote connection to be established before emitting setClientSuccess
      // SECURITY: setClientSuccess is sent only to the initiating socket
      // Check if already connected (socket.io-client can connect synchronously in some cases)
      if (remote.connected) {
        this.settingClientBySocket.delete(socket.id);
        socket.emit('setClientSuccess', { message: 'Client context set', clientId });
      } else {
        remote.once('connect', () => {
          // SECURITY: Success event sent only to the initiating socket
          this.settingClientBySocket.delete(socket.id);
          socket.emit('setClientSuccess', { message: 'Client context set', clientId });
        });
        remote.once('connect_error', (err: Error) => {
          this.logger.warn(`Remote connection failed for socket ${socket.id}: ${err.message}`);
          this.settingClientBySocket.delete(socket.id);
          // Only emit error if reconnection is disabled or will fail immediately
          // If reconnection is enabled, it will attempt to reconnect and emit reconnect_failed if all attempts fail
          const reconnectionEnabled = remote.io?.opts?.reconnection !== false;

          if (socket.connected && !reconnectionEnabled) {
            try {
              // SECURITY: Error sent only to the initiating socket
              socket.emit('error', { message: `Remote connection failed: ${err.message}` });
            } catch {
              // Ignore if socket disconnected during emit
            }
          }
          // If reconnection is enabled, don't emit error here - wait for reconnect_failed event
          // The persistent connect_error handler will also not emit if reconnection is active
        });
      }
    } catch (err) {
      const message = (err as { message?: string }).message || 'Failed to set client';

      // Clear setting flag on error
      this.settingClientBySocket.delete(socket.id);
      // SECURITY: Error sent only to the initiating socket
      socket.emit('error', { message });
    }
  }

  /**
   * Forward generic events to the selected client agent-manager WebSocket.
   * SECURITY: All responses (forwardAck, error) are sent only to the initiating socket.
   * Agent-specific messages from the remote socket are forwarded only to the local socket
   * that owns the remote connection, maintaining isolation between client connections.
   * @param data - Forward payload containing event, payload, and optional agentId
   * @param socket - The socket instance making the request
   */
  @SubscribeMessage('forward')
  async handleForward(@MessageBody() data: ForwardPayload, @ConnectedSocket() socket: Socket) {
    const clientId = this.selectedClientBySocket.get(socket.id);

    if (!clientId) {
      // SECURITY: Error sent only to the initiating socket
      socket.emit('error', { message: 'No client selected. Call setClient first.' });

      return;
    }

    const remote = this.remoteSocketBySocket.get(socket.id);

    if (!remote) {
      // SECURITY: Error sent only to the initiating socket
      socket.emit('error', { message: 'Remote connection not established' });

      return;
    }

    // Wait for remote socket to be connected (with timeout)
    if (remote.disconnected || !remote.connected) {
      // Wait up to 5 seconds for the remote socket to connect
      const maxWaitTime = 5000;
      const startTime = Date.now();

      while ((remote.disconnected || !remote.connected) && Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // If still not connected after waiting, return error
      if (remote.disconnected || !remote.connected) {
        // SECURITY: Error sent only to the initiating socket
        socket.emit('error', { message: 'Remote connection not established' });

        return;
      }
    }

    try {
      const { event, payload } = data || ({} as ForwardPayload);

      if (!event) {
        throw new BadRequestException('event is required');
      }

      const agentId = data?.agentId;
      const payloadWithContext = await this.enrichForwardPayloadWithTicketContext(clientId, payload);
      let loggedIn = this.loggedInAgentsBySocket.get(socket.id);

      if (!loggedIn) {
        loggedIn = new Set<string>();
        this.loggedInAgentsBySocket.set(socket.id, loggedIn);
      }

      // Special handling for "login" event with agentId: always override payload with credentials
      // SECURITY: Login success/error events are handled via remote.once() listeners and forwarded
      // only to the local socket that initiated the login, maintaining isolation.
      if (event === 'login' && agentId) {
        const creds = await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, agentId);

        if (!creds?.password) {
          // SECURITY: Error sent only to the initiating socket
          socket.emit('error', { message: `No stored credentials for agent ${agentId}` });

          return;
        }

        // Always override payload with credentials from database, regardless of login status
        const loginPayload = { agentId, password: creds.password };

        // Wait for login to complete
        await new Promise<void>((resolve, reject) => {
          const loginTimeout = setTimeout(() => {
            remote.off('loginSuccess', onLoginSuccess);
            remote.off('loginError', onLoginError);
            reject(new Error('Login timeout'));
          }, 5000);
          const onLoginSuccess = () => {
            clearTimeout(loginTimeout);
            remote.off('loginSuccess', onLoginSuccess);
            remote.off('loginError', onLoginError);
            loggedIn.add(agentId);
            resolve();
          };
          const onLoginError = (errorData: unknown) => {
            clearTimeout(loginTimeout);
            remote.off('loginSuccess', onLoginSuccess);
            remote.off('loginError', onLoginError);
            const error = errorData as { error?: { message?: string } };

            reject(new Error(error?.error?.message || 'Login failed'));
          };

          remote.once('loginSuccess', onLoginSuccess);
          remote.once('loginError', onLoginError);
          remote.emit('login', loginPayload);
        });
        this.scheduleTicketAutomationChatHydrate(socket, clientId, agentId);
        // Login event already emitted, don't forward again
        // SECURITY: Acknowledgement sent only to the initiating socket
        socket.emit('forwardAck', { received: true, event });

        return;
      }

      // Auto-login for other events if agentId is provided and not yet logged in
      let performedFreshAutoLogin = false;

      if (agentId && !loggedIn.has(agentId)) {
        const creds = await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, agentId);

        if (creds?.password) {
          // Wait for login to complete before emitting the event
          await new Promise<void>((resolve, reject) => {
            const loginTimeout = setTimeout(() => {
              remote.off('loginSuccess', onLoginSuccess);
              remote.off('loginError', onLoginError);
              reject(new Error('Login timeout'));
            }, 5000);
            const onLoginSuccess = () => {
              clearTimeout(loginTimeout);
              remote.off('loginSuccess', onLoginSuccess);
              remote.off('loginError', onLoginError);
              loggedIn.add(agentId);
              resolve();
            };
            const onLoginError = (errorData: unknown) => {
              clearTimeout(loginTimeout);
              remote.off('loginSuccess', onLoginSuccess);
              remote.off('loginError', onLoginError);
              const error = errorData as { error?: { message?: string } };

              reject(new Error(error?.error?.message || 'Login failed'));
            };

            remote.once('loginSuccess', onLoginSuccess);
            remote.once('loginError', onLoginError);
            remote.emit('login', { agentId, password: creds.password });
          });
          performedFreshAutoLogin = true;
        } else {
          this.logger.warn(`No stored credentials for client ${clientId}, agent ${agentId}; skipping auto-login`);
        }
      }

      if (performedFreshAutoLogin && agentId) {
        this.scheduleTicketAutomationChatHydrate(socket, clientId, agentId);
      }

      if (event === 'chat' && agentId) {
        const message =
          (payloadWithContext as { message?: string; contextInjection?: ContextInjectionPayload })?.message ?? '';
        const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
        const charCount = message.length;
        const userInfo = (socket as Socket & { data?: { userInfo?: { userId?: string } } }).data?.userInfo;

        this.statisticsService
          .recordChatInput(clientId, agentId, wordCount, charCount, userInfo?.userId)
          .catch(() => undefined);
        this.notificationPublisher.publishChatMessage(clientId, {
          agentId,
          direction: 'incoming',
          source: 'user',
          message,
          userId: userInfo?.userId ?? null,
        });
        this.lastAgentIdBySocket.set(socket.id, agentId);
        this.lastChatMessageBySocket.set(socket.id, message);
      } else if (event === 'enhanceChat' && agentId) {
        const message = (payloadWithContext as { message?: string })?.message ?? '';
        const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
        const charCount = message.length;
        const userInfo = (socket as Socket & { data?: { userInfo?: { userId?: string } } }).data?.userInfo;

        this.statisticsService
          .recordChatInput(
            clientId,
            agentId,
            wordCount,
            charCount,
            userInfo?.userId,
            StatisticsInteractionKind.PROMPT_ENHANCEMENT,
          )
          .catch(() => undefined);
        this.lastAgentIdBySocket.set(socket.id, agentId);
      } else if (event === 'generateTicketBody' && agentId) {
        const title = (payloadWithContext as { title?: string })?.title ?? '';
        const wordCount = title.trim().split(/\s+/).filter(Boolean).length;
        const charCount = title.length;
        const userInfo = (socket as Socket & { data?: { userInfo?: { userId?: string } } }).data?.userInfo;

        this.statisticsService
          .recordChatInput(
            clientId,
            agentId,
            wordCount,
            charCount,
            userInfo?.userId,
            StatisticsInteractionKind.TICKET_BODY_GENERATION,
          )
          .catch(() => undefined);
        this.lastAgentIdBySocket.set(socket.id, agentId);
      } else if (agentId) {
        this.lastAgentIdBySocket.set(socket.id, agentId);
      }

      remote.emit(event, payloadWithContext);
      // SECURITY: Acknowledgement sent only to the initiating socket
      socket.emit('forwardAck', { received: true, event });
    } catch (error) {
      const message = (error as { message?: string }).message || 'Forwarding failed';

      // SECURITY: Error sent only to the initiating socket
      socket.emit('error', { message });
    }
  }

  private async resolveWorkspaceAutoEnrichSettings(clientId: string): Promise<{
    enabledGlobal?: boolean;
    vectorMaxCosineDistance?: number;
  }> {
    const now = Date.now();
    const cached = this.workspaceAutoEnrichCache.get(clientId);

    if (cached && cached.expiresAt > now) {
      return {
        enabledGlobal: cached.enabledGlobal,
        vectorMaxCosineDistance: cached.vectorMaxCosineDistance,
      };
    }

    try {
      const settings = await this.workspaceConfigurationOverridesProxy.getConfigurationOverrides(clientId);
      const globalRow = settings.find((entry) => entry.settingKey === 'autoEnrichEnabledGlobal');
      const rawGlobal = globalRow?.value?.trim();
      let enabledGlobal: boolean | undefined;

      if (rawGlobal !== undefined && rawGlobal !== '') {
        enabledGlobal = rawGlobal.toLowerCase() !== 'false' && rawGlobal !== '0';
      } else {
        enabledGlobal = undefined;
      }

      const distanceRow = settings.find((entry) => entry.settingKey === 'autoEnrichVectorMaxCosineDistance');
      const rawDistance = distanceRow?.value?.trim();
      let vectorMaxCosineDistance: number | undefined;

      if (rawDistance !== undefined && rawDistance !== '') {
        const parsed = Number.parseFloat(rawDistance);

        if (Number.isFinite(parsed)) {
          vectorMaxCosineDistance = Math.min(2, Math.max(0, parsed));
        }
      }

      this.workspaceAutoEnrichCache.set(clientId, {
        expiresAt: now + this.workspaceAutoEnrichCacheTtlMs,
        enabledGlobal,
        vectorMaxCosineDistance,
      });

      return { enabledGlobal, vectorMaxCosineDistance };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Could not load workspace auto-enrich settings for client ${clientId}, using controller defaults: ${message}`,
      );
      this.workspaceAutoEnrichCache.set(clientId, {
        expiresAt: now + this.workspaceAutoEnrichCacheTtlMs,
        enabledGlobal: undefined,
        vectorMaxCosineDistance: undefined,
      });

      return { enabledGlobal: undefined, vectorMaxCosineDistance: undefined };
    }
  }

  private async enrichForwardPayloadWithTicketContext(clientId: string, payload: unknown): Promise<unknown> {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    const typed = payload as { contextInjection?: ContextInjectionPayload };
    const contextInjection = typed.contextInjection;

    if (!contextInjection) {
      return payload;
    }

    const promptForAutoContext = (
      (typed as { message?: string; title?: string }).message ??
      (typed as { message?: string; title?: string }).title ??
      ''
    ).trim();
    const {
      enabledGlobal: workspaceAutoEnrichEnabledGlobal,
      vectorMaxCosineDistance: workspaceAutoEnrichVectorMaxCosineDistance,
    } = await this.resolveWorkspaceAutoEnrichSettings(clientId);
    const resolvedContextInjection = await this.autoContextResolverService.resolve({
      clientId,
      prompt: promptForAutoContext,
      contextInjection,
      workspaceAutoEnrichEnabledGlobal,
      workspaceAutoEnrichVectorMaxCosineDistance,
    });
    const ticketShas = Array.from(
      new Set((resolvedContextInjection.ticketShas ?? []).map((sha) => sha.trim()).filter((sha) => sha.length > 0)),
    );
    const ticketContexts: string[] = [];

    for (const sha of ticketShas) {
      try {
        const prompt = await this.ticketsService.getPrototypePromptByClientSha(clientId, sha);

        if (prompt?.prompt) {
          ticketContexts.push(prompt.prompt);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(`Failed to resolve ticket context for SHA ${sha} in client ${clientId}: ${message}`);
      }
    }

    const knowledgeShas = Array.from(
      new Set((resolvedContextInjection.knowledgeShas ?? []).map((sha) => sha.trim()).filter((sha) => sha.length > 0)),
    );

    if (ticketShas.length === 0 && knowledgeShas.length === 0) {
      return payload;
    }

    let knowledgeContexts: string[] = [];

    if (knowledgeShas.length > 0) {
      try {
        const knowledgeContextResponse = await this.knowledgeTreeService.collectPromptContextsByHashes(
          clientId,
          knowledgeShas,
        );

        knowledgeContexts = knowledgeContextResponse.promptSections;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(`Failed to resolve knowledge context for client ${clientId}: ${message}`);
      }
    }

    return {
      ...typed,
      contextInjection: {
        ...resolvedContextInjection,
        ticketShas,
        ticketContexts,
        knowledgeShas,
        knowledgeContexts: Array.from(
          new Set(
            [...knowledgeContexts, ...(resolvedContextInjection.knowledgeContexts ?? [])]
              .map((ctx) => ctx.trim())
              .filter((ctx) => ctx.length > 0),
          ),
        ),
      },
    };
  }

  /**
   * Restore agent logins after remote socket reconnection
   * This ensures that agents that were logged in before disconnection are automatically re-authenticated
   * @param socketId - The local socket ID
   * @param clientId - The client ID
   * @param agentIds - Array of agent IDs to restore
   * @param remote - The remote socket connection
   */
  private async restoreAgentLogins(
    socketId: string,
    clientId: string,
    agentIds: string[],
    remote: ClientSocket,
  ): Promise<void> {
    for (const agentId of agentIds) {
      try {
        const creds = await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, agentId);

        if (!creds?.password) {
          this.logger.warn(`Cannot restore login for agent ${agentId} on socket ${socketId}: no stored credentials`);
          // Remove from logged-in set since we can't restore it
          const loggedIn = this.loggedInAgentsBySocket.get(socketId);

          if (loggedIn) {
            loggedIn.delete(agentId);
          }

          continue;
        }

        // Wait for login to complete
        await new Promise<void>((resolve, reject) => {
          const loginTimeout = setTimeout(() => {
            remote.off('loginSuccess', onLoginSuccess);
            remote.off('loginError', onLoginError);
            reject(new Error('Login timeout'));
          }, 5000);
          const onLoginSuccess = () => {
            clearTimeout(loginTimeout);
            remote.off('loginSuccess', onLoginSuccess);
            remote.off('loginError', onLoginError);
            this.logger.log(`Restored login for agent ${agentId} on socket ${socketId} after reconnection`);
            resolve();
          };
          const onLoginError = (errorData: unknown) => {
            clearTimeout(loginTimeout);
            remote.off('loginSuccess', onLoginSuccess);
            remote.off('loginError', onLoginError);
            const error = errorData as { error?: { message?: string } };
            const errorMessage = error?.error?.message || 'Login failed';

            this.logger.warn(
              `Failed to restore login for agent ${agentId} on socket ${socketId} after reconnection: ${errorMessage}`,
            );
            // Remove from logged-in set since login failed
            const loggedIn = this.loggedInAgentsBySocket.get(socketId);

            if (loggedIn) {
              loggedIn.delete(agentId);
            }

            reject(new Error(errorMessage));
          };

          remote.once('loginSuccess', onLoginSuccess);
          remote.once('loginError', onLoginError);
          remote.emit('login', { agentId, password: creds.password });
        });
        const localSocket = this.localSocketById.get(socketId);

        if (localSocket) {
          this.scheduleTicketAutomationChatHydrate(localSocket, clientId, agentId);
        }
      } catch (error) {
        const errorMessage = (error as { message?: string }).message || 'Unknown error';

        this.logger.error(`Error restoring login for agent ${agentId} on socket ${socketId}: ${errorMessage}`);
        // Continue with other agents even if one fails
      }
    }
  }

  private scheduleTicketAutomationChatHydrate(socket: Socket, clientId: string, agentId: string): void {
    void this.ticketAutomationChatSync.hydrateForAgentClient(socket, clientId, agentId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);

      this.logger.warn(`Ticket automation chat hydrate failed for agent ${agentId}: ${message}`);
    });
  }

  private async getAuthHeader(clientId: string): Promise<string> {
    const client = await this.clientsRepository.findByIdOrThrow(clientId);

    if (client.authenticationType === AuthenticationType.API_KEY) {
      if (!client.apiKey) throw new BadRequestException('API key not configured for client');

      return `Bearer ${client.apiKey}`;
    }

    if (client.authenticationType === AuthenticationType.KEYCLOAK) {
      const token = await this.clientsService.getAccessToken(clientId);

      return `Bearer ${token}`;
    }

    throw new BadRequestException(`Unsupported authentication type`);
  }

  private buildAgentsWsUrl(endpoint: string, overridePort?: number): string {
    const url = new URL(endpoint);
    const effectivePort = (overridePort && String(overridePort)) || process.env.CLIENTS_REMOTE_WS_PORT || '8080';
    // Use HTTP(S) scheme for Socket.IO client, not WS(S)
    const protocol = url.protocol === 'https:' ? 'https' : 'http';
    const host = url.hostname;

    return `${protocol}://${host}:${effectivePort}/agents`;
  }
}
