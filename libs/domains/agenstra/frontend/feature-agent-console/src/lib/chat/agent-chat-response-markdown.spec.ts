import type { AgentResponseObject } from '@forepath/agenstra/frontend/data-access-agent-console';

import {
  extractThinkingPreviewText,
  formatAgentResponseForChatMarkdown,
  formatUnknownAsMarkdown,
} from './agent-chat-response-markdown';

describe('formatAgentResponseForChatMarkdown', () => {
  it('returns plain text string responses unchanged', () => {
    expect(formatAgentResponseForChatMarkdown('Hello **world**')).toBe('Hello **world**');
  });

  it('parses JSON string and formats tool_call', () => {
    const raw = JSON.stringify({
      type: 'tool_call',
      toolCallId: 't1',
      name: 'read',
      status: 'started',
      args: { path: '/README.md' },
    });
    const md = formatAgentResponseForChatMarkdown(raw);

    expect(md).toContain('Tool call');
    expect(md).toContain('read');
    expect(md).toContain('README');
    expect(md).not.toContain('```');
  });

  it('formats tool_result with object payload without code fences', () => {
    const obj: AgentResponseObject = {
      type: 'tool_result',
      toolCallId: 'c1',
      name: 'bash',
      isError: false,
      result: { output: 'ok\n', exit: 0 },
    };
    const md = formatAgentResponseForChatMarkdown(obj);

    expect(md).toContain('Tool result');
    expect(md).toContain('ok');
    expect(md).not.toContain('[object Object]');
    expect(md).not.toContain('```json');
  });

  it('formats question with options', () => {
    const obj: AgentResponseObject = {
      type: 'question',
      questionId: 'q1',
      prompt: 'Pick one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    };
    const md = formatAgentResponseForChatMarkdown(obj);

    expect(md).toContain('Question');
    expect(md).toContain('Pick one');
    expect(md).toContain('`a`');
  });

  it('formats result type with string body', () => {
    expect(
      formatAgentResponseForChatMarkdown({
        type: 'result',
        subtype: 'success',
        result: 'Done.',
      }),
    ).toBe('Done.');
  });

  it('formats agenstra_turn by joining formatted parts', () => {
    const composite: AgentResponseObject = {
      type: 'agenstra_turn',
      subtype: 'success',
      parts: [
        { type: 'tool_call', toolCallId: 'x', name: 'ls', status: 'done', args: {} },
        { type: 'result', subtype: 'success', result: 'Listed.' },
      ],
    };
    const md = formatAgentResponseForChatMarkdown(composite);

    expect(md).toContain('Tool call');
    expect(md).toContain('Listed.');
  });

  it('formats thinking as plain text without markdown bullet lists', () => {
    const thinking = {
      type: 'thinking',
      message: { content: [{ type: 'text', text: 'Planning next steps' }] },
    } as AgentResponseObject;
    const md = formatAgentResponseForChatMarkdown(thinking);

    expect(md).toContain('Planning next steps');
    expect(md).not.toMatch(/^\s*-\s+\*\*/m);
  });

  it('extractThinkingPreviewText reads string delta when other fields absent', () => {
    const thinking = {
      type: 'thinking',
      delta: 'Step-by-step reasoning line',
    } as AgentResponseObject;

    expect(extractThinkingPreviewText(thinking)).toBe('Step-by-step reasoning line');
  });

  it('formats interaction_query as plain preview without generic type bullets', () => {
    const md = formatAgentResponseForChatMarkdown({
      type: 'interaction_query',
      query: 'Pick one option',
    } as AgentResponseObject);

    expect(md).toContain('Pick one option');
    expect(md).not.toContain('**interaction_query**');
  });
});

describe('formatUnknownAsMarkdown', () => {
  it('formats nested objects as bullets', () => {
    const md = formatUnknownAsMarkdown({ a: 1, b: { c: 'x' } });

    expect(md).toContain('**a**');
    expect(md).toContain('**c**');
  });
});
