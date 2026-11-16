import { AgentHarness } from './agent-harness';
import { AgentHarnessClient } from './agent-harness.client';
import { AgentHarnessAbortError, AgentHarnessApiError, AgentHarnessConfigError } from './agent-harness.errors';
import type { AgentHarnessEvent } from './agent-harness.events';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const CONV = `conv_${CHAT.replace(/-/g, '')}`;
const BASE = `https://agenstra.example.com/api/clients/${CLIENT}/agents/${AGENT}/openai/v1`;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

type Reply = Response | ((request: Recorded) => Response);

function sse(events: Array<Record<string, unknown>>, chatId = CHAT): Response {
  const text = events.map((event) => `event: ${event['type']}\ndata: ${JSON.stringify(event)}\n\n`).join('');

  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Agenstra-Chat-Id': chatId },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function response(output: unknown[], status = 'completed', usage = 10) {
  return {
    id: 'resp_1',
    object: 'response',
    status,
    output,
    output_text: output
      .flatMap((item: any) => (item.type === 'message' ? item.content : []))
      .map((part: any) => part.text)
      .join(''),
    usage: {
      input_tokens: usage,
      input_tokens_details: { cached_tokens: 1 },
      output_tokens: 2,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: usage + 2,
    },
  };
}

const message = (text: string) => ({
  type: 'message',
  id: 'msg_1',
  status: 'completed',
  role: 'assistant',
  content: [{ type: 'output_text', text }],
});
const functionCall = (callId: string, name: string, args: unknown) => ({
  type: 'function_call',
  id: `fc_${callId}`,
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
  status: 'completed',
});

function fakeServer(replies: Reply[]) {
  const requests: Recorded[] = [];
  const fetch = jest.fn(async (url: string, init: RequestInit) => {
    const recorded: Recorded = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };

    requests.push(recorded);
    const reply = replies.shift();

    if (!reply) {
      throw new Error(`Unexpected request ${url}`);
    }

    return typeof reply === 'function' ? reply(recorded) : reply;
  });

  return { fetch, requests };
}

function harnessWith(replies: Reply[], options: Partial<ConstructorParameters<typeof AgentHarness>[0]> = {}) {
  const server = fakeServer(replies);
  const harness = new AgentHarness<{ userId: string }>({
    connection: {
      apiUrl: 'https://agenstra.example.com/api',
      clientId: CLIENT,
      agentId: AGENT,
      credential: 'fp_pat_test',
      fetch: server.fetch,
    },
    instructions: 'You are the billing assistant.',
    ...options,
  });

  return { harness, ...server };
}

async function collect(iterable: AsyncIterable<AgentHarnessEvent>): Promise<AgentHarnessEvent[]> {
  const events: AgentHarnessEvent[] = [];

  for await (const event of iterable) {
    events.push(event);
  }

  return events;
}

describe('AgentHarness', () => {
  it('runs a plain turn with instructions, context and credentials', async () => {
    const { harness, requests } = harnessWith([
      sse([
        { type: 'response.created', response: response([], 'in_progress') },
        { type: 'response.output_text.delta', delta: 'Hel' },
        { type: 'response.output_text.delta', delta: 'lo' },
        { type: 'response.completed', response: response([message('Hello')]) },
      ]),
    ]);

    harness.registerContextProvider({ name: 'user', provide: (ctx) => `User ${ctx.userId}` });

    const result = await harness.run('Hi', { context: { userId: 'u1' }, contextSections: { page: 'Dashboard' } });

    expect(result).toEqual(
      expect.objectContaining({
        text: 'Hello',
        status: 'completed',
        chatId: CHAT,
        conversationId: CONV,
        rounds: 1,
        usage: { inputTokens: 10, cachedInputTokens: 1, outputTokens: 2, reasoningTokens: 0, totalTokens: 12 },
      }),
    );
    expect(requests[0].url).toBe(`${BASE}/responses`);
    expect(requests[0].headers['Authorization']).toBe('Bearer fp_pat_test');
    expect(requests[0].body).toEqual({
      model: 'default',
      input: 'Hi',
      instructions:
        '<harness_instructions>\nYou are the billing assistant.\n\n<context name="user">\nUser u1\n</context>\n\n<context name="page">\nDashboard\n</context>\n</harness_instructions>',
      stream: true,
    });
  });

  it('executes client tools and continues the paused turn in the same chat', async () => {
    const { harness, requests } = harnessWith([
      sse([
        { type: 'response.output_text.delta', delta: 'Checking…' },
        {
          type: 'response.output_item.done',
          item: {
            type: 'mcp_call',
            id: 'mcp_1',
            name: 'bash',
            arguments: '{}',
            output: 'ok',
            error: null,
            status: 'completed',
          },
        },
        {
          type: 'response.completed',
          response: response([
            message('Checking…'),
            functionCall('call_aaaaaaaaaaaaaaaaaaaaaaaa', 'get_total', { invoice: 'INV-7' }),
            functionCall('call_bbbbbbbbbbbbbbbbbbbbbbbb', 'get_total', { invoice: 'INV-8' }),
          ]),
        },
      ]),
      sse([{ type: 'response.completed', response: response([message('INV-7: 100, INV-8: 200')]) }]),
    ]);
    const handler = jest.fn(async ({ invoice }: { invoice: string }, ctx: { context: { userId: string } }) => ({
      invoice,
      total: invoice === 'INV-7' ? 100 : 200,
      user: ctx.context.userId,
    }));

    harness.registerTool({
      name: 'get_total',
      description: 'Invoice total',
      parameters: { type: 'object', properties: { invoice: { type: 'string' } }, required: ['invoice'] },
      handler,
    });

    const session = harness.session(CONV, { userId: 'u1' });
    const events = await collect(session.stream('Totals?', { toolActivity: true }));
    const completed = events.find((event) => event.type === 'turn.completed');

    expect(handler).toHaveBeenCalledTimes(2);
    expect(requests[0].body).toEqual(
      expect.objectContaining({
        conversation: CONV,
        tools: [expect.objectContaining({ type: 'function', name: 'get_total' })],
        parallel_tool_calls: true,
        tool_activity: true,
      }),
    );
    expect(requests[1].body).toEqual({
      model: 'default',
      input: [
        {
          type: 'function_call_output',
          call_id: 'call_aaaaaaaaaaaaaaaaaaaaaaaa',
          output: JSON.stringify({ invoice: 'INV-7', total: 100, user: 'u1' }),
        },
        {
          type: 'function_call_output',
          call_id: 'call_bbbbbbbbbbbbbbbbbbbbbbbb',
          output: JSON.stringify({ invoice: 'INV-8', total: 200, user: 'u1' }),
        },
      ],
      conversation: CONV,
      tools: expect.any(Array),
      parallel_tool_calls: true,
      tool_activity: true,
      stream: true,
    });
    expect(events.map((event) => event.type)).toEqual([
      'turn.started',
      'text.delta',
      'agent.activity',
      'tool.call',
      'tool.call',
      'tool.result',
      'tool.result',
      'turn.started',
      'text.done',
      'turn.completed',
    ]);
    expect(completed).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          text: 'INV-7: 100, INV-8: 200',
          rounds: 2,
          toolCalls: [
            expect.objectContaining({ name: 'get_total', status: 'completed' }),
            expect.objectContaining({ name: 'get_total', status: 'completed' }),
          ],
          activity: [expect.objectContaining({ name: 'bash' })],
          usage: expect.objectContaining({ totalTokens: 24 }),
        }),
      }),
    );
  });

  it('uses the chat id for continuations of primary-session turns', async () => {
    const { harness, requests } = harnessWith([
      sse([
        { type: 'response.completed', response: response([functionCall('call_cccccccccccccccccccccccc', 'noop', {})]) },
      ]),
      sse([{ type: 'response.completed', response: response([message('done')]) }]),
    ]);

    harness.registerTool({ name: 'noop', handler: () => 'ok' });
    await harness.run('go');

    expect(requests[0].body.chat_id).toBeUndefined();
    expect(requests[1].body.chat_id).toBe(CHAT);
  });

  it('does not offer tools that are disabled for the context and refuses unexpected calls', async () => {
    const { harness, requests } = harnessWith([
      sse([
        {
          type: 'response.completed',
          response: response([functionCall('call_dddddddddddddddddddddddd', 'admin_only', {})]),
        },
      ]),
      sse([{ type: 'response.completed', response: response([message('ok')]) }]),
    ]);
    const handler = jest.fn();

    harness.registerTool({ name: 'admin_only', enabled: (ctx) => ctx.userId === 'admin', handler });
    harness.registerTool({ name: 'public', handler: () => 1 });

    const result = await harness.run('x', { context: { userId: 'u1' } });

    expect(requests[0].body.tools.map((tool: { name: string }) => tool.name)).toEqual(['public']);
    expect(handler).not.toHaveBeenCalled();
    expect(result.toolCalls[0]).toEqual(
      expect.objectContaining({ status: 'failed', error: expect.objectContaining({ code: 'unknown_tool' }) }),
    );
  });

  it('answers calls beyond the tool budget with an error instead of executing them', async () => {
    const call = () =>
      sse([
        { type: 'response.completed', response: response([functionCall('call_eeeeeeeeeeeeeeeeeeeeeeee', 'noop', {})]) },
      ]);
    const { harness, requests } = harnessWith(
      [call(), call(), sse([{ type: 'response.completed', response: response([message('gave up')]) }])],
      { maxToolRounds: 1 },
    );
    const handler = jest.fn(() => 'ok');

    harness.registerTool({ name: 'noop', handler });

    const result = await harness.run('loop');

    expect(handler).toHaveBeenCalledTimes(0);
    expect(result.text).toBe('gave up');
    expect(JSON.parse(requests[1].body.input[0].output).error.code).toBe('tool_budget_exhausted');
  });

  it('maps API errors and failed streams', async () => {
    const { harness } = harnessWith([
      json(
        { error: { message: 'No access', type: 'permission_error', param: null, code: 'insufficient_permissions' } },
        403,
      ),
      sse([{ type: 'error', code: 'timeout', message: 'Agent timed out', param: null }]),
    ]);

    await expect(harness.run('a')).rejects.toEqual(
      expect.objectContaining({ status: 403, code: 'insufficient_permissions', message: 'No access' }),
    );

    const events = await collect(harness.stream('b'));

    expect(events[events.length - 1]).toEqual({
      type: 'turn.failed',
      error: { message: 'Agent timed out', code: 'timeout', status: 500 },
    });
  });

  it('reports content-filtered turns as incomplete', async () => {
    const { harness } = harnessWith([
      sse([{ type: 'response.incomplete', response: response([message('')], 'incomplete') }]),
    ]);

    await expect(harness.run('x')).resolves.toEqual(expect.objectContaining({ status: 'incomplete' }));
  });

  it('serializes turns of the same conversation', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const { harness } = harnessWith([
      () => {
        order.push('first-start');

        return sse([
          {
            type: 'response.completed',
            response: response([functionCall('call_ffffffffffffffffffffffff', 'wait', {})]),
          },
        ]);
      },
      () => {
        order.push('first-continue');

        return sse([{ type: 'response.completed', response: response([message('1')]) }]);
      },
      () => {
        order.push('second-start');

        return sse([{ type: 'response.completed', response: response([message('2')]) }]);
      },
    ]);

    harness.registerTool({ name: 'wait', handler: () => gate });

    const first = harness.run('one', { conversationId: CONV });
    const second = harness.run('two', { conversationId: CONV });

    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'first-continue', 'second-start']);
  });

  it('answers pending client tool calls when the turn is aborted and drains repeated calls', async () => {
    const cancelled = JSON.stringify({
      error: {
        message: 'The user cancelled this request. Do not call any tools again; reply that the request was cancelled.',
        code: 'aborted',
      },
    });
    const { harness, requests } = harnessWith([
      sse([
        {
          type: 'response.completed',
          response: response([
            functionCall('call_gggggggggggggggggggggggg', 'slow', {}),
            functionCall('call_hhhhhhhhhhhhhhhhhhhhhhhh', 'fast', {}),
          ]),
        },
      ]),
      // The agent retries the tool after the cancellation: answered again without executing it.
      sse([
        { type: 'response.completed', response: response([functionCall('call_jjjjjjjjjjjjjjjjjjjjjjjj', 'slow', {})]) },
      ]),
      sse([{ type: 'response.completed', response: response([message('Cancelled.')]) }]),
    ]);
    const controller = new AbortController();
    const slow = jest.fn(() => new Promise(() => undefined));

    harness.registerTool({ name: 'slow', handler: slow });
    harness.registerTool({ name: 'fast', handler: () => 'fast result' });

    const run = harness.run('x', { conversationId: CONV, signal: controller.signal });

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    await expect(run).rejects.toBeInstanceOf(AgentHarnessAbortError);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(slow).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(3);
    expect(requests[1].body).toEqual({
      model: 'default',
      input: [
        { type: 'function_call_output', call_id: 'call_gggggggggggggggggggggggg', output: cancelled },
        { type: 'function_call_output', call_id: 'call_hhhhhhhhhhhhhhhhhhhhhhhh', output: cancelled },
      ],
      conversation: CONV,
      stream: true,
    });
    expect(requests[2].body.input).toEqual([
      { type: 'function_call_output', call_id: 'call_jjjjjjjjjjjjjjjjjjjjjjjj', output: cancelled },
    ]);
  });

  it('answers pending calls with computed outputs when the consumer stops iterating', async () => {
    const { harness, requests } = harnessWith([
      sse([
        { type: 'response.completed', response: response([functionCall('call_iiiiiiiiiiiiiiiiiiiiiiii', 'fast', {})]) },
      ]),
      sse([{ type: 'response.completed', response: response([message('ignored')]) }]),
    ]);

    harness.registerTool({ name: 'fast', handler: () => 'fast result' });

    for await (const event of harness.turn('x', { conversationId: CONV })) {
      if (event.type === 'tool.result') {
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(requests[1].body.input).toEqual([
      { type: 'function_call_output', call_id: 'call_iiiiiiiiiiiiiiiiiiiiiiii', output: 'fast result' },
    ]);
  });

  it('aborts turns', async () => {
    const { harness } = harnessWith([]);
    const controller = new AbortController();

    controller.abort();
    await expect(harness.run('x', { signal: controller.signal })).rejects.toBeInstanceOf(AgentHarnessAbortError);
  });

  it('validates messages and tool choices', async () => {
    const { harness } = harnessWith([]);

    await expect(harness.run('  ')).rejects.toBeInstanceOf(AgentHarnessConfigError);
    harness.registerTool({ name: 'a', handler: () => 1 });
    await expect(harness.run('x', { toolChoice: { name: 'b' } })).rejects.toThrow("tool choice 'b' is not offered");
  });
});

describe('AgentHarnessClient conversations', () => {
  it('creates, reads, pages and deletes conversations', async () => {
    const conversation = { id: CONV, object: 'conversation', created_at: 1, metadata: { agenstra_chat_id: CHAT } };
    const item = (id: string) => ({
      type: 'message',
      id,
      status: 'completed',
      role: 'user',
      content: [],
      created_at: 1,
    });
    const server = fakeServer([
      json(conversation),
      json({ object: 'list', data: [item('msg_1')], first_id: 'msg_1', last_id: 'msg_1', has_more: true }),
      json({ object: 'list', data: [item('msg_2')], first_id: 'msg_2', last_id: 'msg_2', has_more: false }),
      json({ id: CONV, object: 'conversation.deleted', deleted: true }),
    ]);
    const client = new AgentHarnessClient({
      apiUrl: 'https://agenstra.example.com/api',
      clientId: CLIENT,
      agentId: AGENT,
      fetch: server.fetch,
    });

    await expect(client.createConversation({ title: 'Nightly' })).resolves.toEqual(conversation);

    const ids: string[] = [];

    for await (const entry of client.iterateConversationItems(CHAT)) {
      ids.push(entry.id);
    }

    await client.deleteConversation(CONV);

    expect(ids).toEqual(['msg_1', 'msg_2']);
    expect(server.requests.map((request) => `${request.method} ${request.url.replace(BASE, '')}`)).toEqual([
      'POST /conversations',
      `GET /conversations/${CONV}/items?limit=100&order=asc`,
      `GET /conversations/${CONV}/items?limit=100&order=asc&after=msg_1`,
      `DELETE /conversations/${CONV}`,
    ]);
    expect(server.requests[0].body).toEqual({ metadata: { title: 'Nightly' } });
    expect(server.requests[0].headers['Authorization']).toBeUndefined();
  });

  it('returns history without the harness instructions block', async () => {
    const server = fakeServer([
      json({
        object: 'list',
        data: [
          {
            type: 'message',
            id: 'msg_1',
            status: 'completed',
            role: 'user',
            content: [
              { type: 'input_text', text: '<harness_instructions>\nSecret rules\n</harness_instructions>\n\nHello' },
            ],
            created_at: 1,
          },
          {
            type: 'message',
            id: 'msg_2',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: '<harness_instructions>kept</harness_instructions>' }],
            created_at: 2,
          },
        ],
        first_id: 'msg_1',
        last_id: 'msg_2',
        has_more: false,
      }),
    ]);
    const harness = new AgentHarness({
      connection: { apiUrl: 'https://agenstra.example.com/api', clientId: CLIENT, agentId: AGENT, fetch: server.fetch },
    });
    const items = await harness.history(CONV);

    expect(items.map((item) => item.content[0].text)).toEqual([
      'Hello',
      '<harness_instructions>kept</harness_instructions>',
    ]);
  });

  it('rejects malformed conversation ids before building URLs', async () => {
    const client = new AgentHarnessClient({
      apiUrl: 'https://agenstra.example.com/api',
      clientId: CLIENT,
      agentId: AGENT,
      fetch: jest.fn(),
    });

    await expect(client.getConversation('../../admin')).rejects.toBeInstanceOf(AgentHarnessConfigError);
  });

  it('maps network failures to unreachable errors', async () => {
    const client = new AgentHarnessClient({
      apiUrl: 'https://agenstra.example.com/api',
      clientId: CLIENT,
      agentId: AGENT,
      fetch: jest.fn().mockRejectedValue(new TypeError('fetch failed')),
    });

    await expect(client.listModels()).rejects.toEqual(expect.objectContaining({ status: 503, code: 'unreachable' }));
    expect(new AgentHarnessApiError(503, 'x', 'server_error').retryable).toBe(true);
  });
});
