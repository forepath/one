import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { distinctUntilChanged, Observable, take } from 'rxjs';

import {
  chatEnhancementStarted,
  ticketBodyGenerationStarted,
  connectSocket,
  disconnectSocket,
  forwardEvent,
  setChatModel,
  setChatResponseMode,
  setClient,
} from './sockets.actions';
import { getSocketInstance } from './sockets.effects';
import {
  selectChatEnhancementLastResult,
  selectChatEnhancementPending,
  selectChatTimelineOrdered,
  type ChatTimelineOrderedRow,
  selectTicketBodyGenerationPending,
  selectTicketBodyLastResult,
  selectChatForwarding,
  selectChatModel,
  selectChatResponseMode,
  selectForwardedEvents,
  selectForwardedEventsByEvent,
  selectIsRemoteReconnecting,
  selectMessageFilterResults,
  selectMostRecentForwardedEvent,
  selectMostRecentForwardedEventByEvent,
  selectRemoteConnectionError,
  selectRemoteConnectionState,
  selectSelectedAgentId,
  selectSelectedClientId,
  selectSettingClient,
  selectSettingClientId,
  selectSocketConnected,
  selectSocketConnecting,
  selectSocketDisconnecting,
  selectSocketError,
  selectSocketForwarding,
  selectSocketReconnectAttempts,
  selectSocketReconnecting,
  selectSocketsState,
} from './sockets.selectors';
import {
  ForwardableEvent,
  type AgentResponseMode,
  type ContextInjectionPayload,
  type ForwardableEventPayload,
  type ForwardedEventPayload,
} from './sockets.types';

/**
 * Facade for sockets state management.
 * Provides a clean API for components to interact with socket state
 * without directly accessing the NgRx store or socket instance.
 */
@Injectable({
  providedIn: 'root',
})
export class SocketsFacade {
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);
  private currentChatModel: string | null = null;
  private currentChatResponseMode: AgentResponseMode = 'stream';

  // State observables
  readonly connected$: Observable<boolean> = this.store.select(selectSocketConnected);
  readonly connecting$: Observable<boolean> = this.store.select(selectSocketConnecting);
  readonly disconnecting$: Observable<boolean> = this.store.select(selectSocketDisconnecting);
  readonly reconnecting$: Observable<boolean> = this.store.select(selectSocketReconnecting);
  readonly reconnectAttempts$: Observable<number> = this.store.select(selectSocketReconnectAttempts);
  readonly selectedClientId$: Observable<string | null> = this.store.select(selectSelectedClientId);
  readonly selectedAgentId$: Observable<string | null> = this.store.select(selectSelectedAgentId);
  readonly settingClient$: Observable<boolean> = this.store.select(selectSettingClient);
  readonly settingClientId$: Observable<string | null> = this.store.select(selectSettingClientId);
  readonly forwarding$: Observable<boolean> = this.store.select(selectSocketForwarding);
  readonly chatForwarding$: Observable<boolean> = this.store.select(selectChatForwarding);
  readonly chatEnhancementPending$: Observable<boolean> = this.store.select(selectChatEnhancementPending);
  readonly chatEnhancementLastResult$ = this.store.select(selectChatEnhancementLastResult);
  readonly ticketBodyGenerationPending$: Observable<boolean> = this.store.select(selectTicketBodyGenerationPending);
  readonly ticketBodyLastResult$ = this.store.select(selectTicketBodyLastResult);
  readonly chatModel$: Observable<string | null> = this.store.select(selectChatModel);
  readonly chatResponseMode$: Observable<AgentResponseMode> = this.store.select(selectChatResponseMode);
  readonly error$: Observable<string | null> = this.store.select(selectSocketError);
  readonly forwardedEvents$: Observable<Array<{ event: string; payload: ForwardedEventPayload; timestamp: number }>> =
    this.store.select(selectForwardedEvents);
  /** Chat messages + ticket automation chat events, ordered for the timeline. */
  readonly chatTimelineOrdered$: Observable<ChatTimelineOrderedRow[]> = this.store.select(selectChatTimelineOrdered);

  readonly messageFilterResults$: Observable<
    Array<{
      direction: 'incoming' | 'outgoing';
      status: 'allowed' | 'filtered' | 'dropped';
      message: string;
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
      timestamp: number;
      receivedAt: number;
    }>
  > = this.store.select(selectMessageFilterResults);

  constructor() {
    this.chatModel$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((model) => {
      this.currentChatModel = model;
    });
    this.chatResponseMode$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((mode) => {
      this.currentChatResponseMode = mode === 'single' ? 'single' : 'stream';
    });
  }

  /**
   * Connect to the socket
   */
  connect(): void {
    this.store.dispatch(connectSocket());
  }

  /**
   * Disconnect from the socket
   */
  disconnect(): void {
    this.store.dispatch(disconnectSocket());
  }

  /**
   * Set the client context for subsequent operations
   * @param clientId - The client UUID
   */
  setClient(clientId: string): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot set client.');

      return;
    }

    // Prevent duplicate setClient calls with the same clientId
    // Use synchronous state check to avoid race conditions
    const state = this.store.select(selectSocketsState).pipe(take(1));

    state.subscribe((socketsState) => {
      // Skip if already selected
      if (socketsState.selectedClientId === clientId) {
        return;
      }

      // Skip if already setting this clientId
      if (socketsState.settingClient && socketsState.settingClientId === clientId) {
        return;
      }

      // Dispatch action and emit to socket
      this.store.dispatch(setClient({ clientId }));
      socket.emit('setClient', { clientId });
    });
  }

  /**
   * Forward an event to the agents namespace
   * @param event - The event type (from ForwardableEvent enum)
   * @param payload - Optional event payload (typed based on event)
   * @param agentId - Optional agent UUID for auto-login
   */
  forwardEvent(event: ForwardableEvent, payload?: ForwardableEventPayload, agentId?: string): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot forward event.');

      return;
    }

    this.store.dispatch(forwardEvent({ event, payload, agentId }));
    socket.emit('forward', { event, payload, agentId });
  }

  /**
   * Forward a chat event with typed payload
   * @param message - The chat message text
   * @param agentId - Agent UUID (required for routing the event to the correct agent)
   */
  forwardChat(
    message: string,
    agentId: string,
    model?: string | null,
    contextInjection?: ContextInjectionPayload,
  ): void {
    const effectiveModel = model ?? this.currentChatModel ?? undefined;
    const responseMode = this.currentChatResponseMode;
    const contextPart = contextInjection ? { contextInjection } : {};
    const payload =
      effectiveModel !== undefined && effectiveModel !== null
        ? { message, model: effectiveModel, responseMode, ...contextPart }
        : { message, responseMode, ...contextPart };

    this.forwardEvent(ForwardableEvent.CHAT, payload, agentId);
  }

  /**
   * Request prompt enhancement (unicast chatEnhanceResult; not added to main chat transcript).
   */
  forwardEnhanceChat(message: string, agentId: string, correlationId: string, model?: string | null): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot forward enhance chat.');

      return;
    }

    const effectiveModel = model ?? this.currentChatModel ?? undefined;
    const payload =
      effectiveModel !== undefined && effectiveModel !== null && effectiveModel !== ''
        ? { message, correlationId, model: effectiveModel }
        : { message, correlationId };

    this.store.dispatch(chatEnhancementStarted({ correlationId }));
    this.store.dispatch(forwardEvent({ event: ForwardableEvent.ENHANCE_CHAT, payload, agentId }));
    socket.emit('forward', { event: ForwardableEvent.ENHANCE_CHAT, payload, agentId });
  }

  /**
   * Generate ticket body from title (unicast ticketBodyResult; not added to main chat transcript).
   */
  forwardGenerateTicketBody(
    title: string,
    agentId: string,
    correlationId: string,
    model?: string | null,
    hierarchyContext?: string | null,
  ): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot forward generate ticket body.');

      return;
    }

    const effectiveModel = model ?? this.currentChatModel ?? undefined;
    const trimmedContext = hierarchyContext?.trim();
    const base =
      effectiveModel !== undefined && effectiveModel !== null && effectiveModel !== ''
        ? { title, correlationId, model: effectiveModel }
        : { title, correlationId };
    const payload =
      trimmedContext !== undefined && trimmedContext !== '' ? { ...base, hierarchyContext: trimmedContext } : base;

    this.store.dispatch(ticketBodyGenerationStarted({ correlationId }));
    this.store.dispatch(forwardEvent({ event: ForwardableEvent.GENERATE_TICKET_BODY, payload, agentId }));
    socket.emit('forward', { event: ForwardableEvent.GENERATE_TICKET_BODY, payload, agentId });
  }

  /**
   * Set the preferred chat model (used as default for subsequent chat messages)
   * @param model - Model identifier or null to clear the preference
   */
  setChatModel(model: string | null): void {
    this.store.dispatch(setChatModel({ model }));
  }

  setChatResponseMode(mode: AgentResponseMode): void {
    this.store.dispatch(setChatResponseMode({ mode }));
  }

  /**
   * Forward a login event
   * Note: When agentId is provided, the payload is automatically overridden with credentials from database
   * @param agentId - Agent UUID for auto-login (credentials loaded from database)
   */
  forwardLogin(agentId: string): void {
    // Payload is optional and ignored when agentId is provided (credentials loaded from DB)
    this.forwardEvent(ForwardableEvent.LOGIN, undefined, agentId);
  }

  /**
   * Forward a logout event
   */
  forwardLogout(): void {
    this.forwardEvent(ForwardableEvent.LOGOUT, {});
  }

  /**
   * Forward a file update event
   * @param filePath - The path to the file that was updated
   * @param agentId - Agent UUID (required for routing the event to the correct agent)
   */
  forwardFileUpdate(filePath: string, agentId: string): void {
    this.forwardEvent(ForwardableEvent.FILE_UPDATE, { filePath }, agentId);
  }

  /**
   * Forward a create terminal event
   * @param sessionId - Optional session ID (will be generated if not provided)
   * @param shell - Optional shell command (defaults to 'sh')
   * @param agentId - Agent UUID (required for routing the event to the correct agent)
   */
  forwardCreateTerminal(sessionId: string | undefined, shell: string | undefined, agentId: string): void {
    this.forwardEvent(ForwardableEvent.CREATE_TERMINAL, { sessionId, shell }, agentId);
  }

  /**
   * Forward a terminal input event
   * @param sessionId - The terminal session ID
   * @param data - The input data to send
   * @param agentId - Agent UUID (required for routing the event to the correct agent)
   */
  forwardTerminalInput(sessionId: string, data: string, agentId: string): void {
    this.forwardEvent(ForwardableEvent.TERMINAL_INPUT, { sessionId, data }, agentId);
  }

  /**
   * Forward a close terminal event
   * @param sessionId - The terminal session ID
   * @param agentId - Agent UUID (required for routing the event to the correct agent)
   */
  forwardCloseTerminal(sessionId: string, agentId: string): void {
    this.forwardEvent(ForwardableEvent.CLOSE_TERMINAL, { sessionId }, agentId);
  }

  /**
   * Get forwarded events for a specific event name
   * @param eventName - The event name to filter by
   * @returns Observable of filtered forwarded events
   */
  getForwardedEventsByEvent$(
    eventName: string,
  ): Observable<Array<{ event: string; payload: ForwardedEventPayload; timestamp: number }>> {
    return this.store.select(selectForwardedEventsByEvent(eventName)).pipe(
      // New filtered arrays are allocated on many unrelated store updates (e.g. chatEvent).
      // Same logical list means same element references — skip emissions to avoid DOM churn downstream.
      distinctUntilChanged((prev, curr) => {
        if (prev.length !== curr.length) {
          return false;
        }

        return prev.every((p, i) => p === curr[i]);
      }),
    );
  }

  /**
   * Get the most recent forwarded event
   * @returns Observable of the most recent event or null
   */
  getMostRecentForwardedEvent$(): Observable<{
    event: string;
    payload: ForwardedEventPayload;
    timestamp: number;
  } | null> {
    return this.store.select(selectMostRecentForwardedEvent);
  }

  /**
   * Get the most recent forwarded event for a specific event name
   * @param eventName - The event name to filter by
   * @returns Observable of the most recent event or null
   */
  getMostRecentForwardedEventByEvent$(
    eventName: string,
  ): Observable<{ event: string; payload: ForwardedEventPayload; timestamp: number } | null> {
    return this.store.select(selectMostRecentForwardedEventByEvent(eventName));
  }

  /**
   * Get remote connection state for a specific clientId
   * @param clientId - The client UUID
   * @returns Observable of remote connection state or null
   */
  getRemoteConnectionState$(clientId: string): Observable<{
    clientId: string;
    connected: boolean;
    reconnecting: boolean;
    reconnectAttempts: number;
    lastError: string | null;
  } | null> {
    return this.store.select(selectRemoteConnectionState(clientId));
  }

  /**
   * Check if a remote connection is reconnecting for a specific clientId
   * @param clientId - The client UUID
   * @returns Observable of boolean indicating if reconnecting
   */
  isRemoteReconnecting$(clientId: string): Observable<boolean> {
    return this.store.select(selectIsRemoteReconnecting(clientId));
  }

  /**
   * Get the last error for a remote connection for a specific clientId
   * @param clientId - The client UUID
   * @returns Observable of error message or null
   */
  getRemoteConnectionError$(clientId: string): Observable<string | null> {
    return this.store.select(selectRemoteConnectionError(clientId));
  }
}
