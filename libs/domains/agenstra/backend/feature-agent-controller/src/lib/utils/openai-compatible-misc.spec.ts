import * as express from 'express';

import {
  BadGatewayException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AGENSTRA_RAW_PAT_BEARER_PATHS,
  OPENAI_COMPATIBLE_ROUTE_PATTERN,
} from '../constants/openai-compatible.constants';

import { classifyAgentResponse, classifyPersistedAgentMessage } from './agent-response-text.utils';
import { OpenAiApiError, toOpenAiError } from './openai-compatible-errors';
import {
  buildChatCompletion,
  buildConversation,
  toChatCompletionUsage,
  toResponsesUsage,
} from './openai-compatible-response.utils';

const C = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';

describe('OpenAI-compatible route pattern (raw PAT scope)', () => {
  it.each([
    `/api/clients/${C}/agents/${A}/openai/v1`,
    `/api/clients/${C}/agents/${A}/openai/v1/`,
    `/api/clients/${C}/agents/${A}/openai/v1/chat/completions`,
    `/API/CLIENTS/${C.toUpperCase()}/agents/${A}/OpenAI/v1/models`,
  ])('matches %s', (path) => {
    expect(OPENAI_COMPATIBLE_ROUTE_PATTERN.test(path)).toBe(true);
  });

  it.each([
    `/api/clients/${C}/agents/${A}/chats`,
    `/api/clients/${C}/agents/${A}/openai/v10/models`,
    `/api/clients/${C}/agents/${A}/openai`,
    `/api/clients/${C}/agents/${A}/files/openai/v1/x`,
    `/api/clients/x/agents/${A}/openai/v1/models`,
    `/api/clients/${C}/x/agents/${A}/openai/v1/models`,
    `/api/clients/${C}/agents/${A}/x/openai/v1/models`,
    `/clients/${C}/agents/${A}/openai/v1/models`,
    `/api/auth/token`,
    `/api/users`,
  ])('does not match %s', (path) => {
    expect(OPENAI_COMPATIBLE_ROUTE_PATTERN.test(path)).toBe(false);
  });

  it('works as an Express mount path (body parser for the OpenAI routes only)', async () => {
    const app = express();

    app.use(OPENAI_COMPATIBLE_ROUTE_PATTERN, express.json({ limit: '1mb' }));
    app.use(express.json({ limit: '100kb' }));
    app.post('*', (req, res) => res.json({ length: JSON.stringify(req.body).length }));
    // Four parameters mark Express error middleware (body parser 413s end up here).
    const onError: express.ErrorRequestHandler = (err, _req, res, _next) => {
      void _next;
      res.status((err as { status?: number }).status ?? 500).end();
    };

    app.use(onError);

    const server = app.listen(0, '127.0.0.1');

    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    const body = JSON.stringify({ text: 'x'.repeat(300_000) });
    const post = (path: string) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

    try {
      expect((await post(`/api/clients/${C}/agents/${A}/openai/v1/chat/completions`)).status).toBe(200);
      expect((await post(`/api/clients/${C}/agents/${A}/chats`)).status).toBe(413);
    } finally {
      server.close();
    }
  });

  it('limits raw PAT bearers to the OpenAI-compatible routes', () => {
    expect(AGENSTRA_RAW_PAT_BEARER_PATHS).toEqual([OPENAI_COMPATIBLE_ROUTE_PATTERN]);
  });
});

describe('classifyAgentResponse', () => {
  it('extracts the final answer of every response shape', () => {
    expect(classifyAgentResponse('plain')).toEqual({ kind: 'text', text: 'plain' });
    expect(classifyAgentResponse({ type: 'result', result: 'r' })).toEqual({ kind: 'text', text: 'r' });
    expect(classifyAgentResponse({ type: 'result', result: { a: 1 } })).toEqual({ kind: 'text', text: '{"a":1}' });
    expect(
      classifyAgentResponse({
        type: 'agenstra_turn',
        parts: [
          { type: 'result', result: 'intermediate' },
          { type: 'tool', name: 'bash' },
          { type: 'result', result: 'final' },
        ],
      }),
    ).toEqual({ kind: 'text', text: 'final' });
    expect(classifyAgentResponse({ type: 'agenstra_turn', parts: [{ type: 'tool' }] })).toEqual({
      kind: 'text',
      text: '',
    });
    expect(classifyAgentResponse(null)).toEqual({ kind: 'text', text: '' });
  });

  it('recognizes errors and filter drops', () => {
    expect(classifyAgentResponse({ type: 'result', is_error: true, result: 'boom' })).toEqual({
      kind: 'error',
      message: 'boom',
    });
    expect(
      classifyAgentResponse({ type: 'agenstra_turn', parts: [{ type: 'result', subtype: 'error', result: 'quota' }] }),
    ).toEqual({ kind: 'error', message: 'quota' });
    expect(classifyAgentResponse({ type: 'error', is_error: true, result: 'MESSAGE_DROPPED' })).toEqual({
      kind: 'dropped',
    });
  });

  it('parses persisted agent messages', () => {
    expect(classifyPersistedAgentMessage(JSON.stringify({ type: 'result', result: 'x' }))).toEqual({
      kind: 'text',
      text: 'x',
    });
    expect(classifyPersistedAgentMessage('{not json')).toEqual({ kind: 'text', text: '{not json' });
    expect(classifyPersistedAgentMessage('hi')).toEqual({ kind: 'text', text: 'hi' });
  });
});

describe('toOpenAiError', () => {
  it.each([
    [new UnauthorizedException('Invalid token'), 401, 'invalid_request_error', 'invalid_api_key'],
    [
      new ForbiddenException('Insufficient token scope. Missing: agent_chats:write'),
      403,
      'permission_error',
      'insufficient_permissions',
    ],
    [new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS), 429, 'rate_limit_error', 'rate_limit_exceeded'],
    [new GatewayTimeoutException('Timed out'), 504, 'server_error', 'timeout'],
    [new BadGatewayException('Remote chat failed'), 502, 'server_error', null],
    [OpenAiApiError.notFound('nope', 'model_not_found', 'model'), 404, 'invalid_request_error', 'model_not_found'],
  ])('maps %p', (exception, status, type, code) => {
    const { status: actual, body } = toOpenAiError(exception);

    expect(actual).toBe(status);
    expect(body.error.type).toBe(type);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toBe(exception.message);
  });

  it('joins validation messages and maps body parser errors', () => {
    expect(toOpenAiError(new HttpException({ message: ['a', 'b'] }, 400)).body.error.message).toBe('a; b');
    expect(toOpenAiError(Object.assign(new Error('request entity too large'), { status: 413 }))).toEqual({
      status: 413,
      body: { error: { message: 'request entity too large', type: 'invalid_request_error', param: null, code: null } },
    });
  });

  it('never leaks internal error details', () => {
    expect(toOpenAiError(new Error('password=hunter2 at db.ts:12'))).toEqual({
      status: 500,
      body: { error: { message: 'Internal server error', type: 'server_error', param: null, code: null } },
    });
  });
});

describe('OpenAI-compatible response builders', () => {
  it('folds cached and reasoning tokens into OpenAI totals', () => {
    const usage = { inputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 2, outputTokens: 7, reasoningTokens: 3 };

    expect(toChatCompletionUsage(usage)).toEqual({
      prompt_tokens: 17,
      completion_tokens: 10,
      total_tokens: 27,
      prompt_tokens_details: { cached_tokens: 5 },
      completion_tokens_details: { reasoning_tokens: 3 },
    });
    expect(toResponsesUsage(undefined)).toEqual({
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    });
  });

  it('builds a chat completion', () => {
    expect(
      buildChatCompletion({ id: 'chatcmpl-1', created: 1, model: 'default', text: 'hi', finishReason: 'stop' }),
    ).toEqual(
      expect.objectContaining({
        object: 'chat.completion',
        choices: [
          expect.objectContaining({
            index: 0,
            finish_reason: 'stop',
            message: expect.objectContaining({ role: 'assistant', content: 'hi' }),
          }),
        ],
      }),
    );
  });

  it('builds conversations from chat sessions', () => {
    expect(buildConversation({ id: C, title: 'T', kind: 'user', createdAt: new Date(2000) })).toEqual({
      id: 'conv_11111111111141118111111111111111',
      object: 'conversation',
      created_at: 2,
      metadata: { title: 'T', agenstra_kind: 'user', agenstra_chat_id: C },
    });
  });
});
