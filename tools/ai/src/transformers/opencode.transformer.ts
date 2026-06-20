import type { AgenstraAgent, AgenstraContext, AgenstraSubagent, ToolOutput } from '../types';

import { BaseTransformer } from './base.transformer';

const OPENCODE_DIR = '.opencode';

/**
 * Escape for YAML frontmatter (quote if contains colon or newline).
 */
function yamlValue(s: string): string {
  if (/[:#\n[\]{}]/.test(s)) return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

  return s;
}

/**
 * Build OpenCode command .md with YAML frontmatter (description, agent, model) and template body.
 * @see https://opencode.ai/docs/commands/
 */
function commandToMarkdown(id: string, cmd: Record<string, unknown>): string {
  const description = (cmd.description as string) ?? (cmd.name as string) ?? id;
  const prompt = (cmd.prompt as string) ?? '';
  const agent = (cmd.agent as string) ?? undefined;
  const model = (cmd.model as string) ?? undefined;
  const lines = ['---', `description: ${yamlValue(description)}`];

  if (agent) lines.push(`agent: ${agent}`);

  if (model) lines.push(`model: ${model}`);

  lines.push('---', '');
  lines.push(prompt || 'Run this command as described.');

  return lines.join('\n');
}

/**
 * Build OpenCode agent .md with YAML frontmatter (description, mode, model, temperature, tools) and prompt body.
 * Uses MDC body when present; otherwise description. Emits tools object for OpenCode per https://opencode.ai/docs/agents/#markdown
 */
function agentToOpenCodeMd(id: string, config: AgenstraAgent | AgenstraSubagent): string {
  const description = config.description ?? config.name ?? id;
  const mode = (config.mode as string) ?? 'subagent';
  const temperature = config.temperature ?? undefined;
  const model = config.model;
  const bodyContent = (config.body as string)?.trim() ?? description;
  const lines = ['---', `description: ${yamlValue(description)}`, `mode: ${mode}`];

  if (model) lines.push(`model: ${model}`);

  if (temperature != null) lines.push(`temperature: ${temperature}`);

  const tools = config.tools;

  if (tools !== undefined && typeof tools === 'object' && tools !== null) {
    lines.push('tools:');

    for (const [k, v] of Object.entries(tools)) {
      lines.push(`  ${k}: ${v}`);
    }
  }

  lines.push('---', '');
  lines.push(bodyContent || 'Execute tasks according to the agent configuration.');

  return lines.join('\n');
}

export class OpenCodeTransformer extends BaseTransformer {
  readonly name = 'opencode' as const;

  canUseComponent(): boolean {
    return true;
  }

  transform(context: AgenstraContext): ToolOutput {
    const out = new Map<string, string>();

    // OpenCode AGENTS.md = aggregated rules (instructions for the LLM), not agent definitions
    // @see https://opencode.ai/docs/rules/
    out.set('AGENTS.md', buildRulesAggregate(context));

    for (const [id, cmd] of Object.entries(context.commands)) {
      out.set(`${OPENCODE_DIR}/commands/${id}.md`, commandToMarkdown(id, cmd));
    }

    const allAgents = { ...context.agents, ...context.subagents };

    for (const [id, config] of Object.entries(allAgents)) {
      out.set(`${OPENCODE_DIR}/agents/${id}.md`, agentToOpenCodeMd(id, config));
    }

    const opencodeJson = buildOpencodeJson(context);

    out.set('opencode.json', JSON.stringify(opencodeJson, null, 2));

    return out;
  }
}

/**
 * Aggregate .agenstra rules into OpenCode AGENTS.md (instructions for the LLM).
 * @see https://opencode.ai/docs/rules/ - AGENTS.md contains project-specific instructions
 */
function buildRulesAggregate(context: AgenstraContext): string {
  const parts: string[] = [];

  for (const [name, entry] of Object.entries(context.rules)) {
    if (name.startsWith('_')) continue;

    const content = typeof entry === 'string' ? entry : entry.content;
    const title = name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    parts.push(`## ${title}\n\n`, content.trim(), '\n\n');
  }

  if (parts.length === 0) {
    return '# Project instructions\n\nGenerated from .agenstra rules. Add rules in .agenstra/rules/ to customize.\n';
  }

  return '# Project instructions\n\n' + parts.join('');
}

/**
 * Map .agenstra MCP definition to OpenCode mcp entry.
 * OpenCode uses top-level "mcp" object: { "name": { type, command?, environment?, url?, headers?, enabled? } }
 * @see https://opencode.ai/docs/mcp-servers/
 */
function toOpenCodeMcpEntry(def: Record<string, unknown>): Record<string, unknown> {
  const type = (def.type as string) ?? (def.url ? 'remote' : 'local');
  const entry: Record<string, unknown> = { type };
  const command = def.command;
  const env = def.environment ?? def.env;
  const url = def.url;

  if (type === 'local' && Array.isArray(command) && command.length > 0) {
    entry.command = command;
  } else if (type === 'local' && typeof command === 'string') {
    const args = (def.args as string[] | undefined) ?? [];

    entry.command = [command, ...args];
  }

  if (env != null && typeof env === 'object' && !Array.isArray(env)) {
    entry.environment = env;
  }

  if (type === 'remote' && typeof url === 'string') {
    entry.url = url;

    if (def.headers != null && typeof def.headers === 'object') entry.headers = def.headers;
  }

  if (def.enabled !== undefined) entry.enabled = def.enabled;

  return entry;
}

function buildOpencodeJson(context: AgenstraContext): Record<string, unknown> {
  const mcp: Record<string, Record<string, unknown>> = {};

  for (const [id, def] of Object.entries(context.mcpDefinitions)) {
    const entry = toOpenCodeMcpEntry(def as Record<string, unknown>);

    if ((entry.type === 'local' && entry.command) || (entry.type === 'remote' && entry.url)) {
      mcp[id] = entry;
    }
  }

  return {
    $schema: 'https://opencode.ai/config.json',
    ...(Object.keys(mcp).length > 0 && { mcp }),
  };
}
