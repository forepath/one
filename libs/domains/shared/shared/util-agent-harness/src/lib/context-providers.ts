import { AGENT_HARNESS_CONTEXT_MAX_CHARS } from './agent-harness.constants';
import { AgentHarnessConfigError } from './agent-harness.errors';

/**
 * Supplies turn context to the agent (current user, tenant, page, selected record, domain rules, …). Providers run
 * before every turn; their sections are sent as the turn's `instructions`.
 *
 * Context becomes part of the turn prompt and therefore of the chat transcript (visible in the Agenstra console):
 * never put secrets or credentials into it. Treat context derived from user data as untrusted text.
 */
export interface AgentContextProvider<TContext = unknown> {
  /** Section name (`^[a-z0-9_.-]{1,64}$`), rendered as `<context name="…">`. */
  name: string;
  /** Lower values come first (default 100). */
  order?: number;
  /** Text or a JSON-serializable value; `undefined` / `null` / empty string skips the section. */
  provide: (context: TContext) => unknown | Promise<unknown>;
}

const CONTEXT_NAME_PATTERN = /^[a-z0-9_.-]{1,64}$/i;

export class AgentContextRegistry<TContext = unknown> {
  private readonly providers = new Map<string, AgentContextProvider<TContext>>();

  register(provider: AgentContextProvider<TContext>): () => void {
    if (!provider || typeof provider.provide !== 'function') {
      throw new AgentHarnessConfigError('Context providers need a provide function');
    }

    if (typeof provider.name !== 'string' || !CONTEXT_NAME_PATTERN.test(provider.name)) {
      throw new AgentHarnessConfigError(`Context provider name '${provider.name}' must match ^[a-z0-9_.-]{1,64}$`);
    }

    if (this.providers.has(provider.name)) {
      throw new AgentHarnessConfigError(`A context provider named '${provider.name}' is already registered`);
    }

    this.providers.set(provider.name, provider);

    return () => {
      if (this.providers.get(provider.name) === provider) {
        this.providers.delete(provider.name);
      }
    };
  }

  unregister(name: string): boolean {
    return this.providers.delete(name);
  }

  list(): AgentContextProvider<TContext>[] {
    return [...this.providers.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /**
   * Renders all sections (registered providers, then per-turn extras). Failing providers are skipped and reported via
   * `onError`, so one broken provider never blocks a turn.
   */
  async render(
    context: TContext,
    extra: Record<string, unknown> = {},
    onError?: (error: unknown, provider: string) => void,
  ): Promise<string> {
    const sections: string[] = [];

    for (const provider of this.list()) {
      try {
        const section = renderSection(provider.name, await provider.provide(context));

        if (section) {
          sections.push(section);
        }
      } catch (error) {
        onError?.(error, provider.name);
      }
    }

    for (const [name, value] of Object.entries(extra)) {
      if (!CONTEXT_NAME_PATTERN.test(name)) {
        throw new AgentHarnessConfigError(`Context section name '${name}' must match ^[a-z0-9_.-]{1,64}$`);
      }

      const section = renderSection(name, value);

      if (section) {
        sections.push(section);
      }
    }

    const rendered = sections.join('\n\n');

    if (rendered.length > AGENT_HARNESS_CONTEXT_MAX_CHARS) {
      return `${rendered.slice(0, AGENT_HARNESS_CONTEXT_MAX_CHARS - 40)}\n…[context truncated]`;
    }

    return rendered;
  }
}

/** Neutralizes section delimiters inside values so context text cannot close or forge a section. */
export function escapeContextText(text: string): string {
  return text.replace(/<(\/?)(context)/gi, '<$1​$2');
}

export function renderSection(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  let text: string;

  if (typeof value === 'string') {
    text = value.trim();
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? '';
    } catch {
      return undefined;
    }
  }

  if (!text) {
    return undefined;
  }

  return `<context name="${name}">\n${escapeContextText(text)}\n</context>`;
}

/** Delimiters of the harness instructions inside the persisted user turn (stripped again by `history()`). */
export const AGENT_HARNESS_INSTRUCTIONS_OPEN = '<harness_instructions>';
export const AGENT_HARNESS_INSTRUCTIONS_CLOSE = '</harness_instructions>';

/** Wraps instructions in the harness delimiters; delimiters inside the text are neutralized. */
export function wrapHarnessInstructions(text: string): string {
  const safe = text.replace(/<(\/?)(harness_instructions)/gi, '<$1\u200b$2');

  return `${AGENT_HARNESS_INSTRUCTIONS_OPEN}\n${safe}\n${AGENT_HARNESS_INSTRUCTIONS_CLOSE}`;
}

/**
 * The user's own text of a persisted user turn: Agenstra stores the turn's instructions in front of the message, so
 * a leading harness instructions block is removed (end users never see the application's instructions or context).
 */
export function stripHarnessInstructions(text: string): string {
  if (!text.startsWith(AGENT_HARNESS_INSTRUCTIONS_OPEN)) {
    return text;
  }

  const end = text.indexOf(AGENT_HARNESS_INSTRUCTIONS_CLOSE);

  return end < 0 ? text : text.slice(end + AGENT_HARNESS_INSTRUCTIONS_CLOSE.length).replace(/^\s+/, '');
}
