import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, take } from 'rxjs';

import { chatEnhancementStarted, ticketBodyGenerationStarted } from '../chat-timeline/chat-timeline.actions';
import {
  chatTimelineForwardEnhanceFailure,
  chatTimelineForwardTicketBodyFailure,
} from '../chat-timeline/chat-timeline.actions';

import { CLIENT_CHAT_PLAN_EVENTS } from './client-chat-plan.constants';
import {
  connectSocket,
  disconnectSocket,
  forwardEvent,
  setChatModel,
  setChatResponseMode,
  setClient,
} from './container-socket.actions';
import { getSocketInstance } from './container-socket.effects';
import {
  selectChatForwarding,
  selectChatModel,
  selectChatResponseMode,
  selectContainerSocketState,
  selectIsRemoteReconnecting,
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
} from './container-socket.selectors';
import {
  ForwardableEvent,
  type AgentResponseMode,
  type ContextInjectionPayload,
  type ForwardableEventPayload,
} from './container-socket.types';

/**
 * Facade for clients-gateway container socket (connection/context only).
 * Domain history lives in chat-timeline / terminals / files / stats.
 */
@Injectable({
  providedIn: 'root',
})
export class ContainerSocketFacade {
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);
  private currentChatModel: string | null = null;
  private currentChatResponseMode: AgentResponseMode = 'stream';

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
  readonly chatModel$: Observable<string | null> = this.store.select(selectChatModel);
  readonly chatResponseMode$: Observable<AgentResponseMode> = this.store.select(selectChatResponseMode);
  readonly error$: Observable<string | null> = this.store.select(selectSocketError);

  constructor() {
    this.chatModel$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((model) => {
      this.currentChatModel = model;
    });
    this.chatResponseMode$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((mode) => {
      this.currentChatResponseMode = mode === 'single' ? 'single' : 'stream';
    });
  }

  connect(): void {
    this.store.dispatch(connectSocket());
  }

  disconnect(): void {
    this.store.dispatch(disconnectSocket());
  }

  setClient(clientId: string): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot set client.');

      return;
    }

    const state = this.store.select(selectContainerSocketState).pipe(take(1));

    state.subscribe((socketsState) => {
      if (socketsState.selectedClientId === clientId) {
        return;
      }

      if (socketsState.settingClient && socketsState.settingClientId === clientId) {
        return;
      }

      this.store.dispatch(setClient({ clientId }));
      socket.emit('setClient', { clientId });
    });
  }

  /**
   * Create a chat plan (controller-local on clients namespace — not via `forward`).
   */
  createChatPlan(
    agentId: string,
    chatId: string,
    message: string,
    correlationId: string,
    model?: string | null,
    contextInjection?: ContextInjectionPayload,
  ): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot create chat plan.');

      return;
    }

    const effectiveModel = model ?? this.currentChatModel ?? undefined;
    const payload: {
      agentId: string;
      chatId: string;
      message: string;
      correlationId: string;
      model?: string;
      contextInjection?: ContextInjectionPayload;
    } = { agentId, chatId, message, correlationId };

    if (effectiveModel !== undefined && effectiveModel !== null && effectiveModel !== '') {
      payload.model = effectiveModel;
    }

    if (contextInjection) {
      payload.contextInjection = contextInjection;
    }

    socket.emit(CLIENT_CHAT_PLAN_EVENTS.createChatPlan, payload);
  }

  /** When `contextInjection` is set, the controller replaces the plan's stored context snapshot. */
  refineChatPlan(
    agentId: string,
    planId: string,
    message: string,
    correlationId: string,
    contextInjection?: ContextInjectionPayload,
  ): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot refine chat plan.');

      return;
    }

    const payload: {
      agentId: string;
      planId: string;
      message: string;
      correlationId: string;
      contextInjection?: ContextInjectionPayload;
    } = { agentId, planId, message, correlationId };

    if (contextInjection) {
      payload.contextInjection = contextInjection;
    }

    socket.emit(CLIENT_CHAT_PLAN_EVENTS.refineChatPlan, payload);
  }

  executeChatPlan(agentId: string, planId: string, correlationId: string): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot execute chat plan.');

      return;
    }

    socket.emit(CLIENT_CHAT_PLAN_EVENTS.executeChatPlan, { agentId, planId, correlationId });
  }

  cancelChatPlan(agentId: string, planId: string): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot cancel chat plan.');

      return;
    }

    socket.emit(CLIENT_CHAT_PLAN_EVENTS.cancelChatPlan, { agentId, planId });
  }

  forwardEvent(event: ForwardableEvent, payload?: ForwardableEventPayload, agentId?: string): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot forward event.');

      return;
    }

    this.store.dispatch(forwardEvent({ event, payload, agentId }));
    socket.emit('forward', { event, payload, agentId });
  }

  forwardChat(
    message: string,
    agentId: string,
    model?: string | null,
    contextInjection?: ContextInjectionPayload,
    chatId?: string | null,
  ): void {
    const effectiveModel = model ?? this.currentChatModel ?? undefined;
    const responseMode = this.currentChatResponseMode;
    const contextPart = contextInjection ? { contextInjection } : {};
    const chatIdPart = chatId ? { chatId } : {};
    const payload =
      effectiveModel !== undefined && effectiveModel !== null
        ? { message, model: effectiveModel, responseMode, ...contextPart, ...chatIdPart }
        : { message, responseMode, ...contextPart, ...chatIdPart };

    this.forwardEvent(ForwardableEvent.CHAT, payload, agentId);
  }

  forwardRestoreChat(chatId: string, agentId: string, beforeMessageId?: string | null, limit?: number): void {
    const payload: {
      chatId: string;
      beforeMessageId?: string;
      limit?: number;
    } = { chatId };

    if (beforeMessageId) {
      payload.beforeMessageId = beforeMessageId;
    }

    if (limit !== undefined) {
      payload.limit = limit;
    }

    this.forwardEvent(ForwardableEvent.RESTORE_CHAT, payload, agentId);
  }

  forwardEnhanceChat(message: string, agentId: string, correlationId: string, model?: string | null): void {
    const socket = getSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Socket not connected. Cannot forward enhance chat.');
      this.store.dispatch(chatTimelineForwardEnhanceFailure({ errorMessage: 'Socket not connected' }));

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
      this.store.dispatch(chatTimelineForwardTicketBodyFailure({ errorMessage: 'Socket not connected' }));

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

  setChatModel(model: string | null): void {
    this.store.dispatch(setChatModel({ model }));
  }

  setChatResponseMode(mode: AgentResponseMode): void {
    this.store.dispatch(setChatResponseMode({ mode }));
  }

  forwardLogin(agentId: string, chatId?: string | null): void {
    const payload = chatId ? ({ agentId, password: '', chatId } as const) : undefined;

    this.forwardEvent(ForwardableEvent.LOGIN, payload, agentId);
  }

  forwardLogout(): void {
    this.forwardEvent(ForwardableEvent.LOGOUT, {});
  }

  forwardFileUpdate(filePath: string, agentId: string): void {
    this.forwardEvent(ForwardableEvent.FILE_UPDATE, { filePath }, agentId);
  }

  forwardCreateTerminal(sessionId: string | undefined, shell: string | undefined, agentId: string): void {
    this.forwardEvent(ForwardableEvent.CREATE_TERMINAL, { sessionId, shell }, agentId);
  }

  forwardTerminalInput(sessionId: string, data: string, agentId: string): void {
    this.forwardEvent(ForwardableEvent.TERMINAL_INPUT, { sessionId, data }, agentId);
  }

  forwardTerminalResize(sessionId: string, cols: number, rows: number, agentId: string): void {
    this.forwardEvent(ForwardableEvent.TERMINAL_RESIZE, { sessionId, cols, rows }, agentId);
  }

  forwardCloseTerminal(sessionId: string, agentId: string): void {
    this.forwardEvent(ForwardableEvent.CLOSE_TERMINAL, { sessionId }, agentId);
  }

  getRemoteConnectionState$(clientId: string): Observable<{
    clientId: string;
    connected: boolean;
    reconnecting: boolean;
    reconnectAttempts: number;
    lastError: string | null;
  } | null> {
    return this.store.select(selectRemoteConnectionState(clientId));
  }

  isRemoteReconnecting$(clientId: string): Observable<boolean> {
    return this.store.select(selectIsRemoteReconnecting(clientId));
  }

  getRemoteConnectionError$(clientId: string): Observable<string | null> {
    return this.store.select(selectRemoteConnectionError(clientId));
  }
}
