import type { AddressInfo } from 'node:net';

import { PatScopesGuard } from '@forepath/identity/backend';
import { ClientUsersRepository } from '@forepath/identity/backend';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { ClientAgentMembershipInterceptor } from '../interceptors/client-agent-membership.interceptor';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentChatsProxyService } from '../services/client-agent-chats-proxy.service';
import { ClientAgentMembershipService } from '../services/client-agent-membership.service';
import { OpenAiCompatibleService } from '../services/openai-compatible.service';
import { RemoteChatTurnAbortedError } from '../services/remote-agents-session.service';
import { OpenAiApiError } from '../utils/openai-compatible-errors';
import { toConversationId, toItemId, toResponseId } from '../utils/openai-compatible-request.utils';

import { OpenAiCompatibleController } from './openai-compatible.controller';

/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP-level fakes */

const mockEnsureClientAccess = jest.fn();

jest.mock('@forepath/identity/backend', () => ({
  ...jest.requireActual('@forepath/identity/backend'),
  ensureClientAccess: (...args: unknown[]) => mockEnsureClientAccess(...args),
}));

const CLIENT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const OTHER_CHAT = '44444444-4444-4444-8444-444444444444';
const BASE = `/api/clients/${CLIENT}/agents/${AGENT}/openai/v1`;

/** Test principal: `x-test-user` JSON (e.g. a PAT with scopes) or an interactive admin session. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-test-user'];

    req.user = header ? JSON.parse(header) : { id: 'user-1', roles: ['user'], amr: ['pwd'] };

    return true;
  }
}

const pat = (...scopes: string[]) => JSON.stringify({ id: 'user-1', roles: ['user'], amr: ['pat'], scopes });

function parseSse(body: string): Array<{ event?: string; data: string }> {
  return body
    .split('\n\n')
    .filter((frame) => frame.trim() && !frame.startsWith(':'))
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '';

      return { event, data };
    });
}

describe('OpenAiCompatibleController (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let openAi: Record<string, jest.Mock>;
  let chatsProxy: Record<string, jest.Mock>;
  let membership: { isMember: jest.Mock };

  beforeAll(async () => {
    process.env['AUTHENTICATION_METHOD'] = 'users';
    openAi = {
      listModels: jest.fn(),
      getModel: jest.fn(),
      resolveModel: jest.fn(),
      resolveChatId: jest.fn(),
      canStreamDeltas: jest.fn(),
      runTurn: jest.fn(),
    };
    chatsProxy = { create: jest.fn(), get: jest.fn(), update: jest.fn(), delete: jest.fn(), listMessages: jest.fn() };
    membership = { isMember: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [OpenAiCompatibleController],
      providers: [
        { provide: OpenAiCompatibleService, useValue: openAi },
        { provide: ClientAgentChatsProxyService, useValue: chatsProxy },
        { provide: ClientsRepository, useValue: {} },
        { provide: ClientUsersRepository, useValue: {} },
        { provide: ClientAgentMembershipService, useValue: membership },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector) => new PatScopesGuard(reflector),
          inject: [Reflector],
        },
        { provide: APP_INTERCEPTOR, useClass: ClientAgentMembershipInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Same global pipe as the controller bootstrap: OpenAI bodies must not be rejected by the DTO whitelist.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env['AUTHENTICATION_METHOD'];
  });

  beforeEach(() => {
    Object.values(openAi).forEach((mock) => mock.mockReset());
    Object.values(chatsProxy).forEach((mock) => mock.mockReset());
    mockEnsureClientAccess.mockReset().mockResolvedValue({ isClientCreator: true });
    membership.isMember.mockReset().mockResolvedValue(true);
    openAi['resolveModel'].mockResolvedValue(undefined);
    openAi['resolveChatId'].mockResolvedValue(CHAT);
    openAi['canStreamDeltas'].mockResolvedValue(true);
    delete process.env['OPENAI_COMPATIBLE_API_ENABLED'];
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
    fetch(`${baseUrl}${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${baseUrl}${BASE}${path}`, { headers });

  describe('chat/completions', () => {
    const body = {
      model: 'default',
      messages: [
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'hello' },
      ],
      temperature: 0.3,
      tools: [],
    };

    it('runs a non-streaming turn in the resolved chat', async () => {
      openAi['runTurn'].mockResolvedValue({
        text: 'Hi!',
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 2 },
      });

      const res = await post('/chat/completions', { ...body, chat_id: CHAT });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get('x-agenstra-chat-id')).toBe(CHAT);
      expect(json).toEqual(
        expect.objectContaining({
          object: 'chat.completion',
          model: 'default',
          choices: [
            expect.objectContaining({ finish_reason: 'stop', message: expect.objectContaining({ content: 'Hi!' }) }),
          ],
          usage: expect.objectContaining({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }),
        }),
      );
      expect(json.id).toMatch(/^chatcmpl-/);
      expect(openAi['resolveChatId']).toHaveBeenCalledWith(CLIENT, AGENT, CHAT);
      expect(openAi['runTurn']).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: CLIENT, agentId: AGENT, chatId: CHAT, prompt: 'hello', userId: 'user-1' }),
      );
      expect(mockEnsureClientAccess).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        CLIENT,
        expect.anything(),
      );
    });

    it('streams live deltas as chat.completion.chunk events', async () => {
      openAi['runTurn'].mockImplementation(async (params: any) => {
        params.onDeltaText('Hel');
        params.onDeltaText('lo');

        return { text: 'Hello', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
      });

      const res = await post('/chat/completions', { ...body, stream: true, stream_options: { include_usage: true } });
      const frames = parseSse(await res.text());

      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('x-agenstra-chat-id')).toBe(CHAT);

      const chunks = frames.slice(0, -1).map((frame) => JSON.parse(frame.data));

      expect(chunks.map((chunk) => chunk.choices[0]?.delta)).toEqual([
        { role: 'assistant', content: '' },
        { content: 'Hel' },
        { content: 'lo' },
        {},
        undefined,
      ]);
      expect(chunks[3].choices[0].finish_reason).toBe('stop');
      expect(chunks[0].usage).toBeNull();
      expect(chunks[4]).toEqual(
        expect.objectContaining({ choices: [], usage: expect.objectContaining({ total_tokens: 2 }) }),
      );
      expect(frames[frames.length - 1].data).toBe('[DONE]');
    });

    it('streams only the filtered final answer when outgoing filters may rewrite it', async () => {
      openAi['canStreamDeltas'].mockResolvedValue(false);
      openAi['runTurn'].mockImplementation(async (params: any) => {
        expect(params.onDeltaText).toBeUndefined();

        return { text: 'Hello [redacted]', finishReason: 'stop' };
      });

      const frames = parseSse(await (await post('/chat/completions', { ...body, stream: true })).text());
      const deltas = frames
        .filter((frame) => frame.data !== '[DONE]')
        .map((frame) => JSON.parse(frame.data).choices[0].delta.content)
        .filter(Boolean);

      expect(deltas).toEqual(['Hello [redacted]']);
    });

    it('reports a filter drop as finish_reason content_filter', async () => {
      openAi['runTurn'].mockResolvedValue({ text: '', finishReason: 'content_filter' });

      const json = await (await post('/chat/completions', body)).json();

      expect(json.choices[0]).toEqual(expect.objectContaining({ finish_reason: 'content_filter' }));
    });

    it('ends the stream with an OpenAI error frame when the turn fails', async () => {
      openAi['runTurn'].mockRejectedValue(new OpenAiApiError(502, 'The agent failed to answer', 'server_error'));

      const frames = parseSse(await (await post('/chat/completions', { ...body, stream: true })).text());

      expect(JSON.parse(frames[frames.length - 1].data)).toEqual({
        error: { message: 'The agent failed to answer', type: 'server_error', param: null, code: null },
      });
    });

    it('rejects invalid requests with an OpenAI error before touching the agent', async () => {
      const res = await post('/chat/completions', {
        model: 'default',
        messages: [{ role: 'user', content: [{ type: 'image_url' }] }],
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: expect.objectContaining({
          type: 'invalid_request_error',
          code: 'unsupported_parameter',
          param: 'messages[0].content[0].type',
        }),
      });
      expect(openAi['runTurn']).not.toHaveBeenCalled();
    });

    it('aborts the agent wait when the client disconnects', async () => {
      let signal: AbortSignal | undefined;
      let release!: () => void;

      openAi['runTurn'].mockImplementation(
        (params: any) =>
          new Promise((_resolve, reject) => {
            signal = params.signal;
            release = () => reject(new RemoteChatTurnAbortedError());
            params.signal.addEventListener('abort', release);
          }),
      );
      const controller = new AbortController();
      const pending = post('/chat/completions', body, {}, controller.signal).catch(() => undefined);

      for (let i = 0; i < 100 && !signal; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      controller.abort();
      await pending;

      for (let i = 0; i < 100 && !signal?.aborted; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(signal?.aborted).toBe(true);
    });
  });

  describe('authorization', () => {
    it('requires agent_chats:write for turns (PAT / app tokens)', async () => {
      const res = await post(
        '/chat/completions',
        { model: 'default', messages: [{ role: 'user', content: 'x' }] },
        {
          'x-test-user': pat('agent_chats:read', 'agents:read'),
        },
      );

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: {
          message: 'Insufficient token scope. Missing: agent_chats:write',
          type: 'permission_error',
          param: null,
          code: 'insufficient_permissions',
        },
      });
      expect(openAi['runTurn']).not.toHaveBeenCalled();
    });

    it('accepts a PAT with agent_chats:write', async () => {
      openAi['runTurn'].mockResolvedValue({ text: 'ok', finishReason: 'stop' });

      const res = await post(
        '/chat/completions',
        { model: 'default', messages: [{ role: 'user', content: 'x' }] },
        {
          'x-test-user': pat('agent_chats:write'),
        },
      );

      expect(res.status).toBe(200);
    });

    it('requires agents:read for models and agent_chats:read for conversations', async () => {
      expect((await get('/models', { 'x-test-user': pat('agent_chats:write') })).status).toBe(403);
      expect(
        (await get(`/conversations/${toConversationId(CHAT)}`, { 'x-test-user': pat('agents:read') })).status,
      ).toBe(403);
      expect((await post('/conversations', {}, { 'x-test-user': pat('agent_chats:read') })).status).toBe(403);
    });

    it('answers 404 for agents outside the workspace', async () => {
      membership.isMember.mockResolvedValue(false);

      const res = await get('/models');

      expect(res.status).toBe(404);
      expect((await res.json()).error.type).toBe('invalid_request_error');
      expect(openAi['listModels']).not.toHaveBeenCalled();
    });

    it('answers 403 without workspace access', async () => {
      mockEnsureClientAccess.mockRejectedValue(new ForbiddenException('You do not have access to this client'));

      const res = await post('/chat/completions', { model: 'default', messages: [{ role: 'user', content: 'x' }] });

      expect(res.status).toBe(403);
      expect(openAi['runTurn']).not.toHaveBeenCalled();
    });

    it('rejects malformed workspace / agent ids', async () => {
      const res = await fetch(`${baseUrl}/api/clients/not-a-uuid/agents/${AGENT}/openai/v1/models`);

      expect(res.status).toBe(400);
      expect((await res.json()).error.type).toBe('invalid_request_error');
    });

    it('answers 404 when the API is disabled', async () => {
      process.env['OPENAI_COMPATIBLE_API_ENABLED'] = 'false';

      const res = await get('/models');

      expect(res.status).toBe(404);
      expect(openAi['listModels']).not.toHaveBeenCalled();
    });
  });

  describe('models', () => {
    it('lists and retrieves models (ids may contain a slash)', async () => {
      openAi['listModels'].mockResolvedValue({ object: 'list', data: [] });
      openAi['getModel'].mockResolvedValue({ id: 'openai/gpt-5', object: 'model', created: 0, owned_by: 'openai' });

      expect(await (await get('/models')).json()).toEqual({ object: 'list', data: [] });
      expect((await (await get('/models/openai/gpt-5')).json()).id).toBe('openai/gpt-5');
      expect(openAi['getModel']).toHaveBeenCalledWith(CLIENT, AGENT, 'openai/gpt-5');
    });
  });

  describe('responses', () => {
    it('continues the chat of previous_response_id and returns a response object', async () => {
      openAi['runTurn'].mockResolvedValue({ text: 'Hallo', finishReason: 'stop' });
      const previous = toResponseId(OTHER_CHAT, 'ab'.repeat(12));

      openAi['resolveChatId'].mockResolvedValue(OTHER_CHAT);

      const res = await post('/responses', {
        model: 'default',
        input: 'Hi',
        previous_response_id: previous,
        store: true,
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(openAi['resolveChatId']).toHaveBeenCalledWith(CLIENT, AGENT, OTHER_CHAT);
      expect(json).toEqual(
        expect.objectContaining({
          object: 'response',
          status: 'completed',
          previous_response_id: previous,
          output_text: 'Hallo',
          output: [
            expect.objectContaining({
              type: 'message',
              role: 'assistant',
              content: [expect.objectContaining({ type: 'output_text', text: 'Hallo' })],
            }),
          ],
        }),
      );
      // The new response id continues the same chat.
      expect(json.id.startsWith(toResponseId(OTHER_CHAT, ''))).toBe(true);
    });

    it('maps an unknown previous response chat to previous_response_not_found', async () => {
      openAi['resolveChatId'].mockRejectedValue(
        OpenAiApiError.notFound('Chat session not found', 'conversation_not_found'),
      );

      const res = await post('/responses', {
        model: 'default',
        input: 'Hi',
        previous_response_id: toResponseId(OTHER_CHAT, 'ab'),
      });

      expect(res.status).toBe(404);
      expect((await res.json()).error).toEqual(
        expect.objectContaining({ code: 'previous_response_not_found', param: 'previous_response_id' }),
      );
    });

    it('streams Responses API events in order', async () => {
      openAi['runTurn'].mockImplementation(async (params: any) => {
        params.onDeltaText('Hal');
        params.onDeltaText('lo');

        return { text: 'Hallo', finishReason: 'stop' };
      });

      const frames = parseSse(
        await (
          await post('/responses', {
            model: 'default',
            input: 'Hi',
            conversation: toConversationId(CHAT),
            stream: true,
          })
        ).text(),
      );
      const events = frames.map((frame) => ({ event: frame.event, data: JSON.parse(frame.data) }));

      expect(events.map((entry) => entry.event)).toEqual([
        'response.created',
        'response.in_progress',
        'response.output_item.added',
        'response.content_part.added',
        'response.output_text.delta',
        'response.output_text.delta',
        'response.output_text.done',
        'response.content_part.done',
        'response.output_item.done',
        'response.completed',
      ]);
      events.forEach((entry, index) => {
        expect(entry.data.type).toBe(entry.event);
        expect(entry.data.sequence_number).toBe(index);
      });
      expect(events[9].data.response).toEqual(
        expect.objectContaining({
          status: 'completed',
          output_text: 'Hallo',
          conversation: { id: toConversationId(CHAT) },
        }),
      );
    });

    it('streams a filter drop as response.incomplete and failures as error + response.failed', async () => {
      openAi['runTurn'].mockResolvedValueOnce({ text: '', finishReason: 'content_filter' });
      let frames = parseSse(await (await post('/responses', { model: 'default', input: 'Hi', stream: true })).text());

      expect(frames[frames.length - 1].event).toBe('response.incomplete');
      expect(JSON.parse(frames[frames.length - 1].data).response.incomplete_details).toEqual({
        reason: 'content_filter',
      });

      openAi['runTurn'].mockRejectedValueOnce(new OpenAiApiError(504, 'Timed out', 'server_error', 'timeout'));
      frames = parseSse(await (await post('/responses', { model: 'default', input: 'Hi', stream: true })).text());

      expect(frames.slice(-2).map((frame) => frame.event)).toEqual(['error', 'response.failed']);
      expect(JSON.parse(frames[frames.length - 2].data)).toEqual(
        expect.objectContaining({ code: 'timeout', message: 'Timed out' }),
      );
    });
  });

  describe('conversations', () => {
    const session = { id: CHAT, title: 'Release', kind: 'user', createdAt: '2026-11-13T10:00:00.000Z' };

    it('creates, retrieves, renames and deletes chat sessions', async () => {
      chatsProxy['create'].mockResolvedValue(session);
      chatsProxy['get'].mockResolvedValue(session);
      chatsProxy['update'].mockResolvedValue({ ...session, title: 'Renamed' });

      const created = await (await post('/conversations', { metadata: { title: 'Release' } })).json();

      expect(created).toEqual(expect.objectContaining({ id: toConversationId(CHAT), object: 'conversation' }));
      expect(chatsProxy['create']).toHaveBeenCalledWith(CLIENT, AGENT, { title: 'Release' });

      expect((await (await get(`/conversations/${toConversationId(CHAT)}`)).json()).metadata.title).toBe('Release');
      expect(
        (await (await post(`/conversations/${toConversationId(CHAT)}`, { metadata: { title: 'Renamed' } })).json())
          .metadata.title,
      ).toBe('Renamed');
      expect(chatsProxy['update']).toHaveBeenCalledWith(CLIENT, AGENT, CHAT, { title: 'Renamed' });

      const deleted = await fetch(`${baseUrl}${BASE}/conversations/${CHAT}`, { method: 'DELETE' });

      expect(await deleted.json()).toEqual({ id: CHAT, object: 'conversation.deleted', deleted: true });
      expect(chatsProxy['delete']).toHaveBeenCalledWith(CLIENT, AGENT, CHAT);
    });

    it('answers 404 for malformed or foreign conversations', async () => {
      expect((await get('/conversations/conv_nope')).status).toBe(404);

      const { NotFoundException } = jest.requireActual('@nestjs/common');

      chatsProxy['get'].mockRejectedValue(new NotFoundException('nope'));

      const res = await fetch(`${baseUrl}${BASE}/conversations/${CHAT}`, { method: 'DELETE' });

      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('conversation_not_found');
      expect(chatsProxy['delete']).not.toHaveBeenCalled();
    });

    it('lists items with OpenAI pagination', async () => {
      chatsProxy['get'].mockResolvedValue(session);
      const ids = ['a', 'b', 'c'].map(
        (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`,
      );

      chatsProxy['listMessages'].mockResolvedValue([
        { id: ids[0], actor: 'user', message: 'q1', createdAt: '2026-11-13T10:00:00Z' },
        {
          id: ids[1],
          actor: 'agent',
          message: JSON.stringify({ type: 'result', result: 'a1' }),
          createdAt: '2026-11-13T10:00:01Z',
        },
        { id: ids[2], actor: 'user', message: 'q2', createdAt: '2026-11-13T10:00:02Z' },
      ]);

      const desc = await (await get(`/conversations/${toConversationId(CHAT)}/items?limit=2`)).json();

      expect(desc.data.map((item: any) => item.id)).toEqual([toItemId(ids[2]), toItemId(ids[1])]);
      expect(desc.has_more).toBe(true);
      expect(desc.data[1]).toEqual(
        expect.objectContaining({
          role: 'assistant',
          content: [expect.objectContaining({ type: 'output_text', text: 'a1' })],
        }),
      );

      const next = await (
        await get(`/conversations/${toConversationId(CHAT)}/items?limit=2&after=${desc.last_id}`)
      ).json();

      expect(next.data.map((item: any) => item.id)).toEqual([toItemId(ids[0])]);
      expect(next.has_more).toBe(false);

      const asc = await (await get(`/conversations/${toConversationId(CHAT)}/items?order=asc&limit=1`)).json();

      expect(asc.data[0]).toEqual(
        expect.objectContaining({ role: 'user', content: [{ type: 'input_text', text: 'q1' }] }),
      );

      const item = await (await get(`/conversations/${toConversationId(CHAT)}/items/${toItemId(ids[1])}`)).json();

      expect(item.id).toBe(toItemId(ids[1]));
      expect((await get(`/conversations/${toConversationId(CHAT)}/items/msg_unknown`)).status).toBe(404);
    });
  });

  it('answers unsupported OpenAI endpoints with an OpenAI error', async () => {
    const res = await post('/embeddings', { model: 'x', input: 'y' });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('unsupported_endpoint');
  });
});
