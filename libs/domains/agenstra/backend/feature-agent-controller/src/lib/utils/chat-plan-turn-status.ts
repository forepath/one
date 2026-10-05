import {
  isAgenstraPlanTurnStatus,
  parseAgenstraPlanTurnStatus,
  type AgenstraPlanTurnStatusPayload,
} from '@forepath/agenstra/shared/util-opencode-config';

export type { AgenstraPlanTurnStatusPayload };

/**
 * Extract plan turn status from a chatMessage envelope, chatEvent payload, or agent response object.
 */
export function extractPlanTurnStatus(payload: unknown): AgenstraPlanTurnStatusPayload | undefined {
  if (!payload || typeof payload !== 'object') {
    if (typeof payload === 'string') {
      return parsePlanTurnStatusFromAssistantText(payload);
    }

    return undefined;
  }

  const envelope = payload as {
    success?: boolean;
    data?: { from?: string; response?: unknown; kind?: string; payload?: unknown };
    planTurnStatus?: unknown;
  };

  if (envelope.planTurnStatus !== undefined) {
    return parseAgenstraPlanTurnStatus(envelope.planTurnStatus);
  }

  const data = envelope.data;

  if (data && typeof data === 'object') {
    const eventPayload = (data as { payload?: unknown }).payload;

    if (eventPayload !== undefined) {
      const fromEvent =
        typeof eventPayload === 'string'
          ? parsePlanTurnStatusFromAssistantText(eventPayload)
          : parseAgenstraPlanTurnStatus(eventPayload);

      if (fromEvent) {
        return fromEvent;
      }
    }
  }

  const response = envelope.data?.response ?? envelope;

  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const record = response as Record<string, unknown>;

  if (record['planTurnStatus'] !== undefined) {
    return parseAgenstraPlanTurnStatus(record['planTurnStatus']);
  }

  if (record['status'] !== undefined && isAgenstraPlanTurnStatus(record['status'])) {
    return parseAgenstraPlanTurnStatus(record);
  }

  if (record['type'] === 'result' && record['result'] !== undefined) {
    if (typeof record['result'] === 'string') {
      return parsePlanTurnStatusFromAssistantText(record['result']);
    }

    return parseAgenstraPlanTurnStatus(record['result']);
  }

  if (record['type'] === 'agenstra_turn' && Array.isArray(record['parts'])) {
    for (const part of record['parts']) {
      const status = extractPlanTurnStatus(part);

      if (status) {
        return status;
      }
    }
  }

  return undefined;
}

/**
 * Parse plan turn status from free-form assistant text.
 * Handles pure JSON, embedded JSON, and YAML-ish `status` / `planMarkdown` blocks LLMs often emit.
 */
export function parsePlanTurnStatusFromAssistantText(text: string): AgenstraPlanTurnStatusPayload | undefined {
  const trimmed = text.trim();

  if (!trimmed) {
    return undefined;
  }

  const asStructured = parseAgenstraPlanTurnStatus(trimmed);

  if (asStructured?.planMarkdown || asStructured?.summary) {
    return asStructured;
  }

  const embeddedJson = extractEmbeddedPlanStatusJson(trimmed);

  if (embeddedJson) {
    return embeddedJson;
  }

  return extractYamlishPlanTurnStatus(trimmed) ?? asStructured;
}

/**
 * Prefer structured planMarkdown; otherwise extract it from assistant text.
 * Never persist preamble / `status:` wrappers as the plan body.
 */
export function resolvePlanMarkdownFromTurn(
  text: string,
  turnStatus: AgenstraPlanTurnStatusPayload | undefined,
): string | null {
  if (turnStatus?.planMarkdown && turnStatus.planMarkdown.trim()) {
    return sanitizePlanMarkdown(turnStatus.planMarkdown);
  }

  const fromText = parsePlanTurnStatusFromAssistantText(text);

  if (fromText?.planMarkdown && fromText.planMarkdown.trim()) {
    return sanitizePlanMarkdown(fromText.planMarkdown);
  }

  // Streaming drafts may only have the planMarkdown block so far (no status yet).
  const blockOnly = extractPlanMarkdownBlock(text);

  if (blockOnly) {
    return sanitizePlanMarkdown(blockOnly);
  }

  return null;
}

function extractEmbeddedPlanStatusJson(text: string): AgenstraPlanTurnStatusPayload | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    const parsed = parseAgenstraPlanTurnStatus(fenced[1].trim());

    if (parsed) {
      return parsed;
    }
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start >= 0 && end > start) {
    const parsed = parseAgenstraPlanTurnStatus(text.slice(start, end + 1));

    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

function extractYamlishPlanTurnStatus(text: string): AgenstraPlanTurnStatusPayload | undefined {
  const statusMatch = text.match(/\bstatus:\s*(ready|exploring)\b/i);
  const status = statusMatch?.[1]?.toLowerCase();
  const planMarkdown = extractPlanMarkdownBlock(text);
  const summaryMatch = text.match(/(?:^|\n)summary:\s*([^\n]+)/i);
  const summary = summaryMatch?.[1]?.trim();

  if (!status && !planMarkdown) {
    return undefined;
  }

  if (status && isAgenstraPlanTurnStatus(status)) {
    return {
      status,
      ...(planMarkdown ? { planMarkdown } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  if (planMarkdown) {
    // Block present without an explicit status — treat as draft plan content.
    return { status: 'exploring', planMarkdown, ...(summary ? { summary } : {}) };
  }

  return undefined;
}

/**
 * Extract the planMarkdown field body from YAML-ish assistant output.
 */
export function extractPlanMarkdownBlock(text: string): string | null {
  const pipeMatch = text.match(/\bplanMarkdown:\s*\|\s*\n([\s\S]*)$/i);

  if (pipeMatch?.[1] !== undefined) {
    return trimPlanMarkdownBody(pipeMatch[1]);
  }

  const quotedMatch = text.match(/\bplanMarkdown:\s*["']([\s\S]*?)["']\s*(?=\n(?:status|summary)\s*:|$)/i);

  if (quotedMatch?.[1] !== undefined) {
    return trimPlanMarkdownBody(quotedMatch[1]);
  }

  const plainMatch = text.match(/\bplanMarkdown:\s*([\s\S]+?)(?:\n(?:status|summary)\s*:|$)/i);

  if (plainMatch?.[1] !== undefined) {
    const body = trimPlanMarkdownBody(plainMatch[1]);

    // Avoid treating a lone `|` marker as content.
    if (body && body !== '|') {
      return body;
    }
  }

  return null;
}

function trimPlanMarkdownBody(value: string): string | null {
  let body = value
    .replace(/^\s*\n/, '')
    .replace(/\n(?:status|summary)\s*:[\s\S]*$/i, '')
    .trim();

  // Drop a leading `|` when the model put the chomp marker on its own line.
  if (body.startsWith('|')) {
    body = body.replace(/^\|\s*\n?/, '').trim();
  }

  return body.length > 0 ? body : null;
}

function sanitizePlanMarkdown(value: string): string {
  let body = value.trim();

  // Structured payloads sometimes embed the full YAML-ish turn (preamble + wrappers)
  // inside planMarkdown. Peel nested planMarkdown blocks until stable.
  for (let i = 0; i < 3; i += 1) {
    const nested = extractPlanMarkdownBlock(body);

    if (!nested || nested === body) {
      break;
    }

    body = nested;
  }

  return body
    .replace(/^\s*status:\s*(ready|exploring)\s*$/gim, '')
    .replace(/^\s*planMarkdown:\s*\|?\s*$/gim, '')
    .replace(/^\s*summary:\s*.*$/gim, '')
    .trim();
}
