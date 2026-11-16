import { HttpClient, HttpEventType } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  AgentHarness,
  AgentHarnessEventDecoder,
  toConversationId,
  type AgentHarnessConversation,
  type AgentHarnessConversationItem,
  type AgentHarnessEvent,
} from '@forepath/shared/shared/util-agent-harness';
import { defer, from, map, Observable } from 'rxjs';

import {
  AGENT_HARNESS_APPROVAL,
  AGENT_HARNESS_CREDENTIAL,
  AGENT_HARNESS_ENVIRONMENT,
  type AgentHarnessDirectEnvironment,
} from '../tokens/agent-harness-environment';

import { AgentHarnessToolsService } from './agent-harness-tools.service';

/**
 * Talks to the agent either directly (Agenstra OpenAI-compatible API) or through the application's relay endpoints,
 * depending on {@link AGENT_HARNESS_ENVIRONMENT}. Turns are cold observables of harness events: unsubscribing aborts
 * the wait (the turn itself completes in the chat session).
 */
@Injectable({ providedIn: 'root' })
export class AgentHarnessTransportService {
  private readonly environment = inject(AGENT_HARNESS_ENVIRONMENT);
  private readonly credential = inject(AGENT_HARNESS_CREDENTIAL, { optional: true });
  private readonly approval = inject(AGENT_HARNESS_APPROVAL, { optional: true });
  private readonly tools = inject(AgentHarnessToolsService);
  private readonly http = inject(HttpClient);
  private directHarness?: AgentHarness<unknown>;

  createConversation(title?: string): Observable<AgentHarnessConversation> {
    if (this.environment.mode === 'relay') {
      return this.http.post<AgentHarnessConversation>(`${this.relayUrl()}/conversations`, title ? { title } : {});
    }

    return defer(() => from(this.direct().createConversation(title)));
  }

  history(conversationId: string): Observable<AgentHarnessConversationItem[]> {
    const id = toConversationId(conversationId);

    if (this.environment.mode === 'relay') {
      return this.http
        .get<
          AgentHarnessConversationItem[] | { data: AgentHarnessConversationItem[] }
        >(`${this.relayUrl()}/conversations/${id}/items`)
        .pipe(map((body) => (Array.isArray(body) ? body : (body?.data ?? []))));
    }

    return defer(() => from(this.direct().history(id)));
  }

  send(message: string, conversationId: string | null): Observable<AgentHarnessEvent> {
    if (this.environment.mode === 'relay') {
      return this.sendRelay(message, conversationId);
    }

    return new Observable<AgentHarnessEvent>((subscriber) => {
      const controller = new AbortController();
      const harness = this.direct();

      (async () => {
        for await (const event of harness.stream(message, {
          conversationId: conversationId ?? 'primary',
          context: this.tools.getContext(),
          signal: controller.signal,
          approve: this.approval ?? undefined,
        })) {
          if (subscriber.closed) {
            return;
          }

          subscriber.next(event);
        }

        subscriber.complete();
      })().catch((error) => subscriber.error(error));

      return () => controller.abort();
    });
  }

  private sendRelay(message: string, conversationId: string | null): Observable<AgentHarnessEvent> {
    return new Observable<AgentHarnessEvent>((subscriber) => {
      const decoder = new AgentHarnessEventDecoder();
      let received = 0;
      const emit = (events: AgentHarnessEvent[]) => events.forEach((event) => subscriber.next(event));
      const subscription = this.http
        .post(
          `${this.relayUrl()}/turns`,
          { message, ...(conversationId ? { conversationId } : {}) },
          { observe: 'events', reportProgress: true, responseType: 'text' },
        )
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.DownloadProgress) {
              const text = event.partialText ?? '';

              emit(decoder.push(text.slice(received)));
              received = text.length;
            } else if (event.type === HttpEventType.Response) {
              const text = event.body ?? '';

              emit(decoder.push(text.slice(received), true));
              received = text.length;
            }
          },
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });

      return () => subscription.unsubscribe();
    });
  }

  private relayUrl(): string {
    return (this.environment as { relayUrl: string }).relayUrl.replace(/\/+$/, '');
  }

  private direct(): AgentHarness<unknown> {
    if (!this.directHarness) {
      const environment = this.environment as AgentHarnessDirectEnvironment;

      this.directHarness = new AgentHarness<unknown>({
        connection: {
          apiUrl: environment.apiUrl,
          clientId: environment.clientId,
          agentId: environment.agentId,
          credential: this.credential ?? undefined,
        },
        model: environment.model,
        instructions: environment.instructions,
        toolActivity: environment.toolActivity,
        tools: this.tools.tools,
        contextProviders: this.tools.contextProviders,
        onToolError: (error, call) => console.error(`Agent tool '${call.name}' failed`, error),
      });
    }

    return this.directHarness;
  }
}
