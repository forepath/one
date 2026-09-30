/**
 * Display-only structured views for known OpenCode tool calls.
 * Parsing is best-effort; unknown tools / malformed JSON yield `undefined` (JSON popover fallback).
 */

export const AGENT_CHAT_TOOL_EMBED_BODY_CHAR_LIMIT = 12_000;
export const AGENT_CHAT_TOOL_EMBED_LIST_CAP = 40;

export type AgentChatTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'unknown';

export interface AgentChatTodoEmbedItem {
  id: string;
  content: string;
  status: AgentChatTodoStatus;
}

export interface AgentChatGrepHitEmbed {
  path: string;
  line?: number;
  snippet: string;
}

export interface AgentChatWebSearchHitEmbed {
  title: string;
  url?: string;
  snippet?: string;
}

export type AgentChatDiffLineKind = 'add' | 'remove' | 'header' | 'context';

export interface AgentChatDiffLineEmbed {
  kind: AgentChatDiffLineKind;
  text: string;
}

export type AgentChatToolEmbedView =
  | {
      kind: 'todos';
      todos: AgentChatTodoEmbedItem[];
    }
  | {
      kind: 'bash';
      command: string;
      workdir?: string;
      output?: string;
      truncated: boolean;
      isError: boolean;
    }
  | {
      kind: 'read';
      filePath: string;
      offset?: number;
      limit?: number;
      content?: string;
      truncated: boolean;
    }
  | {
      kind: 'glob';
      pattern: string;
      path?: string;
      files: string[];
      truncated: boolean;
      total: number;
    }
  | {
      kind: 'grep';
      pattern: string;
      path?: string;
      include?: string;
      hits: AgentChatGrepHitEmbed[];
      truncated: boolean;
      total: number;
    }
  | {
      kind: 'edit';
      filePath: string;
      oldString?: string;
      newString?: string;
      content?: string;
      truncated: boolean;
    }
  | {
      kind: 'write';
      filePath: string;
      content?: string;
      truncated: boolean;
    }
  | {
      kind: 'patch';
      lines: AgentChatDiffLineEmbed[];
      truncated: boolean;
    }
  | {
      kind: 'webfetch';
      url: string;
      format?: string;
      body?: string;
      truncated: boolean;
      isError: boolean;
    }
  | {
      kind: 'websearch';
      query: string;
      hits: AgentChatWebSearchHitEmbed[];
      truncated: boolean;
      total: number;
      isError: boolean;
    }
  | {
      kind: 'task';
      description: string;
      prompt: string;
      subagentType: string;
      resultPreview?: string;
      truncated: boolean;
    }
  | {
      kind: 'skill';
      name: string;
      resultPreview?: string;
      truncated: boolean;
    }
  | {
      kind: 'invalid';
      tool: string;
      error: string;
    };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function truncateText(text: string, max = AGENT_CHAT_TOOL_EMBED_BODY_CHAR_LIMIT): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }

  return { text: `${text.slice(0, max)}\n…`, truncated: true };
}

/** Unwrap envelope (`payload`) or part root into a flat tool record. */
export function parseToolDetailRecord(detailJson: string | undefined): Record<string, unknown> | undefined {
  if (detailJson === undefined || detailJson.trim().length === 0) {
    return undefined;
  }

  try {
    const root = JSON.parse(detailJson) as unknown;
    let obj = asRecord(root);

    if (!obj) {
      return undefined;
    }

    // SuccessResponse / chatEvent wrappers: { success, data: envelope }
    const data = asRecord(obj['data']);

    if (data && typeof data['kind'] === 'string' && asRecord(data['payload'])) {
      obj = data;
    }

    // Unwrap nested `payload` until tool fields appear (envelope → tool payload).
    for (let depth = 0; depth < 3; depth++) {
      const nested = asRecord(obj['payload']);

      if (!nested) {
        break;
      }

      const nestedLooksLikeTool =
        nested['args'] !== undefined ||
        nested['input'] !== undefined ||
        nested['rawInput'] !== undefined ||
        nested['result'] !== undefined ||
        nested['output'] !== undefined ||
        typeof nested['name'] === 'string' ||
        typeof nested['tool'] === 'string' ||
        typeof nested['toolCallId'] === 'string';

      if (!nestedLooksLikeTool) {
        break;
      }

      obj = {
        ...pickExisting(obj, [
          'name',
          'args',
          'input',
          'rawInput',
          'result',
          'output',
          'isError',
          'is_error',
          'status',
          'toolCallId',
          'title',
        ]),
        ...nested,
      };
    }

    return obj;
  } catch {
    return undefined;
  }
}

function pickExisting(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const key of keys) {
    if (source[key] !== undefined && out[key] === undefined) {
      out[key] = source[key];
    }
  }

  return out;
}

const TOOL_ARG_KEYS = [
  'command',
  'cmd',
  'workdir',
  'cwd',
  'timeout',
  'filePath',
  'file_path',
  'path',
  'file',
  'offset',
  'limit',
  'pattern',
  'glob',
  'include',
  'query',
  'q',
  'search',
  'url',
  'format',
  'patchText',
  'patch',
  'content',
  'contents',
  'oldString',
  'old_string',
  'newString',
  'new_string',
  'todos',
  'description',
  'prompt',
  'subagent_type',
  'subagentType',
  'agent',
  'name',
  'skill',
  'tool',
  'error',
] as const;

function coerceArgsRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const asObj = asRecord(value);

  if (asObj) {
    return asObj;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const parsedObj = asRecord(parsed);

        if (parsedObj) {
          return parsedObj;
        }
      } catch {
        // Treat as a bare shell command / path string below.
      }
    }

    // ACP sometimes sets rawInput to a bare command string.
    return { command: trimmed };
  }

  return undefined;
}

function extractArgs(record: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!record) {
    return {};
  }

  const fromArgs =
    coerceArgsRecord(record['args']) ?? coerceArgsRecord(record['input']) ?? coerceArgsRecord(record['rawInput']) ?? {};

  // Some payloads flatten tool fields onto the envelope/part root.
  const fromTop: Record<string, unknown> = {};

  for (const key of TOOL_ARG_KEYS) {
    if (record[key] !== undefined && fromArgs[key] === undefined) {
      fromTop[key] = record[key];
    }
  }

  return { ...fromTop, ...fromArgs };
}

function extractResult(record: Record<string, unknown> | undefined): unknown {
  if (!record) {
    return undefined;
  }

  if (record['result'] !== undefined) {
    return record['result'];
  }

  if (record['output'] !== undefined) {
    return record['output'];
  }

  if (record['rawOutput'] !== undefined) {
    return record['rawOutput'];
  }

  return undefined;
}

function mergeArgSources(
  call: Record<string, unknown> | undefined,
  resultRec: Record<string, unknown> | undefined,
): Record<string, unknown> {
  // Call args win; result may carry input when the provider only emitted tool_result.
  return {
    ...extractArgs(resultRec),
    ...extractArgs(call),
  };
}

function resultIsError(
  call: Record<string, unknown> | undefined,
  result: Record<string, unknown> | undefined,
): boolean {
  for (const rec of [result, call]) {
    if (!rec) {
      continue;
    }

    if (rec['isError'] === true || rec['is_error'] === true) {
      return true;
    }
  }

  return false;
}

function coerceResultText(result: unknown): string {
  if (result === undefined || result === null) {
    return '';
  }

  if (typeof result === 'string') {
    return result;
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function normalizeTodoStatus(raw: unknown): AgentChatTodoStatus {
  const s = typeof raw === 'string' ? raw.toLowerCase().replace(/-/g, '_') : '';

  if (s === 'pending' || s === 'in_progress' || s === 'completed' || s === 'cancelled') {
    return s;
  }

  if (s === 'complete' || s === 'done') {
    return 'completed';
  }

  if (s === 'canceled') {
    return 'cancelled';
  }

  if (s === 'inprogress' || s === 'running') {
    return 'in_progress';
  }

  return 'unknown';
}

function normalizeTodoItems(raw: unknown): AgentChatTodoEmbedItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }

  const todos: AgentChatTodoEmbedItem[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const rec = asRecord(item);

    if (!rec) {
      continue;
    }

    const content = asString(rec['content']) ?? asString(rec['title']) ?? asString(rec['text']) ?? '';

    if (!content.trim()) {
      continue;
    }

    todos.push({
      id: asString(rec['id']) ?? `todo-${i}`,
      content: content.trim(),
      status: normalizeTodoStatus(rec['status']),
    });
  }

  return todos.length > 0 ? todos : undefined;
}

/** Parses OpenCode status checklist lines: `[~] Scan auth (high)`. */
function parseTodosFromChecklistText(text: string | undefined): AgentChatTodoEmbedItem[] | undefined {
  if (!text?.trim()) {
    return undefined;
  }

  const todos: AgentChatTodoEmbedItem[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    const match = /^\[([ xX~\-✓✗•]|in_progress|pending|completed|cancelled|canceled)\]\s+(.+)$/i.exec(line);

    if (!match) {
      continue;
    }

    const mark = (match[1] ?? '').trim().toLowerCase();
    let content = (match[2] ?? '').trim();

    // Drop trailing `(priority)` from status mapper lines.
    content = content.replace(/\s*\((high|medium|low)\)\s*$/i, '').trim();

    if (!content) {
      continue;
    }

    let status: AgentChatTodoStatus = 'pending';

    if (mark === 'x' || mark === '✓' || mark === 'completed' || mark === 'done') {
      status = 'completed';
    } else if (mark === '~' || mark === '•' || mark === 'in_progress' || mark === 'running') {
      status = 'in_progress';
    } else if (mark === '-' || mark === '✗' || mark === 'cancelled' || mark === 'canceled') {
      status = 'cancelled';
    } else if (mark === '' || mark === ' ' || mark === 'pending') {
      status = 'pending';
    } else {
      status = normalizeTodoStatus(mark);
    }

    todos.push({
      id: `todo-line-${i}`,
      content,
      status,
    });
  }

  return todos.length > 0 ? todos : undefined;
}

function parseTodosFromArgsOrResult(
  args: Record<string, unknown>,
  result: unknown,
): AgentChatTodoEmbedItem[] | undefined {
  const fromArgs = normalizeTodoItems(args['todos'] ?? args['items']);
  const resultObj = asRecord(result);
  const fromResult =
    normalizeTodoItems(resultObj?.['todos'] ?? resultObj?.['items']) ??
    normalizeTodoItems(Array.isArray(result) ? result : undefined);

  return fromArgs ?? fromResult ?? parseTodosFromChecklistText(coerceResultText(result));
}

function collectTodosFromRecord(record: Record<string, unknown> | undefined): AgentChatTodoEmbedItem[] | undefined {
  if (!record) {
    return undefined;
  }

  const direct =
    normalizeTodoItems(record['todos']) ??
    normalizeTodoItems(record['items']) ??
    normalizeTodoItems(asRecord(record['args'])?.['todos']) ??
    normalizeTodoItems(asRecord(record['input'])?.['todos']);

  if (direct) {
    return direct;
  }

  const message = asString(record['message']) ?? asString(record['result']) ?? asString(record['output']) ?? undefined;

  return parseTodosFromChecklistText(message);
}

/**
 * Builds a todos embed from a status / tool detail JSON blob (structured `todos` or checklist text).
 */
export function buildTodosEmbedFromDetail(
  detailJson?: string,
  fallbackText?: string,
): AgentChatToolEmbedView | undefined {
  const root = parseToolDetailRecord(detailJson);
  let todos = collectTodosFromRecord(root);

  if (!todos) {
    // Status envelopes: { kind: 'status', payload: { todos, message } } — payload may not look like a tool.
    try {
      const parsed = detailJson?.trim() ? (JSON.parse(detailJson) as unknown) : undefined;
      const obj = asRecord(parsed);
      const payload = asRecord(obj?.['payload']) ?? asRecord(asRecord(obj?.['data'])?.['payload']);

      todos = collectTodosFromRecord(payload) ?? collectTodosFromRecord(obj);
    } catch {
      // ignore
    }
  }

  todos = todos ?? parseTodosFromChecklistText(fallbackText);

  return todos ? { kind: 'todos', todos } : undefined;
}

/**
 * Resolves a structured embed for a chat display row (tool pair and/or Todos status).
 */
export function buildChatRowEmbedView(row: {
  kind?: string;
  toolName?: string;
  summaryTitle?: string;
  summaryBody?: string;
  detailJson?: string;
  toolPair?: { callDetailJson?: string; resultDetailJson?: string };
}): AgentChatToolEmbedView | undefined {
  if (row.toolPair) {
    const fromTool = buildToolEmbedView(row.toolName, row.toolPair.callDetailJson, row.toolPair.resultDetailJson);

    if (fromTool) {
      return fromTool;
    }
  }

  const title = (row.summaryTitle ?? '').trim().toLowerCase();
  const isTodosStatus = row.kind === 'status' && (title === 'todos' || title === 'todo');

  if (isTodosStatus) {
    return buildTodosEmbedFromDetail(row.detailJson, row.summaryBody);
  }

  // Tool pair present but unparsed todowrite — try checklist / todos on the detail blobs.
  const toolName = normalizeToolName(row.toolName ?? '');

  if (
    toolName === 'todowrite' ||
    toolName === 'todoread' ||
    toolName === 'todo_write' ||
    toolName === 'todo_read' ||
    toolName === 'todos'
  ) {
    return (
      buildTodosEmbedFromDetail(row.toolPair?.callDetailJson, row.summaryBody) ??
      buildTodosEmbedFromDetail(row.toolPair?.resultDetailJson, row.summaryBody) ??
      buildTodosEmbedFromDetail(row.detailJson, row.summaryBody)
    );
  }

  return undefined;
}

function parsePathList(result: unknown): string[] {
  if (typeof result === 'string') {
    return result
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('('));
  }

  if (Array.isArray(result)) {
    return result
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        const rec = asRecord(item);

        return asString(rec?.['path']) ?? asString(rec?.['file']) ?? asString(rec?.['name']) ?? '';
      })
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const obj = asRecord(result);
  const files = obj?.['files'] ?? obj?.['paths'] ?? obj?.['matches'];

  if (Array.isArray(files)) {
    return parsePathList(files);
  }

  return [];
}

function parseGrepHits(result: unknown): AgentChatGrepHitEmbed[] {
  if (typeof result === 'string') {
    const hits: AgentChatGrepHitEmbed[] = [];

    for (const line of result.split('\n')) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      // path:line:snippet or path:snippet
      const m = /^(.+?):(\d+):(.*)$/.exec(trimmed);

      if (m) {
        hits.push({ path: m[1] ?? '', line: Number(m[2]), snippet: (m[3] ?? '').trim() });
        continue;
      }

      const m2 = /^(.+?):\s*(.*)$/.exec(trimmed);

      if (m2) {
        hits.push({ path: m2[1] ?? '', snippet: (m2[2] ?? '').trim() });
        continue;
      }

      hits.push({ path: trimmed, snippet: '' });
    }

    return hits;
  }

  if (Array.isArray(result)) {
    const hits: AgentChatGrepHitEmbed[] = [];

    for (const item of result) {
      if (typeof item === 'string') {
        hits.push(...parseGrepHits(item));
        continue;
      }

      const rec = asRecord(item);

      if (!rec) {
        continue;
      }

      const path = asString(rec['path']) ?? asString(rec['file']) ?? asString(rec['filename']) ?? '';
      const snippet =
        asString(rec['snippet']) ??
        asString(rec['lineText']) ??
        asString(rec['text']) ??
        asString(rec['content']) ??
        '';
      const line = asNumber(rec['line']) ?? asNumber(rec['lineNumber']) ?? asNumber(rec['line_number']);

      if (path || snippet) {
        hits.push({ path: path || '—', line, snippet });
      }
    }

    return hits;
  }

  const obj = asRecord(result);
  const matches = obj?.['matches'] ?? obj?.['hits'] ?? obj?.['results'];

  if (matches !== undefined) {
    return parseGrepHits(matches);
  }

  return [];
}

function parseWebSearchHits(result: unknown): AgentChatWebSearchHitEmbed[] {
  if (typeof result === 'string') {
    try {
      return parseWebSearchHits(JSON.parse(result));
    } catch {
      return [{ title: result.slice(0, 200), snippet: result }];
    }
  }

  if (Array.isArray(result)) {
    const hits: AgentChatWebSearchHitEmbed[] = [];

    for (const item of result) {
      const rec = asRecord(item);

      if (!rec) {
        if (typeof item === 'string') {
          hits.push({ title: item });
        }

        continue;
      }

      hits.push({
        title: asString(rec['title']) ?? asString(rec['name']) ?? asString(rec['url']) ?? 'Result',
        url: asString(rec['url']) ?? asString(rec['link']),
        snippet: asString(rec['snippet']) ?? asString(rec['description']) ?? asString(rec['content']),
      });
    }

    return hits;
  }

  const obj = asRecord(result);
  const results = obj?.['results'] ?? obj?.['hits'] ?? obj?.['items'];

  if (results !== undefined) {
    return parseWebSearchHits(results);
  }

  return [];
}

export function parseUnifiedDiffLines(patchText: string): AgentChatDiffLineEmbed[] {
  const lines = patchText.replace(/\r\n/g, '\n').split('\n');
  const out: AgentChatDiffLineEmbed[] = [];

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('@@')) {
      out.push({ kind: 'header', text: line });
    } else if (line.startsWith('+')) {
      out.push({ kind: 'add', text: line });
    } else if (line.startsWith('-')) {
      out.push({ kind: 'remove', text: line });
    } else {
      out.push({ kind: 'context', text: line });
    }
  }

  return out;
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
}

/**
 * Builds a structured embed for a known OpenCode tool, or `undefined` to keep the JSON popover fallback.
 */
export function buildToolEmbedView(
  toolName: string | undefined,
  callDetailJson?: string,
  resultDetailJson?: string,
): AgentChatToolEmbedView | undefined {
  const call = parseToolDetailRecord(callDetailJson);
  const resultRec = parseToolDetailRecord(resultDetailJson);
  const resolvedName =
    (toolName && toolName.trim()) ||
    asString(call?.['name']) ||
    asString(call?.['tool']) ||
    asString(resultRec?.['name']) ||
    asString(resultRec?.['tool']) ||
    '';

  if (!resolvedName) {
    return undefined;
  }

  const name = normalizeToolName(resolvedName);

  if (name === 'question') {
    return undefined;
  }

  const args = mergeArgSources(call, resultRec);
  const result = extractResult(resultRec) ?? extractResult(call);
  const isError = resultIsError(call, resultRec);
  const title = asString(resultRec?.['title']) ?? asString(call?.['title']);

  switch (name) {
    case 'todowrite':
    case 'todoread':
    case 'todo_write':
    case 'todo_read':
    case 'todos': {
      const todos =
        parseTodosFromArgsOrResult(args, result) ??
        parseTodosFromChecklistText(title) ??
        parseTodosFromChecklistText(asString(call?.['message']) ?? asString(resultRec?.['message']));

      return todos ? { kind: 'todos', todos } : undefined;
    }

    case 'bash':
    case 'shell':
    case 'execute': {
      const command =
        asString(args['command']) ?? asString(args['cmd']) ?? (title && title !== name ? title : undefined);
      const outputRaw = coerceResultText(result);
      const { text: output, truncated } = truncateText(outputRaw);

      // Still render when we only have stdout/stderr (common when only tool_result was persisted).
      if (!command && !output) {
        return undefined;
      }

      return {
        kind: 'bash',
        command: command ?? name,
        workdir: asString(args['workdir']) ?? asString(args['cwd']),
        output: output.length > 0 ? output : undefined,
        truncated,
        isError,
      };
    }

    case 'read': {
      const filePath =
        asString(args['filePath']) ??
        asString(args['file_path']) ??
        asString(args['path']) ??
        asString(args['file']) ??
        (title && title.includes('/') ? title : undefined);
      const contentRaw = coerceResultText(result);
      const { text: content, truncated } = truncateText(contentRaw);

      if (!filePath && !content) {
        return undefined;
      }

      return {
        kind: 'read',
        filePath: filePath ?? 'file',
        offset: asNumber(args['offset']),
        limit: asNumber(args['limit']),
        content: content.length > 0 ? content : undefined,
        truncated,
      };
    }

    case 'glob': {
      const pattern = asString(args['pattern']) ?? asString(args['glob']) ?? '*';
      const all = parsePathList(result);
      const truncated = all.length > AGENT_CHAT_TOOL_EMBED_LIST_CAP;

      if (!asString(args['pattern']) && !asString(args['glob']) && all.length === 0) {
        return undefined;
      }

      return {
        kind: 'glob',
        pattern,
        path: asString(args['path']),
        files: all.slice(0, AGENT_CHAT_TOOL_EMBED_LIST_CAP),
        truncated,
        total: all.length,
      };
    }

    case 'grep':
    case 'search': {
      const pattern = asString(args['pattern']) ?? asString(args['query']) ?? asString(args['q']) ?? '';
      const all = parseGrepHits(result);
      const truncated = all.length > AGENT_CHAT_TOOL_EMBED_LIST_CAP;

      if (!pattern && all.length === 0) {
        return undefined;
      }

      return {
        kind: 'grep',
        pattern: pattern || (title ?? 'grep'),
        path: asString(args['path']),
        include: asString(args['include']),
        hits: all.slice(0, AGENT_CHAT_TOOL_EMBED_LIST_CAP),
        truncated,
        total: all.length,
      };
    }

    case 'edit':
    case 'str_replace':
    case 'strreplace': {
      const filePath =
        asString(args['filePath']) ?? asString(args['path']) ?? asString(args['file_path']) ?? asString(args['file']);

      if (!filePath) {
        return undefined;
      }

      const oldString = asString(args['oldString']) ?? asString(args['old_string']) ?? asString(args['oldText']);
      const newString = asString(args['newString']) ?? asString(args['new_string']) ?? asString(args['newText']);
      const contentRaw = oldString || newString ? '' : coerceResultText(result);
      const { text: content, truncated: contentTruncated } = truncateText(contentRaw);
      const oldT = oldString ? truncateText(oldString) : undefined;
      const newT = newString ? truncateText(newString) : undefined;

      return {
        kind: 'edit',
        filePath,
        oldString: oldT?.text,
        newString: newT?.text,
        content: content.length > 0 ? content : undefined,
        truncated: Boolean(oldT?.truncated || newT?.truncated || contentTruncated),
      };
    }

    case 'write': {
      const filePath =
        asString(args['filePath']) ?? asString(args['path']) ?? asString(args['file_path']) ?? asString(args['file']);

      if (!filePath) {
        return undefined;
      }

      const contentRaw = asString(args['content']) ?? asString(args['contents']) ?? coerceResultText(result);
      const { text: content, truncated } = truncateText(contentRaw);

      return {
        kind: 'write',
        filePath,
        content: content.length > 0 ? content : undefined,
        truncated,
      };
    }

    case 'apply_patch':
    case 'applypatch':
    case 'patch': {
      const patchText = asString(args['patchText']) ?? asString(args['patch']) ?? coerceResultText(result);

      if (!patchText.trim()) {
        return undefined;
      }

      const { text, truncated } = truncateText(patchText);

      return {
        kind: 'patch',
        lines: parseUnifiedDiffLines(text),
        truncated,
      };
    }

    case 'webfetch':
    case 'web_fetch': {
      const url = asString(args['url']);

      if (!url) {
        return undefined;
      }

      const bodyRaw = coerceResultText(result);
      const { text: body, truncated } = truncateText(bodyRaw);

      return {
        kind: 'webfetch',
        url,
        format: asString(args['format']),
        body: body.length > 0 ? body : undefined,
        truncated,
        isError,
      };
    }

    case 'websearch':
    case 'web_search': {
      const query =
        asString(args['query']) ?? asString(args['q']) ?? asString(args['search']) ?? asString(args['prompt']) ?? '';

      if (!query && result === undefined) {
        return undefined;
      }

      const all = parseWebSearchHits(result);
      const truncated = all.length > AGENT_CHAT_TOOL_EMBED_LIST_CAP;

      return {
        kind: 'websearch',
        query: query || 'Search',
        hits: all.slice(0, AGENT_CHAT_TOOL_EMBED_LIST_CAP),
        truncated,
        total: all.length,
        isError,
      };
    }

    case 'task':
    case 'subagent': {
      const description = asString(args['description']) ?? '';
      const prompt = asString(args['prompt']) ?? '';
      const subagentType =
        asString(args['subagent_type']) ?? asString(args['subagentType']) ?? asString(args['agent']) ?? 'task';

      if (!description && !prompt) {
        return undefined;
      }

      const resultRaw = coerceResultText(result);
      const { text: resultPreview, truncated } = truncateText(resultRaw, 2_000);

      return {
        kind: 'task',
        description: description || subagentType,
        prompt,
        subagentType,
        resultPreview: resultPreview.length > 0 ? resultPreview : undefined,
        truncated,
      };
    }

    case 'skill': {
      const skillName = asString(args['name']) ?? asString(args['skill']);

      if (!skillName) {
        return undefined;
      }

      const resultRaw = coerceResultText(result);
      const { text: resultPreview, truncated } = truncateText(resultRaw, 2_000);

      return {
        kind: 'skill',
        name: skillName,
        resultPreview: resultPreview.length > 0 ? resultPreview : undefined,
        truncated,
      };
    }

    case 'invalid': {
      const tool = asString(args['tool']) ?? 'unknown';
      const error = asString(args['error']) ?? (coerceResultText(result) || 'Invalid tool call');

      return {
        kind: 'invalid',
        tool,
        error,
      };
    }

    default:
      return undefined;
  }
}
