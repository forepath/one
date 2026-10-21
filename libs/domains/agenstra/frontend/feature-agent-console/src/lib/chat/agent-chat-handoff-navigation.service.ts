import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import type { AgentChatHandoffLink } from './agent-chat-handoff-view';

/**
 * Jump requests from handoff cards and tool embeds to the page that owns them: the chat component (agent / chat
 * selection of the active workspace) or the tasks page, which hands chat jumps over with {@link defer} before it
 * navigates to the chat.
 */
@Injectable({ providedIn: 'root' })
export class AgentChatHandoffNavigationService {
  private readonly requestsSubject = new Subject<AgentChatHandoffLink>();
  private deferred: AgentChatHandoffLink | null = null;

  readonly requests$: Observable<AgentChatHandoffLink> = this.requestsSubject.asObservable();

  open(link: AgentChatHandoffLink): void {
    const normalized = normalizeAgentChatHandoffLink(link);

    if (normalized) {
      this.requestsSubject.next(normalized);
    }
  }

  /** Remember a jump for the chat page that is about to be shown (it is not listening yet). */
  defer(link: AgentChatHandoffLink): void {
    this.deferred = normalizeAgentChatHandoffLink(link);
  }

  /** The deferred jump, once (the chat page takes it on init). */
  takeDeferred(): AgentChatHandoffLink | null {
    const link = this.deferred;

    this.deferred = null;

    return link;
  }
}

function normalizeAgentChatHandoffLink(link: AgentChatHandoffLink): AgentChatHandoffLink | null {
  const agentId = link.agentId?.trim();

  if (!agentId) {
    return null;
  }

  const taskId = link.taskRun?.taskId?.trim();
  const runId = link.taskRun?.runId?.trim();

  return {
    agentId,
    chatId: link.chatId?.trim() || null,
    ...(taskId && runId ? { taskRun: { taskId, runId } } : {}),
  };
}
