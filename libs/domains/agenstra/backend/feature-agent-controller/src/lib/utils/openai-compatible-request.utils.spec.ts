import { HttpStatus } from '@nestjs/common';

import { OpenAiApiError } from './openai-compatible-errors';
import {
  parseChatCompletionRequest,
  parseConversationCreateRequest,
  parseConversationId,
  parseConversationUpdateRequest,
  parseItemId,
  parseListQuery,
  parseMetadata,
  parseResponseId,
  parseResponsesRequest,
  toConversationId,
  toItemId,
  toResponseId,
} from './openai-compatible-request.utils';

const CHAT_ID = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
const OTHER_CHAT_ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

function expectOpenAiError(fn: () => unknown, status: number, param?: string | null, code?: string | null) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OpenAiApiError);
    expect((error as OpenAiApiError).getStatus()).toBe(status);

    if (param !== undefined) {
      expect((error as OpenAiApiError).param).toBe(param);
    }

    if (code !== undefined) {
      expect((error as OpenAiApiError).errorCode).toBe(code);
    }

    return;
  }

  throw new Error('expected an OpenAiApiError');
}

describe('OpenAI-compatible ids', () => {
  it('round-trips conversation, item and response ids', () => {
    expect(toConversationId(CHAT_ID)).toBe('conv_3f2b8c1e5d4a4b6c9e7f0a1b2c3d4e5f');
    expect(parseConversationId(toConversationId(CHAT_ID))).toBe(CHAT_ID);
    expect(parseConversationId(CHAT_ID.toUpperCase())).toBe(CHAT_ID);
    expect(parseItemId(toItemId(CHAT_ID))).toBe(CHAT_ID);
    expect(parseResponseId(toResponseId(CHAT_ID, 'abcdef0123456789abcdef01'))).toBe(CHAT_ID);
  });

  it.each([
    'conv_',
    'conv_xyz',
    'conv_3f2b8c1e5d4a4b6c9e7f0a1b2c3d4e5f00',
    'conv_3f2b8c1e5d4a1b6c9e7f0a1b2c3d4e5f', // not a v4 UUID
    '../3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f',
    '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f/../x',
    '',
  ])('rejects malformed conversation id %p', (value) => {
    expect(parseConversationId(value)).toBeUndefined();
  });

  it.each([
    'resp_',
    'resp_zz',
    'resp_3f2b8c1e',
    'chatcmpl-3f2b8c1e5d4a4b6c9e7f0a1b2c3d4e5f',
    'resp_3f2b8c1e5d4a4b6c9e7f0a1b2c3d4e5f-x',
  ])('rejects malformed response id %p', (value) => {
    expect(parseResponseId(value)).toBeUndefined();
  });
});

describe('parseChatCompletionRequest', () => {
  const base = { model: 'default' };

  it('sends only the messages after the last assistant message', () => {
    const parsed = parseChatCompletionRequest(
      {
        ...base,
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'first answer' },
          { role: 'developer', content: 'Use German.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'second' },
              { type: 'text', text: 'question' },
            ],
          },
        ],
      },
      undefined,
    );

    expect(parsed.prompt).toBe('Use German.\n\nsecond\nquestion');
    expect(parsed.stream).toBe(false);
    expect(parsed.includeUsage).toBe(false);
    expect(parsed.chatId).toBeUndefined();
  });

  it('includes system messages on the first turn', () => {
    const parsed = parseChatCompletionRequest(
      {
        ...base,
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'hi' },
        ],
      },
      undefined,
    );

    expect(parsed.prompt).toBe('Be brief.\n\nhi');
  });

  it('accepts and ignores OpenAI fields without an Agenstra equivalent', () => {
    const parsed = parseChatCompletionRequest(
      {
        ...base,
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.2,
        top_p: 1,
        max_tokens: 10,
        tools: [{ type: 'function', function: { name: 'x' } }],
        tool_choice: 'auto',
        user: 'u',
        n: 1,
        stream: true,
        stream_options: { include_usage: true },
        metadata: { source: 'ci' },
      },
      undefined,
    );

    expect(parsed).toEqual(
      expect.objectContaining({ stream: true, includeUsage: true, metadata: { source: 'ci' }, prompt: 'hi' }),
    );
  });

  it('selects the chat session from the header or chat_id', () => {
    expect(parseChatCompletionRequest({ ...base, messages: [{ role: 'user', content: 'x' }] }, CHAT_ID).chatId).toBe(
      CHAT_ID,
    );
    expect(
      parseChatCompletionRequest(
        { ...base, chat_id: toConversationId(CHAT_ID), messages: [{ role: 'user', content: 'x' }] },
        CHAT_ID,
      ).chatId,
    ).toBe(CHAT_ID);
  });

  it('rejects conflicting chat sessions', () => {
    expectOpenAiError(
      () =>
        parseChatCompletionRequest(
          { ...base, chat_id: OTHER_CHAT_ID, messages: [{ role: 'user', content: 'x' }] },
          CHAT_ID,
        ),
      HttpStatus.BAD_REQUEST,
      'chat_id',
    );
  });

  it('rejects malformed chat ids', () => {
    expectOpenAiError(
      () => parseChatCompletionRequest({ ...base, messages: [{ role: 'user', content: 'x' }] }, 'not-a-chat'),
      HttpStatus.BAD_REQUEST,
      'X-Agenstra-Chat-Id',
    );
  });

  it.each([
    ['a missing body', undefined, null],
    ['an array body', [], null],
    ['a missing model', { messages: [{ role: 'user', content: 'x' }] }, 'model'],
    ['a non-string model', { model: 1, messages: [{ role: 'user', content: 'x' }] }, 'model'],
    ['missing messages', { model: 'default' }, 'messages'],
    ['empty messages', { model: 'default', messages: [] }, 'messages'],
    [
      'no new user message',
      {
        model: 'default',
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
      },
      'messages',
    ],
    ['a blank new message', { model: 'default', messages: [{ role: 'user', content: '   ' }] }, 'messages'],
    ['an unknown role', { model: 'default', messages: [{ role: 'root', content: 'x' }] }, 'messages[0].role'],
    ['a non-boolean stream', { model: 'default', stream: 'yes', messages: [{ role: 'user', content: 'x' }] }, 'stream'],
    ['bad metadata', { model: 'default', metadata: { a: 1 }, messages: [{ role: 'user', content: 'x' }] }, 'metadata'],
  ])('rejects %s', (_label, body, param) => {
    expectOpenAiError(() => parseChatCompletionRequest(body, undefined), HttpStatus.BAD_REQUEST, param);
  });

  it.each([
    [
      'image content',
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x' } }] },
      'messages[0].content[0].type',
    ],
    [
      'audio content',
      { role: 'user', content: [{ type: 'input_audio', input_audio: {} }] },
      'messages[0].content[0].type',
    ],
    ['tool results', { role: 'tool', tool_call_id: 'c', content: 'r' }, 'messages[0].role'],
  ])('rejects unsupported %s in the new turn', (_label, message, param) => {
    expectOpenAiError(
      () =>
        parseChatCompletionRequest(
          { model: 'default', messages: [message, { role: 'user', content: 'x' }] },
          undefined,
        ),
      HttpStatus.BAD_REQUEST,
      param,
      'unsupported_parameter',
    );
  });

  it('ignores tool messages that are part of earlier history', () => {
    const parsed = parseChatCompletionRequest(
      {
        model: 'default',
        messages: [
          { role: 'user', content: 'a' },
          { role: 'tool', content: 'old' },
          { role: 'assistant', content: 'b' },
          { role: 'user', content: 'c' },
        ],
      },
      undefined,
    );

    expect(parsed.prompt).toBe('c');
  });

  it.each([
    ['n > 1', { n: 2 }, 'n'],
    ['a forced tool', { tool_choice: 'required' }, 'tool_choice'],
    ['a named tool', { tool_choice: { type: 'function', function: { name: 'x' } } }, 'tool_choice'],
  ])('rejects %s', (_label, extra, param) => {
    expectOpenAiError(
      () =>
        parseChatCompletionRequest(
          { model: 'default', messages: [{ role: 'user', content: 'x' }], ...extra },
          undefined,
        ),
      HttpStatus.BAD_REQUEST,
      param,
      'unsupported_parameter',
    );
  });
});

describe('parseResponsesRequest', () => {
  it('accepts a string input and prepends instructions', () => {
    const parsed = parseResponsesRequest({ model: 'default', input: 'hello', instructions: 'Be brief.' }, undefined);

    expect(parsed.prompt).toBe('Be brief.\n\nhello');
    expect(parsed.instructions).toBe('Be brief.');
    expect(parsed.chatId).toBeUndefined();
    expect(parsed.conversationRequested).toBe(false);
  });

  it('accepts message items and sends the new turn only', () => {
    const parsed = parseResponsesRequest(
      {
        model: 'default',
        input: [
          { role: 'user', content: 'old' },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'new' }] },
        ],
      },
      undefined,
    );

    expect(parsed.prompt).toBe('new');
  });

  it('selects the chat from conversation (id or object)', () => {
    expect(
      parseResponsesRequest({ model: 'm', input: 'x', conversation: toConversationId(CHAT_ID) }, undefined),
    ).toEqual(expect.objectContaining({ chatId: CHAT_ID, conversationRequested: true }));
    expect(parseResponsesRequest({ model: 'm', input: 'x', conversation: { id: CHAT_ID } }, undefined).chatId).toBe(
      CHAT_ID,
    );
  });

  it('continues the chat embedded in previous_response_id', () => {
    const previous = toResponseId(CHAT_ID, 'ab'.repeat(12));
    const parsed = parseResponsesRequest({ model: 'm', input: 'x', previous_response_id: previous }, undefined);

    expect(parsed.chatId).toBe(CHAT_ID);
    expect(parsed.previousResponseId).toBe(previous);
  });

  it('answers 404 for an unknown previous_response_id', () => {
    expectOpenAiError(
      () => parseResponsesRequest({ model: 'm', input: 'x', previous_response_id: 'resp_unknown' }, undefined),
      HttpStatus.NOT_FOUND,
      'previous_response_id',
      'previous_response_not_found',
    );
  });

  it('rejects conversation together with previous_response_id', () => {
    expectOpenAiError(
      () =>
        parseResponsesRequest(
          { model: 'm', input: 'x', conversation: CHAT_ID, previous_response_id: toResponseId(CHAT_ID, 'ab') },
          undefined,
        ),
      HttpStatus.BAD_REQUEST,
      'previous_response_id',
    );
  });

  it('rejects a conversation that conflicts with the chat header', () => {
    expectOpenAiError(
      () => parseResponsesRequest({ model: 'm', input: 'x', conversation: CHAT_ID }, OTHER_CHAT_ID),
      HttpStatus.BAD_REQUEST,
    );
  });

  it.each([
    ['function call outputs', [{ type: 'function_call_output', call_id: 'c', output: 'x' }], 'input[0].type'],
    [
      'images',
      [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://x' }] }],
      'input[0].content[0].type',
    ],
  ])('rejects %s', (_label, input, param) => {
    expectOpenAiError(
      () => parseResponsesRequest({ model: 'm', input }, undefined),
      HttpStatus.BAD_REQUEST,
      param,
      'unsupported_parameter',
    );
  });

  it.each([
    ['empty input', { model: 'm', input: '' }],
    ['missing input', { model: 'm' }],
    ['background mode', { model: 'm', input: 'x', background: true }],
    ['non-string instructions', { model: 'm', input: 'x', instructions: 1 }],
    ['invalid conversation', { model: 'm', input: 'x', conversation: 42 }],
  ])('rejects %s', (_label, body) => {
    expectOpenAiError(() => parseResponsesRequest(body, undefined), HttpStatus.BAD_REQUEST);
  });
});

describe('conversation requests and list queries', () => {
  it('takes the title from metadata and rejects initial items', () => {
    expect(parseConversationCreateRequest(undefined)).toEqual({ title: undefined, metadata: null });
    expect(parseConversationCreateRequest({ metadata: { title: '  Release notes ' }, items: [] })).toEqual({
      title: 'Release notes',
      metadata: { title: '  Release notes ' },
    });
    expectOpenAiError(
      () => parseConversationCreateRequest({ items: [{ role: 'user', content: 'x' }] }),
      HttpStatus.BAD_REQUEST,
      'items',
      'unsupported_parameter',
    );
    expectOpenAiError(() => parseConversationUpdateRequest({}), HttpStatus.BAD_REQUEST, 'metadata');
  });

  it('bounds metadata', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 'v']));

    expectOpenAiError(() => parseMetadata(tooMany), HttpStatus.BAD_REQUEST);
    expectOpenAiError(() => parseMetadata({ k: 'x'.repeat(513) }), HttpStatus.BAD_REQUEST);
    expectOpenAiError(() => parseMetadata({ ['k'.repeat(65)]: 'v' }), HttpStatus.BAD_REQUEST);
  });

  it('parses list queries with OpenAI defaults', () => {
    expect(parseListQuery({})).toEqual({ limit: 20, order: 'desc', after: undefined });
    expect(parseListQuery({ limit: '5', order: 'asc', after: toItemId(CHAT_ID) })).toEqual({
      limit: 5,
      order: 'asc',
      after: CHAT_ID,
    });

    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { limit: '1.5' },
      { order: 'up' },
      { after: 'x' },
      { after: ['a'] },
    ]) {
      expectOpenAiError(() => parseListQuery(query), HttpStatus.BAD_REQUEST);
    }
  });
});
