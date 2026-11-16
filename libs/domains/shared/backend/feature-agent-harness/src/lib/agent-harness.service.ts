import {
  AgentHarness,
  type AgentContextProvider,
  type AgentHarnessClient,
  type AgentHarnessConversation,
  type AgentHarnessConversationItem,
  type AgentHarnessEvent,
  type AgentSession,
  type AgentToolDefinition,
  type AgentTurnOptions,
  type AgentTurnResult,
} from '@forepath/shared/shared/util-agent-harness';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AGENT_HARNESS_MODULE_OPTIONS, type AgentHarnessModuleOptions } from './agent-harness.options';

/**
 * Nest facade of the agent harness: one Agenstra agent, the application's tools and context providers, sessions and
 * turns. Tools and context providers are registered from `@AgentTool()` / `@AgentContext()` methods at module init or
 * manually via {@link registerTool} / {@link registerContextProvider}.
 */
@Injectable()
export class AgentHarnessService<TContext = any> {
  private readonly logger = new Logger(AgentHarnessService.name);
  readonly harness: AgentHarness<TContext>;

  constructor(@Inject(AGENT_HARNESS_MODULE_OPTIONS) options: AgentHarnessModuleOptions) {
    const { discover: _discover, ...harnessOptions } = options;

    this.harness = new AgentHarness<TContext>({
      ...harnessOptions,
      // Handler errors are logged here; the agent only sees a generic failure (no internals in the transcript).
      onToolError: (error, call) =>
        this.logger.error(
          `Agent tool '${call.name}' (${call.callId}) failed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        ),
      onContextError: (error, provider) =>
        this.logger.warn(
          `Agent context provider '${provider}' failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });
  }

  get client(): AgentHarnessClient {
    return this.harness.client;
  }

  registerTool<TArgs, TResult>(definition: AgentToolDefinition<TArgs, TContext, TResult>): () => void {
    return this.harness.registerTool(definition);
  }

  registerContextProvider(provider: AgentContextProvider<TContext>): () => void {
    return this.harness.registerContextProvider(provider);
  }

  run(message: string, options?: AgentTurnOptions<TContext>): Promise<AgentTurnResult> {
    return this.harness.run(message, options);
  }

  stream(message: string, options?: AgentTurnOptions<TContext>): AsyncGenerator<AgentHarnessEvent> {
    return this.harness.stream(message, options);
  }

  session(conversationId: string, context?: TContext): AgentSession<TContext> {
    return this.harness.session(conversationId, context);
  }

  createSession(params?: {
    title?: string;
    context?: TContext;
    signal?: AbortSignal;
  }): Promise<AgentSession<TContext>> {
    return this.harness.createSession(params);
  }

  createConversation(title?: string): Promise<AgentHarnessConversation> {
    return this.harness.createConversation(title);
  }

  getConversation(conversationId: string): Promise<AgentHarnessConversation> {
    return this.harness.getConversation(conversationId);
  }

  renameConversation(conversationId: string, title: string): Promise<AgentHarnessConversation> {
    return this.harness.renameConversation(conversationId, title);
  }

  deleteConversation(conversationId: string): Promise<void> {
    return this.harness.deleteConversation(conversationId);
  }

  history(conversationId: string): Promise<AgentHarnessConversationItem[]> {
    return this.harness.history(conversationId);
  }
}
