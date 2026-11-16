import { AGENT_HARNESS_TOOL_LIMITS, AGENT_HARNESS_TOOL_NAME_PATTERN } from './agent-harness.constants';
import { AgentHarnessAbortError, AgentHarnessConfigError, AgentToolError } from './agent-harness.errors';
import type { AgentHarnessFunctionToolDefinition, JsonSchema } from './agent-harness.types';
import { validateAgainstSchema } from './json-schema-guard';

/** Everything a tool handler knows about the call it executes. */
export interface AgentToolContext<TContext = unknown> {
  /** Call id minted by Agenstra (`call_…`). */
  callId: string;
  /** Tool name. */
  name: string;
  /** Conversation (`conv_…`) of the turn, when known. */
  conversationId: string | null;
  /** Aborted when the turn is aborted or the tool times out. */
  signal: AbortSignal;
  /**
   * Run context supplied by the application for this turn (e.g. the acting user, tenant and permissions). Tools must
   * authorize every action against it: the agent decides **which** tool to call, never **who** may do what.
   */
  context: TContext;
}

export type AgentToolApproval<TArgs, TContext> =
  | boolean
  | ((args: TArgs, ctx: AgentToolContext<TContext>) => boolean | Promise<boolean>);

export interface AgentToolDefinition<TArgs = any, TContext = any, TResult = unknown> {
  /** `^[A-Za-z0-9_-]{1,64}$`, unique per registry. */
  name: string;
  /** What the tool does and when to use it (shown to the model; at most 4096 characters). */
  description?: string;
  /** JSON schema of the arguments object (shown to the model and used as a first validation guard). */
  parameters?: JsonSchema;
  strict?: boolean;
  /**
   * Typed validation of the arguments after the schema guard; throw to reject. A zod schema's `parse` fits directly
   * (`parse: (args) => schema.parse(args)`).
   */
  parse?: (args: unknown) => TArgs;
  handler: (args: TArgs, ctx: AgentToolContext<TContext>) => TResult | Promise<TResult>;
  /**
   * Whether the tool is offered in a turn with this context (e.g. only to users allowed to book). Evaluated before every
   * turn; tools not offered are never executed, even when the model names them.
   */
  enabled?: (context: TContext) => boolean | Promise<boolean>;
  /**
   * Human approval before execution (state-changing or destructive tools). `true` always asks, a function decides per
   * call. Without an approval handler on the turn, calls that need approval are denied (fail closed).
   */
  requiresApproval?: AgentToolApproval<TArgs, TContext>;
  /** Execution time limit of one call (default 120 s). */
  timeoutMs?: number;
  /** Free-form grouping label (e.g. `invoices`); used to select tool subsets per turn. */
  tags?: string[];
}

export type AgentToolExecutionStatus = 'completed' | 'failed' | 'denied';

/** One executed client tool call of a turn. */
export interface AgentToolExecution {
  callId: string;
  name: string;
  /** Arguments as sent by the model (JSON string). */
  arguments: string;
  status: AgentToolExecutionStatus;
  /** Output handed back to the agent. */
  output: string;
  /** The handler's return value (completed calls only; never sent anywhere by the harness itself). */
  result?: unknown;
  /** Failure reason (also contained in `output`). */
  error?: { message: string; code: string };
  durationMs: number;
}

export interface AgentToolCallRequest {
  callId: string;
  name: string;
  arguments: string;
}

export interface AgentToolExecutionOptions<TContext> {
  context: TContext;
  conversationId: string | null;
  signal?: AbortSignal;
  /** Names offered in this turn; calls of other tools are rejected. */
  offered: ReadonlySet<string>;
  approve?: (request: AgentToolApprovalRequest<TContext>) => boolean | Promise<boolean>;
  /** Unexpected handler errors (logged by the application; the agent only sees a generic failure). */
  onError?: (error: unknown, call: AgentToolCallRequest) => void;
}

export interface AgentToolApprovalRequest<TContext = unknown> {
  callId: string;
  name: string;
  description?: string;
  args: unknown;
  context: TContext;
}

export interface AgentToolSelection {
  /** Only these tool names (default: all registered tools). */
  names?: readonly string[];
  /** Only tools carrying at least one of these tags. */
  tags?: readonly string[];
}

const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}

function serializeOutput(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (result === undefined) {
    return JSON.stringify({ ok: true });
  }

  try {
    return JSON.stringify(result) ?? 'null';
  } catch {
    return JSON.stringify({ ok: true, note: 'The tool result could not be serialized' });
  }
}

function truncate(output: string): string {
  const max = AGENT_HARNESS_TOOL_LIMITS.outputMaxChars;

  if (output.length <= max) {
    return output;
  }

  const marker = `\n…[truncated ${output.length - (max - 64)} characters]`;

  return output.slice(0, max - marker.length) + marker;
}

function failure(message: string, code: string): { output: string; error: { message: string; code: string } } {
  return { output: JSON.stringify({ error: { message, code } }), error: { message, code } };
}

/**
 * Function tools of a harness: registration (validated like the controller does), the per-turn offer and the guarded
 * execution of calls the agent makes.
 */
export class AgentToolRegistry<TContext = unknown> {
  private readonly tools = new Map<string, AgentToolDefinition<any, TContext>>();

  register<TArgs, TResult>(definition: AgentToolDefinition<TArgs, TContext, TResult>): () => void {
    this.assertDefinition(definition);

    if (this.tools.has(definition.name)) {
      throw new AgentHarnessConfigError(`A tool named '${definition.name}' is already registered`);
    }

    if (this.tools.size >= AGENT_HARNESS_TOOL_LIMITS.maxTools) {
      throw new AgentHarnessConfigError(`At most ${AGENT_HARNESS_TOOL_LIMITS.maxTools} tools can be registered`);
    }

    this.tools.set(definition.name, definition as AgentToolDefinition<any, TContext>);

    return () => {
      if (this.tools.get(definition.name) === definition) {
        this.tools.delete(definition.name);
      }
    };
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): AgentToolDefinition<any, TContext> | undefined {
    return this.tools.get(name);
  }

  list(): AgentToolDefinition<any, TContext>[] {
    return [...this.tools.values()];
  }

  get size(): number {
    return this.tools.size;
  }

  /** Function tool definitions offered in a turn with this context (enabled and selected tools only). */
  async offer(context: TContext, selection: AgentToolSelection = {}): Promise<AgentHarnessFunctionToolDefinition[]> {
    const names = selection.names ? new Set(selection.names) : undefined;
    const tags = selection.tags ? new Set(selection.tags) : undefined;
    const offered: AgentHarnessFunctionToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      if (names && !names.has(tool.name)) {
        continue;
      }

      if (tags && !(tool.tags ?? []).some((tag) => tags.has(tag))) {
        continue;
      }

      if (tool.enabled && !(await tool.enabled(context))) {
        continue;
      }

      offered.push({
        type: 'function',
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.parameters ?? { type: 'object', properties: {} },
        ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
      });
    }

    if (byteLength(offered) > AGENT_HARNESS_TOOL_LIMITS.totalMaxBytes) {
      throw new AgentHarnessConfigError(
        `The offered tools exceed ${AGENT_HARNESS_TOOL_LIMITS.totalMaxBytes} bytes; offer a smaller selection per turn`,
      );
    }

    return offered;
  }

  /**
   * Executes one call of the agent. Never throws for handler problems: the outcome is reported to the agent as tool
   * output (`{ "error": { message, code } }` on failure). Only aborts of the turn propagate.
   */
  async execute(call: AgentToolCallRequest, options: AgentToolExecutionOptions<TContext>): Promise<AgentToolExecution> {
    const started = Date.now();
    const base = { callId: call.callId, name: call.name, arguments: call.arguments };
    const done = (
      status: AgentToolExecutionStatus,
      outcome: { output: string; error?: { message: string; code: string }; result?: unknown },
    ): AgentToolExecution => ({
      ...base,
      status,
      output: truncate(outcome.output),
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(status === 'completed' ? { result: outcome.result } : {}),
      durationMs: Date.now() - started,
    });
    const tool = this.tools.get(call.name);

    if (!tool || !options.offered.has(call.name)) {
      return done('failed', failure(`Tool '${call.name}' is not available in this turn`, 'unknown_tool'));
    }

    let rawArgs: unknown;

    try {
      rawArgs = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      return done('failed', failure('The tool arguments are not valid JSON', 'invalid_arguments'));
    }

    const schemaErrors = validateAgainstSchema(rawArgs, tool.parameters ?? { type: 'object' });

    if (schemaErrors.length > 0) {
      return done('failed', failure(`Invalid arguments: ${schemaErrors.slice(0, 10).join('; ')}`, 'invalid_arguments'));
    }

    let args: unknown = rawArgs;

    if (tool.parse) {
      try {
        args = tool.parse(rawArgs);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid arguments';

        return done('failed', failure(`Invalid arguments: ${message.slice(0, 2000)}`, 'invalid_arguments'));
      }
    }

    const controller = new AbortController();
    const outerAbort = () => controller.abort(options.signal?.reason);

    if (options.signal?.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal?.addEventListener('abort', outerAbort, { once: true });
    }

    const ctx: AgentToolContext<TContext> = {
      callId: call.callId,
      name: call.name,
      conversationId: options.conversationId,
      signal: controller.signal,
      context: options.context,
    };
    const timeoutMs = tool.timeoutMs && tool.timeoutMs > 0 ? tool.timeoutMs : DEFAULT_TOOL_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const needsApproval =
        typeof tool.requiresApproval === 'function'
          ? await tool.requiresApproval(args, ctx)
          : tool.requiresApproval === true;

      if (needsApproval) {
        const approved = options.approve
          ? await options.approve({
              callId: call.callId,
              name: call.name,
              description: tool.description,
              args,
              context: options.context,
            })
          : false;

        if (!approved) {
          return done('denied', failure('The user did not approve this action', 'not_approved'));
        }
      }

      const result = await Promise.race([
        Promise.resolve(tool.handler(args, ctx)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new AgentToolError(`The tool did not finish within ${Math.round(timeoutMs / 1000)} s`, 'timeout'));
            // Tells the handler to stop; the race is already settled with the timeout error.
            controller.abort();
          }, timeoutMs);
        }),
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(controller.signal.reason ?? new Error('aborted'));
          }

          controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('aborted')), {
            once: true,
          });
        }),
      ]);

      return done('completed', { output: serializeOutput(result), result });
    } catch (error) {
      if (options.signal?.aborted) {
        throw error instanceof AgentHarnessAbortError ? error : new AgentHarnessAbortError();
      }

      if (error instanceof AgentToolError) {
        return done('failed', failure(error.message.slice(0, 4000), error.code ?? 'tool_error'));
      }

      options.onError?.(error, call);

      return done('failed', failure('The tool failed with an internal error', 'internal_error'));
    } finally {
      if (timer) {
        clearTimeout(timer);
      }

      options.signal?.removeEventListener('abort', outerAbort);
    }
  }

  private assertDefinition(definition: AgentToolDefinition<any, TContext>): void {
    if (!definition || typeof definition !== 'object') {
      throw new AgentHarnessConfigError('Tool definition must be an object');
    }

    if (typeof definition.name !== 'string' || !AGENT_HARNESS_TOOL_NAME_PATTERN.test(definition.name)) {
      throw new AgentHarnessConfigError(`Tool name '${definition.name}' must match ^[A-Za-z0-9_-]{1,64}$`);
    }

    if (typeof definition.handler !== 'function') {
      throw new AgentHarnessConfigError(`Tool '${definition.name}' needs a handler`);
    }

    if (
      definition.description !== undefined &&
      (typeof definition.description !== 'string' ||
        definition.description.length > AGENT_HARNESS_TOOL_LIMITS.descriptionMaxLength)
    ) {
      throw new AgentHarnessConfigError(
        `Tool '${definition.name}' description must be at most ${AGENT_HARNESS_TOOL_LIMITS.descriptionMaxLength} characters`,
      );
    }

    if (definition.parameters !== undefined) {
      if (
        !definition.parameters ||
        typeof definition.parameters !== 'object' ||
        Array.isArray(definition.parameters) ||
        (definition.parameters['type'] !== undefined && definition.parameters['type'] !== 'object')
      ) {
        throw new AgentHarnessConfigError(`Tool '${definition.name}' parameters must be an object JSON schema`);
      }

      if (byteLength(definition.parameters) > AGENT_HARNESS_TOOL_LIMITS.parametersMaxBytes) {
        throw new AgentHarnessConfigError(
          `Tool '${definition.name}' parameters exceed ${AGENT_HARNESS_TOOL_LIMITS.parametersMaxBytes} bytes`,
        );
      }
    }
  }
}
