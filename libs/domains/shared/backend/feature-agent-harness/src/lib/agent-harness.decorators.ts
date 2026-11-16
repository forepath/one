import type { AgentToolDefinition } from '@forepath/shared/shared/util-agent-harness';
import { SetMetadata } from '@nestjs/common';

export const AGENT_TOOL_METADATA = 'forepath:agent-harness:tool';
export const AGENT_CONTEXT_METADATA = 'forepath:agent-harness:context';

/** Tool definition of a decorated method (the method itself is the handler). */
export type AgentToolMetadata = Omit<AgentToolDefinition, 'handler'>;

export interface AgentContextMetadata {
  name: string;
  order?: number;
}

/**
 * Registers a provider method as a function tool of the harness. The method receives `(args, ctx)`; `ctx.context` is
 * the run context of the turn (acting user, tenant, …) and must be used to authorize the action.
 *
 * ```ts
 * @Injectable()
 * export class InvoiceTools {
 *   @AgentTool({
 *     name: 'get_invoice_total',
 *     description: 'Total amount of an invoice by its number',
 *     parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] },
 *   })
 *   total(args: { number: string }, ctx: AgentToolContext<BillingContext>) {
 *     return this.invoices.totalFor(ctx.context.tenantId, args.number);
 *   }
 * }
 * ```
 */
export function AgentTool(definition: AgentToolMetadata): MethodDecorator {
  return SetMetadata(AGENT_TOOL_METADATA, definition);
}

/** Registers a provider method `(context) => text | value` as a context provider of every turn. */
export function AgentContext(name: string, options: { order?: number } = {}): MethodDecorator {
  return SetMetadata(AGENT_CONTEXT_METADATA, { name, ...options } satisfies AgentContextMetadata);
}
