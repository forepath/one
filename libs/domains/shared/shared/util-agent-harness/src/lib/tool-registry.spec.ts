import { AgentHarnessAbortError, AgentHarnessConfigError, AgentToolError } from './agent-harness.errors';
import { AgentToolRegistry, type AgentToolExecutionOptions } from './tool-registry';

interface Ctx {
  userId: string;
  canBook: boolean;
}

const context: Ctx = { userId: 'u1', canBook: true };

function options(overrides: Partial<AgentToolExecutionOptions<Ctx>> = {}): AgentToolExecutionOptions<Ctx> {
  return { context, conversationId: 'conv_x', offered: new Set(['echo', 'book', 'slow', 'boom']), ...overrides };
}

function registry(): AgentToolRegistry<Ctx> {
  const tools = new AgentToolRegistry<Ctx>();

  tools.register({
    name: 'echo',
    description: 'Echo',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 10 } },
      required: ['text'],
      additionalProperties: false,
    },
    handler: (args: { text: string }, ctx) => ({ text: args.text, user: ctx.context.userId, callId: ctx.callId }),
  });
  tools.register({
    name: 'book',
    parameters: { type: 'object', properties: { amount: { type: 'number' } } },
    enabled: (ctx) => ctx.canBook,
    requiresApproval: true,
    tags: ['billing'],
    handler: () => 'booked',
  });

  return tools;
}

describe('AgentToolRegistry', () => {
  it('validates registrations', () => {
    const tools = registry();

    expect(() => tools.register({ name: 'bad name', handler: () => 1 })).toThrow(AgentHarnessConfigError);
    expect(() => tools.register({ name: 'echo', handler: () => 1 })).toThrow('already registered');
    expect(() => tools.register({ name: 'x', parameters: { type: 'string' }, handler: () => 1 })).toThrow(
      'object JSON schema',
    );
    expect(() => tools.register({ name: 'y', description: 'd'.repeat(5000), handler: () => 1 })).toThrow(
      'at most 4096',
    );
  });

  it('offers enabled tools only and supports selections', async () => {
    const tools = registry();

    expect((await tools.offer(context)).map((tool) => tool.name)).toEqual(['echo', 'book']);
    expect((await tools.offer({ ...context, canBook: false })).map((tool) => tool.name)).toEqual(['echo']);
    expect((await tools.offer(context, { tags: ['billing'] })).map((tool) => tool.name)).toEqual(['book']);
    expect((await tools.offer(context, { names: ['echo'] }))[0]).toEqual({
      type: 'function',
      name: 'echo',
      description: 'Echo',
      parameters: expect.objectContaining({ required: ['text'] }),
    });
  });

  it('executes a call with the run context', async () => {
    const execution = await registry().execute(
      { callId: 'call_1', name: 'echo', arguments: '{"text":"hi"}' },
      options(),
    );

    expect(execution.status).toBe('completed');
    expect(JSON.parse(execution.output)).toEqual({ text: 'hi', user: 'u1', callId: 'call_1' });
  });

  it('rejects tools that were not offered in the turn', async () => {
    const execution = await registry().execute(
      { callId: 'call_1', name: 'echo', arguments: '{"text":"hi"}' },
      options({ offered: new Set(['book']) }),
    );

    expect(execution.status).toBe('failed');
    expect(execution.error?.code).toBe('unknown_tool');
  });

  it('rejects invalid JSON and schema violations', async () => {
    const tools = registry();
    const invalidJson = await tools.execute({ callId: 'c', name: 'echo', arguments: '{' }, options());
    const invalidArgs = await tools.execute(
      { callId: 'c', name: 'echo', arguments: '{"text":"waytoolongvalue","extra":1}' },
      options(),
    );

    expect(invalidJson.error?.code).toBe('invalid_arguments');
    expect(invalidArgs.error?.message).toContain('$.text must have at most 10 characters');
    expect(invalidArgs.error?.message).toContain('$.extra is not allowed');
  });

  it('applies the parse hook', async () => {
    const tools = new AgentToolRegistry<Ctx>();

    tools.register({
      name: 'echo',
      parse: (raw) => {
        if (!(raw as { ok?: boolean }).ok) {
          throw new Error('ok must be true');
        }

        return raw as { ok: true };
      },
      handler: () => 'fine',
    });

    const execution = await tools.execute({ callId: 'c', name: 'echo', arguments: '{}' }, options());

    expect(execution.error?.message).toBe('Invalid arguments: ok must be true');
  });

  it('denies approval-gated tools without an approval handler and honours the handler', async () => {
    const tools = registry();
    const call = { callId: 'c', name: 'book', arguments: '{"amount":5}' };

    expect((await tools.execute(call, options())).status).toBe('denied');
    expect((await tools.execute(call, options({ approve: async () => false }))).status).toBe('denied');

    const approve = jest.fn().mockResolvedValue(true);
    const execution = await tools.execute(call, options({ approve }));

    expect(execution.status).toBe('completed');
    expect(execution.output).toBe('booked');
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ name: 'book', args: { amount: 5 }, context }));
  });

  it('reports AgentToolError messages but masks unexpected errors', async () => {
    const tools = new AgentToolRegistry<Ctx>();
    const onError = jest.fn();

    tools.register({
      name: 'echo',
      handler: () => {
        throw new AgentToolError('Invoice not found', 'not_found');
      },
    });
    tools.register({
      name: 'boom',
      handler: () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret');
      },
    });

    const known = await tools.execute({ callId: 'c', name: 'echo', arguments: '' }, options({ onError }));
    const unknown = await tools.execute({ callId: 'c', name: 'boom', arguments: '' }, options({ onError }));

    expect(JSON.parse(known.output)).toEqual({ error: { message: 'Invoice not found', code: 'not_found' } });
    expect(unknown.output).not.toContain('ECONNREFUSED');
    expect(unknown.error).toEqual({ message: 'The tool failed with an internal error', code: 'internal_error' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('times out slow tools and aborts their signal', async () => {
    const tools = new AgentToolRegistry<Ctx>();
    let signal: AbortSignal | undefined;

    tools.register({
      name: 'slow',
      timeoutMs: 20,
      handler: (_args, ctx) => {
        signal = ctx.signal;

        return new Promise(() => undefined);
      },
    });

    const execution = await tools.execute({ callId: 'c', name: 'slow', arguments: '' }, options());

    expect(execution.error?.code).toBe('timeout');
    expect(signal?.aborted).toBe(true);
  });

  it('propagates aborts of the turn', async () => {
    const tools = new AgentToolRegistry<Ctx>();
    const controller = new AbortController();

    tools.register({ name: 'slow', handler: () => new Promise(() => undefined) });

    const pending = tools.execute({ callId: 'c', name: 'slow', arguments: '' }, options({ signal: controller.signal }));

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AgentHarnessAbortError);
  });

  it('truncates very long output', async () => {
    const tools = new AgentToolRegistry<Ctx>();

    tools.register({ name: 'echo', handler: () => 'x'.repeat(150_000) });

    const execution = await tools.execute({ callId: 'c', name: 'echo', arguments: '' }, options());

    expect(execution.output.length).toBeLessThanOrEqual(100_000);
    expect(execution.output).toContain('[truncated');
  });
});
