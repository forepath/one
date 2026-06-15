import type { AgentResponseObject } from '@forepath/agenstra/frontend/data-access-agent-console';

const MAX_INLINE_STRING = 8000;

function truncate(str: string, max = MAX_INLINE_STRING): string {
  if (str.length <= max) {
    return str;
  }

  return `${str.slice(0, max - 1)}…`;
}

/**
 * Renders unknown JSON-like values as compact Markdown bullets (no fenced code blocks).
 */
export function formatUnknownAsMarkdown(value: unknown, depth = 0): string {
  if (depth > 6) {
    return '_…_';
  }

  if (value === null || value === undefined) {
    return '_—_';
  }

  if (typeof value === 'string') {
    return truncate(value.replace(/\r\n/g, '\n'));
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '_empty list_';
    }

    return value.map((v) => `- ${formatUnknownAsMarkdown(v, depth + 1)}`).join('\n');
  }

  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);

    if (keys.length === 0) {
      return '_empty object_';
    }

    return keys.map((k) => `- **${k}**: ${formatUnknownAsMarkdown(o[k], depth + 1)}`).join('\n');
  }

  return String(value);
}

function strProp(obj: AgentResponseObject, key: string): string | undefined {
  const v = obj[key];

  return typeof v === 'string' ? v : undefined;
}

/**
 * Best-effort text from Cursor/producer `thinking` frames (and our unified `{ type: 'thinking' }` parts).
 * Used for timeline rows and plain markdown (avoids `formatUnknownAsMarkdown` bullet lists).
 */
export function extractThinkingPreviewText(response: AgentResponseObject): string {
  const o = response as Record<string, unknown>;
  const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const direct =
    pick(o['text']) ||
    pick(o['thinking']) ||
    pick(o['phase']) ||
    pick(o['summary']) ||
    pick(o['message']) ||
    pick(o['delta']);

  if (direct) {
    return direct;
  }

  const msg = o['message'];

  if (msg && typeof msg === 'object') {
    const content = (msg as { content?: unknown }).content;

    if (Array.isArray(content)) {
      const joined = content
        .map((part) => {
          if (!part || typeof part !== 'object') {
            return '';
          }

          const p = part as { type?: unknown; text?: unknown };

          return p.type === 'text' && typeof p.text === 'string' ? p.text : '';
        })
        .join('');

      if (joined.trim()) {
        return joined.trim();
      }
    }
  }

  return '';
}

/**
 * Best-effort text from `interaction_query` / provider clarification frames.
 */
export function extractInteractionQueryPreviewText(response: AgentResponseObject): string {
  const o = response as Record<string, unknown>;
  const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  return (
    pick(o['query']) ||
    pick(o['prompt']) ||
    pick(o['question']) ||
    pick(o['text']) ||
    pick(o['message']) ||
    pick(o['summary']) ||
    pick(o['delta']) ||
    ''
  );
}

function unknownProp(obj: AgentResponseObject, key: string): unknown {
  return obj[key];
}

function formatToolCall(response: AgentResponseObject): string {
  const name = strProp(response, 'name') ?? 'tool';
  const toolCallId = strProp(response, 'toolCallId');
  const status = strProp(response, 'status') ?? 'unknown';
  const args = unknownProp(response, 'args');
  const lines: string[] = [];

  lines.push(`**Tool call** · \`${name}\` · ${status}`);

  if (toolCallId) {
    lines.push('');
    lines.push(`ID: \`${toolCallId}\``);
  }

  if (args !== undefined) {
    lines.push('');
    lines.push(formatUnknownAsMarkdown(args));
  }

  return lines.join('\n');
}

function formatToolResult(response: AgentResponseObject): string {
  const name = strProp(response, 'name') ?? 'tool';
  const toolCallId = strProp(response, 'toolCallId');
  const isError = Boolean(response['isError']);
  const result = unknownProp(response, 'result');
  const lines: string[] = [];

  lines.push(`**Tool result** · \`${name}\` · ${isError ? '_failed_' : '_success_'}`);

  if (toolCallId) {
    lines.push('');
    lines.push(`ID: \`${toolCallId}\``);
  }

  lines.push('');
  lines.push(formatUnknownAsMarkdown(result));

  return lines.join('\n');
}

function formatQuestion(response: AgentResponseObject): string {
  const prompt = strProp(response, 'prompt') ?? '';
  const questionId = strProp(response, 'questionId');
  const options = unknownProp(response, 'options');
  const lines: string[] = [];

  lines.push('**Question**');

  if (questionId) {
    lines.push('');
    lines.push(`ID: \`${questionId}\``);
  }

  lines.push('');
  lines.push(prompt || '_—_');

  if (Array.isArray(options) && options.length > 0) {
    lines.push('');
    lines.push('**Options**');

    for (const opt of options) {
      if (opt && typeof opt === 'object') {
        const o = opt as Record<string, unknown>;
        const id = typeof o['id'] === 'string' ? o['id'] : '';
        const label = typeof o['label'] === 'string' ? o['label'] : formatUnknownAsMarkdown(opt);

        lines.push(`- \`${id}\` — ${label}`);
      } else {
        lines.push(`- ${formatUnknownAsMarkdown(opt)}`);
      }
    }
  }

  const allowMultiple = response['allowMultiple'];

  if (typeof allowMultiple === 'boolean' && allowMultiple) {
    lines.push('');
    lines.push('_Multiple choice allowed._');
  }

  return lines.join('\n');
}

function formatDelta(response: AgentResponseObject): string {
  const delta = strProp(response, 'delta');

  return delta ?? '_—_';
}

function formatError(response: AgentResponseObject): string {
  const msg =
    strProp(response, 'message') ??
    (typeof response['result'] === 'string' ? (response['result'] as string) : undefined) ??
    'Error';
  const code = strProp(response, 'code');
  const details = strProp(response, 'details');
  const lines: string[] = ['**Error**', '', truncate(msg)];

  if (code) {
    lines.push('');
    lines.push(`Code: \`${code}\``);
  }

  if (details) {
    lines.push('');
    lines.push(truncate(details));
  }

  return lines.join('\n');
}

function formatInteractionQuery(response: AgentResponseObject): string {
  const preview = extractInteractionQueryPreviewText(response);

  return preview ? truncate(preview.replace(/\s+/g, ' ')) : '_Query…_';
}

function formatGenericResult(response: AgentResponseObject): string {
  const result = response['result'];

  if (typeof result === 'string') {
    return result;
  }

  if (result === undefined || result === null) {
    const t = strProp(response, 'type') ?? 'response';
    const rest = Object.fromEntries(
      Object.entries(response as Record<string, unknown>).filter(([key]) => key !== 'type' && key !== 'subtype'),
    );
    const keys = Object.keys(rest);

    if (keys.length === 0) {
      return `_(${t})_`;
    }

    return `**${t}**\n\n${formatUnknownAsMarkdown(rest)}`;
  }

  if (typeof result === 'object') {
    return formatUnknownAsMarkdown(result);
  }

  return String(result);
}

/**
 * Turns a persisted or live agent `response` into Markdown suitable for `marked` + sanitization.
 * Avoids raw JSON code fences except when the payload is fundamentally unparsed text.
 */
export function formatAgentResponseForChatMarkdown(response: AgentResponseObject | string): string {
  if (typeof response === 'string') {
    const trimmed = response.trim();

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as AgentResponseObject;

        return formatAgentResponseForChatMarkdown(parsed);
      } catch {
        return response;
      }
    }

    return response;
  }

  const type = strProp(response, 'type') ?? '';

  if (type === 'agenstra_turn' && Array.isArray(response['parts'])) {
    const parts = response['parts'] as AgentResponseObject[];

    return parts
      .map((p) => formatAgentResponseForChatMarkdown(p))
      .filter((s) => s.trim().length > 0)
      .join('\n\n');
  }

  if (type === 'tool_call' || type === 'tool' || type === 'toolCall') {
    return formatToolCall(response);
  }

  if (type === 'tool_result' || type === 'toolResult') {
    return formatToolResult(response);
  }

  if (type === 'question') {
    return formatQuestion(response);
  }

  if (type === 'delta') {
    return formatDelta(response);
  }

  if (type === 'interaction_query' || type === 'interactionQuery') {
    return formatInteractionQuery(response);
  }

  if (type === 'thinking') {
    const t = extractThinkingPreviewText(response);

    return t ? truncate(t.replace(/\s+/g, ' ')) : 'Thinking…';
  }

  if (type === 'error' || response.is_error === true) {
    return formatError(response);
  }

  if (type === 'result' || type === 'assistantMessage') {
    return formatGenericResult(response);
  }

  return formatGenericResult(response);
}
