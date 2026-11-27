import type { AgentClientToolRequest, AgentClientToolResponse } from '@forepath/agenstra/shared/util-opencode-config';
import { BadGatewayException } from '@nestjs/common';

import { OpenAiApiError } from '../utils/openai-compatible-errors';

import {
  OpenAiClientToolTurnsService,
  type ClientToolTurnHandle,
  type ClientToolTurnUpdate,
} from './openai-client-tool-turns.service';
import type { OpenAiTurnRelayStore, RelayedCallRecord } from './openai-turn-relay.store';

/** In-memory stand-in for Valkey shared by several "replicas". */
class SharedKv {
  readonly values = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
}

function fakeRelay(kv: SharedKv, instanceId: string): OpenAiTurnRelayStore {
  return {
    instanceId,
    isEnabled: () => true,
    registerCall: async (callId: string, record: RelayedCallRecord) => {
      kv.values.set(`call:${callId}`, JSON.stringify(record));

      return true;
    },
    lookupCall: async (callId: string) => {
      const raw = kv.values.get(`call:${callId}`);

      return raw ? JSON.parse(raw) : null;
    },
    deleteCall: async (callId: string) => void kv.values.delete(`call:${callId}`),
    registerLegacyCall: async (binding: any, name: string, callId: string) =>
      void kv.values.set(`legacy:${JSON.stringify(binding)}:${name}`, callId),
    lookupLegacyCall: async (binding: any, name: string) =>
      kv.values.get(`legacy:${JSON.stringify(binding)}:${name}`) ?? null,
    deleteLegacyCall: async (binding: any, name: string) =>
      void kv.values.delete(`legacy:${JSON.stringify(binding)}:${name}`),
    pushInbox: async (turnId: string, message: unknown) => {
      kv.lists.set(`in:${turnId}`, [...(kv.lists.get(`in:${turnId}`) ?? []), JSON.stringify(message)]);

      return true;
    },
    pullInbox: async (turnId: string) => (kv.lists.get(`in:${turnId}`)?.splice(0) ?? []).map((v) => JSON.parse(v)),
    pushOutbox: async (turnId: string, requestId: string, message: unknown) => {
      const key = `out:${turnId}:${requestId}`;

      kv.lists.set(key, [...(kv.lists.get(key) ?? []), JSON.stringify(message)]);

      return true;
    },
    pullOutbox: async (turnId: string, requestId: string) =>
      (kv.lists.get(`out:${turnId}:${requestId}`)?.splice(0) ?? []).map((v) => JSON.parse(v)),
  } as unknown as OpenAiTurnRelayStore;
}

/** Controllable agent turn: the test plays the manager (client tool requests) and finishes the turn. */
function fakeOpenAi() {
  const turns: Array<{
    params: any;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    request: (request: AgentClientToolRequest) => Promise<AgentClientToolResponse>;
  }> = [];

  return {
    turns,
    service: {
      runTurn: jest.fn(
        (params: any) =>
          new Promise((resolve, reject) => {
            turns.push({
              params,
              resolve,
              reject,
              request: (request) => new Promise((respond) => params.onClientToolRequest(request, respond)),
            });
          }),
      ),
    },
  };
}

const binding = { principal: 'user:u1|pat:p1', clientId: 'c1', agentId: 'a1', chatId: 'chat-1' };
const callRequest = (callId: string, name = 'get_weather', args = '{"city":"Berlin"}'): AgentClientToolRequest => ({
  op: 'call',
  agentId: 'a1',
  correlationId: 'corr',
  callId,
  name,
  arguments: args,
});

async function collect(handle: ClientToolTurnHandle): Promise<ClientToolTurnUpdate[]> {
  const updates: ClientToolTurnUpdate[] = [];

  for (;;) {
    const update = await handle.next();

    if (!update) {
      return updates;
    }

    updates.push(update);
  }
}

describe('OpenAiClientToolTurnsService', () => {
  let kv: SharedKv;
  let openAi: ReturnType<typeof fakeOpenAi>;
  let service: OpenAiClientToolTurnsService;
  const start = (svc = service, extra: Record<string, unknown> = {}) =>
    svc.start({
      binding,
      turn: { clientId: 'c1', agentId: 'a1', chatId: 'chat-1', prompt: 'hi', userId: 'u1' },
      clientTools: { tools: [{ name: 'get_weather' }], choice: 'auto', parallel: true },
      liveDeltas: true,
      toolActivity: false,
      ...extra,
    });

  beforeEach(() => {
    kv = new SharedKv();
    openAi = fakeOpenAi();
    service = new OpenAiClientToolTurnsService(openAi.service as any, fakeRelay(kv, 'replica-a'));
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('pauses on client tool calls and continues with the results', async () => {
    const first = start();
    const turn = openAi.turns[0];

    expect(turn.params.clientTools).toEqual({ tools: [{ name: 'get_weather' }], choice: 'auto', parallel: true });
    turn.params.onDeltaText('Checking. ');
    const ack = turn.request(callRequest('call_1'));

    expect(await collect(first)).toEqual([
      { type: 'delta', delta: 'Checking. ' },
      { type: 'tool_calls', calls: [{ callId: 'call_1', name: 'get_weather', arguments: '{"city":"Berlin"}' }] },
    ]);
    expect(JSON.parse(kv.values.get('call:call_1') as string)).toEqual(
      expect.objectContaining({ owner: 'replica-a', binding }),
    );

    const second = await service.resume({ principal: binding.principal, clientId: 'c1', agentId: 'a1' }, [
      { callId: 'call_1', output: '{"temp":21}' },
    ]);

    await expect(ack).resolves.toEqual({ ok: true, status: 'completed', output: '{"temp":21}' });
    expect(kv.values.has('call:call_1')).toBe(false);
    turn.params.onDeltaText('Sunny.');
    turn.resolve({ text: 'Sunny.', finishReason: 'stop', usage: { inputTokens: 1 }, response: { type: 'result' } });

    expect(await collect(second)).toEqual([
      { type: 'delta', delta: 'Sunny.' },
      {
        type: 'final',
        result: { text: 'Sunny.', finishReason: 'stop', usage: { inputTokens: 1 }, response: { type: 'result' } },
      },
    ]);
    expect(second.chatId).toBe('chat-1');
  });

  it('hands concurrent calls to the client together (parallel tool calls)', async () => {
    const handle = start();
    const turn = openAi.turns[0];

    void turn.request(callRequest('call_1'));
    void turn.request(callRequest('call_2', 'get_time', '{}'));

    const [update] = await collect(handle);

    expect(update).toEqual({
      type: 'tool_calls',
      calls: [
        expect.objectContaining({ callId: 'call_1' }),
        expect.objectContaining({ callId: 'call_2', name: 'get_time' }),
      ],
    });
  });

  it('answers the manager pending before its ack timeout and completes later waits immediately', async () => {
    jest.useFakeTimers();
    const handle = start();
    const turn = openAi.turns[0];
    const ack = turn.request(callRequest('call_1'));

    await jest.advanceTimersByTimeAsync(250);
    await collect(handle);
    await jest.advanceTimersByTimeAsync(37_000);
    await expect(ack).resolves.toEqual({ ok: true, status: 'pending' });

    await service.resume(binding, [{ callId: 'call_1', output: 'done' }]);
    await expect(turn.request({ op: 'wait', agentId: 'a1', correlationId: 'corr', callId: 'call_1' })).resolves.toEqual(
      {
        ok: true,
        status: 'completed',
        output: 'done',
      },
    );
    await expect(
      turn.request({ op: 'wait', agentId: 'a1', correlationId: 'corr', callId: 'call_unknown' }),
    ).resolves.toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('fails calls the client never answers', async () => {
    jest.useFakeTimers();
    process.env['OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_MS'] = '20000';

    try {
      const handle = start();
      const turn = openAi.turns[0];

      void turn.request(callRequest('call_1'));
      await jest.advanceTimersByTimeAsync(250);
      await collect(handle);
      const wait = turn.request({ op: 'wait', agentId: 'a1', correlationId: 'corr', callId: 'call_1' });

      await jest.advanceTimersByTimeAsync(20_000);
      await expect(wait).resolves.toEqual(expect.objectContaining({ ok: true, status: 'failed' }));
      await expect(service.resume(binding, [{ callId: 'call_1', output: 'late' }])).rejects.toMatchObject({
        errorCode: 'tool_call_not_found',
      });
    } finally {
      delete process.env['OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_MS'];
    }
  });

  it.each([
    ['another principal', { ...binding, principal: 'user:u2|session' }],
    ['another credential of the same user', { ...binding, principal: 'user:u1|pat:p2' }],
    ['another agent', { ...binding, agentId: 'a2' }],
    ['another chat', { ...binding, chatId: 'chat-2' }],
  ])('refuses continuations by %s', async (_label, other) => {
    const handle = start();

    void openAi.turns[0].request(callRequest('call_1'));
    await collect(handle);

    await expect(service.resume(other, [{ callId: 'call_1', output: 'x' }])).rejects.toBeInstanceOf(OpenAiApiError);
    // Still pending for the rightful client.
    await expect(service.resume(binding, [{ callId: 'call_1', output: 'x' }])).resolves.toBeDefined();
  });

  it('refuses unknown and already answered calls', async () => {
    const handle = start();

    void openAi.turns[0].request(callRequest('call_1'));
    await collect(handle);
    await expect(service.resume(binding, [{ callId: 'call_nope', output: 'x' }])).rejects.toMatchObject({
      errorCode: 'tool_call_not_found',
    });
    await service.resume(binding, [{ callId: 'call_1', output: 'x' }]);
    await expect(service.resume(binding, [{ callId: 'call_1', output: 'again' }])).rejects.toMatchObject({
      errorCode: 'tool_call_not_found',
    });
    await expect(service.resume(binding, [])).rejects.toBeInstanceOf(OpenAiApiError);
  });

  it('reports turn errors and gates live updates', async () => {
    const handle = start(service, { liveDeltas: false });
    const turn = openAi.turns[0];

    expect(turn.params.onDeltaText).toBeUndefined();
    expect(turn.params.onToolEvent).toBeUndefined();
    turn.reject(new BadGatewayException('The agent failed to answer'));

    expect(await collect(handle)).toEqual([
      {
        type: 'error',
        status: 502,
        body: expect.objectContaining({ error: expect.objectContaining({ message: 'The agent failed to answer' }) }),
      },
    ]);
  });

  it('buffers updates while no request listens and replays them to the next one', async () => {
    const handle = start();
    const turn = openAi.turns[0];

    void turn.request(callRequest('call_1'));
    await collect(handle);
    const resumed = await service.resume(binding, [{ callId: 'call_1', output: 'x' }]);

    resumed.close();
    turn.resolve({ text: 'late answer', finishReason: 'stop' });
    await new Promise((resolve) => setImmediate(resolve));

    // A client that went away cannot pick up the answer with another call (nothing pending), but the turn finished.
    await expect(service.resume(binding, [{ callId: 'call_1', output: 'x' }])).rejects.toBeInstanceOf(OpenAiApiError);
  });

  describe('across replicas', () => {
    let replicaB: OpenAiClientToolTurnsService;

    beforeEach(() => {
      replicaB = new OpenAiClientToolTurnsService({ runTurn: jest.fn() } as any, fakeRelay(kv, 'replica-b'));
    });

    afterEach(() => replicaB.onModuleDestroy());

    it('forwards results to the owning replica and relays the outcome back', async () => {
      const handle = start();
      const turn = openAi.turns[0];
      const ack = turn.request(callRequest('call_1'));

      await collect(handle);
      const relayed = await replicaB.resume({ principal: binding.principal, clientId: 'c1', agentId: 'a1' }, [
        { callId: 'call_1', output: 'from B' },
      ]);

      await expect(ack).resolves.toEqual({ ok: true, status: 'completed', output: 'from B' });
      turn.params.onDeltaText('Sunny');
      turn.resolve({ text: 'Sunny', finishReason: 'stop' });

      expect(await collect(relayed)).toEqual([
        { type: 'delta', delta: 'Sunny' },
        { type: 'final', result: { text: 'Sunny', finishReason: 'stop' } },
      ]);
      expect(relayed.chatId).toBe('chat-1');
    });

    it('refuses relayed continuations of other principals', async () => {
      const handle = start();

      void openAi.turns[0].request(callRequest('call_1'));
      await collect(handle);

      await expect(
        replicaB.resume({ ...binding, principal: 'user:u2|session' }, [{ callId: 'call_1', output: 'x' }]),
      ).rejects.toMatchObject({ errorCode: 'tool_call_not_found' });
    });

    it('gives up when the owning replica does not accept the hand-off', async () => {
      kv.values.set(
        'call:call_orphan',
        JSON.stringify({ turnId: 'gone', owner: 'replica-gone', binding } satisfies RelayedCallRecord),
      );
      jest.useFakeTimers();

      const relayed = await replicaB.resume(binding, [{ callId: 'call_orphan', output: 'x' }]);
      const updates = collect(relayed);

      await jest.advanceTimersByTimeAsync(16_000);

      expect(await updates).toEqual([
        expect.objectContaining({
          type: 'error',
          status: 404,
          body: expect.objectContaining({ error: expect.objectContaining({ code: 'tool_call_not_found' }) }),
        }),
      ]);
    });

    it('resolves legacy function calls by name, locally and from another replica', async () => {
      const handle = start(service, { legacyFunctions: true });

      void openAi.turns[0].request(callRequest('call_1'));
      await collect(handle);

      await expect(service.resolveLegacyCallId(binding, 'get_weather')).resolves.toBe('call_1');
      await expect(replicaB.resolveLegacyCallId(binding, 'get_weather')).resolves.toBe('call_1');
      await expect(
        replicaB.resolveLegacyCallId({ ...binding, chatId: 'chat-2' }, 'get_weather'),
      ).resolves.toBeUndefined();

      await service.resume(binding, [{ callId: 'call_1', output: 'x' }]);
      await expect(replicaB.resolveLegacyCallId(binding, 'get_weather')).resolves.toBeUndefined();
    });
  });
});
