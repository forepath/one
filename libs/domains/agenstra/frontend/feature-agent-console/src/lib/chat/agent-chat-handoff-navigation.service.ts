import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import type { AgentChatHandoffLink } from './agent-chat-handoff-view';

/**
 * Jump requests from handoff cards and tool embeds (deep inside the chat thread) to the chat component, which owns
 * agent / chat selection of the active workspace.
 */
@Injectable({ providedIn: 'root' })
export class AgentChatHandoffNavigationService {
  private readonly requestsSubject = new Subject<AgentChatHandoffLink>();

  readonly requests$: Observable<AgentChatHandoffLink> = this.requestsSubject.asObservable();

  open(link: AgentChatHandoffLink): void {
    const agentId = link.agentId?.trim();

    if (!agentId) {
      return;
    }

    this.requestsSubject.next({ agentId, chatId: link.chatId?.trim() || null });
  }
}
