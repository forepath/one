import { Injectable } from '@angular/core';
import {
  AgentContextRegistry,
  AgentToolRegistry,
  type AgentContextProvider,
  type AgentToolDefinition,
} from '@forepath/shared/shared/util-agent-harness';

/**
 * Browser tools and context providers of the `direct` mode (UI actions such as navigating, prefilling a form or
 * reading the current selection). Domain actions belong to backend tools (relay mode), where they are authorized.
 *
 * Register in a component or service and keep the returned function to unregister on destroy.
 */
@Injectable({ providedIn: 'root' })
export class AgentHarnessToolsService<TContext = unknown> {
  readonly tools = new AgentToolRegistry<TContext>();
  readonly contextProviders = new AgentContextRegistry<TContext>();
  private context?: TContext;

  registerTool<TArgs, TResult>(definition: AgentToolDefinition<TArgs, TContext, TResult>): () => void {
    return this.tools.register(definition);
  }

  registerContextProvider(provider: AgentContextProvider<TContext>): () => void {
    return this.contextProviders.register(provider);
  }

  /** Run context handed to browser tools and context providers of subsequent turns. */
  setContext(context: TContext | undefined): void {
    this.context = context;
  }

  getContext(): TContext | undefined {
    return this.context;
  }
}
