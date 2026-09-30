import {
  buildChatRowEmbedView,
  buildTodosEmbedFromDetail,
  buildToolEmbedView,
  parseToolDetailRecord,
  parseUnifiedDiffLines,
} from './agent-chat-tool-embed-view';

describe('agent-chat-tool-embed-view', () => {
  const callJson = (name: string, args: Record<string, unknown>): string =>
    JSON.stringify({
      kind: 'toolCall',
      payload: { toolCallId: 't1', name, status: 'completed', args },
    });

  const resultJson = (name: string, result: unknown, isError = false): string =>
    JSON.stringify({
      kind: 'toolResult',
      payload: { toolCallId: 't1', name, isError, result },
    });

  const partCallJson = (name: string, args: Record<string, unknown>): string =>
    JSON.stringify({ type: 'tool_call', name, toolCallId: 't1', status: 'completed', args });

  it('returns undefined for unknown tools and question', () => {
    expect(buildToolEmbedView('mystery', callJson('mystery', { x: 1 }))).toBeUndefined();
    expect(buildToolEmbedView('question', callJson('question', { questions: [] }))).toBeUndefined();
    expect(buildToolEmbedView(undefined)).toBeUndefined();
  });

  it('parses todowrite todos from args', () => {
    const view = buildToolEmbedView(
      'todowrite',
      callJson('todowrite', {
        todos: [
          { id: '1', content: 'Ship embeds', status: 'in_progress' },
          { id: '2', content: 'Write tests', status: 'pending' },
        ],
      }),
    );

    expect(view?.kind).toBe('todos');
    if (view?.kind === 'todos') {
      expect(view.todos).toHaveLength(2);
      expect(view.todos[0]?.status).toBe('in_progress');
    }
  });

  it('parses Todos status events from structured todos array', () => {
    const detail = JSON.stringify({
      type: 'status',
      subtype: 'todo',
      title: 'Todos',
      message: '[~] Scan auth (high)\n[ ] Write fix (medium)',
      todos: [
        { id: '1', content: 'Scan auth', status: 'in_progress', priority: 'high' },
        { id: '2', content: 'Write fix', status: 'pending', priority: 'medium' },
      ],
    });

    const view = buildChatRowEmbedView({
      kind: 'status',
      summaryTitle: 'Todos',
      summaryBody: '[~] Scan auth (high)\n[ ] Write fix (medium)',
      detailJson: detail,
    });

    expect(view?.kind).toBe('todos');
    if (view?.kind === 'todos') {
      expect(view.todos).toEqual([
        { id: '1', content: 'Scan auth', status: 'in_progress' },
        { id: '2', content: 'Write fix', status: 'pending' },
      ]);
    }
  });

  it('parses Todos status checklist text when todos array is absent', () => {
    const view = buildTodosEmbedFromDetail(
      JSON.stringify({
        kind: 'status',
        payload: {
          title: 'Todos',
          message: '[x] Done item\n[~] Active item\n[ ] Pending item\n[-] Cancelled item',
        },
      }),
    );

    expect(view?.kind).toBe('todos');
    if (view?.kind === 'todos') {
      expect(view.todos.map((t) => t.status)).toEqual(['completed', 'in_progress', 'pending', 'cancelled']);
      expect(view.todos.map((t) => t.content)).toEqual(['Done item', 'Active item', 'Pending item', 'Cancelled item']);
    }
  });

  it('parses bash command and output', () => {
    const view = buildToolEmbedView(
      'bash',
      callJson('bash', { command: 'ls -la', workdir: '/app' }),
      resultJson('bash', 'README.md\n'),
    );

    expect(view).toEqual(
      expect.objectContaining({
        kind: 'bash',
        command: 'ls -la',
        workdir: '/app',
        output: 'README.md\n',
        isError: false,
      }),
    );
  });

  it('parses read from restored part JSON', () => {
    const view = buildToolEmbedView(
      'read',
      partCallJson('read', { filePath: '/app/a.ts', offset: 1, limit: 10 }),
      JSON.stringify({ type: 'tool_result', name: 'read', toolCallId: 't1', result: 'export const x = 1;' }),
    );

    expect(view?.kind).toBe('read');
    if (view?.kind === 'read') {
      expect(view.filePath).toBe('/app/a.ts');
      expect(view.offset).toBe(1);
      expect(view.content).toContain('export const x');
    }
  });

  it('parses glob file lists from newline result', () => {
    const view = buildToolEmbedView(
      'glob',
      callJson('glob', { pattern: '**/*.ts' }),
      resultJson('glob', 'a.ts\nb.ts\n'),
    );

    expect(view?.kind).toBe('glob');
    if (view?.kind === 'glob') {
      expect(view.files).toEqual(['a.ts', 'b.ts']);
    }
  });

  it('parses grep path:line:snippet hits', () => {
    const view = buildToolEmbedView(
      'grep',
      callJson('grep', { pattern: 'foo', path: '/app' }),
      resultJson('grep', 'src/a.ts:12:const foo = 1\n'),
    );

    expect(view?.kind).toBe('grep');
    if (view?.kind === 'grep') {
      expect(view.hits[0]).toEqual({ path: 'src/a.ts', line: 12, snippet: 'const foo = 1' });
    }
  });

  it('parses apply_patch unified diff lines', () => {
    const patch = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n';
    const view = buildToolEmbedView('apply_patch', callJson('apply_patch', { patchText: patch }));

    expect(view?.kind).toBe('patch');
    if (view?.kind === 'patch') {
      expect(view.lines.some((l) => l.kind === 'add' && l.text === '+new')).toBe(true);
      expect(view.lines.some((l) => l.kind === 'remove' && l.text === '-old')).toBe(true);
    }
  });

  it('parses edit old/new strings', () => {
    const view = buildToolEmbedView('edit', callJson('edit', { filePath: 'a.ts', oldString: 'a', newString: 'b' }));

    expect(view?.kind).toBe('edit');
    if (view?.kind === 'edit') {
      expect(view.oldString).toBe('a');
      expect(view.newString).toBe('b');
    }
  });

  it('parses write content', () => {
    const view = buildToolEmbedView('write', callJson('write', { filePath: 'a.ts', content: 'hello' }));

    expect(view).toEqual(expect.objectContaining({ kind: 'write', filePath: 'a.ts', content: 'hello' }));
  });

  it('parses webfetch and websearch', () => {
    const fetchView = buildToolEmbedView(
      'webfetch',
      callJson('webfetch', { url: 'https://example.com', format: 'text' }),
      resultJson('webfetch', 'body'),
    );
    const searchView = buildToolEmbedView(
      'websearch',
      callJson('websearch', { query: 'opencode' }),
      resultJson('websearch', [{ title: 'Docs', url: 'https://example.com', snippet: 'hi' }]),
    );

    expect(fetchView?.kind).toBe('webfetch');
    expect(searchView?.kind).toBe('websearch');
    if (searchView?.kind === 'websearch') {
      expect(searchView.hits[0]?.title).toBe('Docs');
    }
  });

  it('parses task and skill', () => {
    const task = buildToolEmbedView(
      'task',
      callJson('task', {
        description: 'Explore',
        prompt: 'Look around',
        subagent_type: 'explore',
      }),
      resultJson('task', 'done'),
    );
    const skill = buildToolEmbedView('skill', callJson('skill', { name: 'nx-cli' }), resultJson('skill', 'ok'));

    expect(task?.kind).toBe('task');
    expect(skill?.kind).toBe('skill');
  });

  it('parses invalid tool errors', () => {
    const view = buildToolEmbedView('invalid', callJson('invalid', { tool: 'nope', error: 'missing' }));

    expect(view).toEqual({ kind: 'invalid', tool: 'nope', error: 'missing' });
  });

  it('returns undefined for malformed JSON detail', () => {
    expect(buildToolEmbedView('bash', '{not-json', undefined)).toBeUndefined();
    expect(parseToolDetailRecord('{')).toBeUndefined();
  });

  it('parses live chatEvent envelopes for bash/read/grep', () => {
    const bashCall = JSON.stringify(
      {
        eventId: 'e1',
        kind: 'toolCall',
        payload: {
          toolCallId: 't1',
          name: 'bash',
          status: 'running',
          args: { command: 'pwd', workdir: '/app' },
        },
      },
      null,
      2,
    );
    const bashResult = JSON.stringify(
      {
        eventId: 'e2',
        kind: 'toolResult',
        payload: {
          toolCallId: 't1',
          name: 'bash',
          isError: false,
          result: '/app\n',
          args: { command: 'pwd', workdir: '/app' },
        },
      },
      null,
      2,
    );

    expect(buildToolEmbedView('bash', bashCall, bashResult)).toEqual(
      expect.objectContaining({
        kind: 'bash',
        command: 'pwd',
        workdir: '/app',
        output: '/app\n',
      }),
    );

    const readOnlyResult = JSON.stringify({
      type: 'tool_result',
      name: 'read',
      toolCallId: 't2',
      args: { filePath: 'src/a.ts', offset: 0 },
      result: 'const x = 1;',
      isError: false,
    });

    expect(buildToolEmbedView(undefined, undefined, readOnlyResult)).toEqual(
      expect.objectContaining({
        kind: 'read',
        filePath: 'src/a.ts',
        content: 'const x = 1;',
      }),
    );

    const grepResultOnly = JSON.stringify({
      type: 'tool_result',
      tool: 'grep',
      toolCallId: 't3',
      input: { pattern: 'TODO', path: '/app' },
      result: 'src/a.ts:3:// TODO fix\n',
    });

    expect(buildToolEmbedView(undefined, undefined, grepResultOnly)).toEqual(
      expect.objectContaining({
        kind: 'grep',
        pattern: 'TODO',
        hits: [{ path: 'src/a.ts', line: 3, snippet: '// TODO fix' }],
      }),
    );
  });

  it('parses bash when args is a bare command string (ACP rawInput)', () => {
    const call = JSON.stringify({
      type: 'tool_call',
      name: 'bash',
      toolCallId: 't1',
      args: 'ls -la /app',
      status: 'running',
    });
    const result = JSON.stringify({
      type: 'tool_result',
      name: 'bash',
      toolCallId: 't1',
      result: 'file.txt\n',
      isError: false,
    });

    expect(buildToolEmbedView('bash', call, result)).toEqual(
      expect.objectContaining({
        kind: 'bash',
        command: 'ls -la /app',
        output: 'file.txt\n',
      }),
    );
  });

  it('still embeds bash/read from result-only frames without args', () => {
    expect(
      buildToolEmbedView(
        'bash',
        undefined,
        JSON.stringify({ type: 'tool_result', name: 'bash', result: 'hello\n', isError: false }),
      ),
    ).toEqual(expect.objectContaining({ kind: 'bash', command: 'bash', output: 'hello\n' }));

    expect(
      buildToolEmbedView(
        'read',
        undefined,
        JSON.stringify({ type: 'tool_result', name: 'read', result: 'body', isError: false, title: 'libs/a.ts' }),
      ),
    ).toEqual(expect.objectContaining({ kind: 'read', filePath: 'libs/a.ts', content: 'body' }));
  });

  it('parseUnifiedDiffLines classifies headers and changes', () => {
    const lines = parseUnifiedDiffLines('diff --git a/x b/x\n+added\n-removed\n context');

    expect(lines.map((l) => l.kind)).toEqual(['header', 'add', 'remove', 'context']);
  });
});
