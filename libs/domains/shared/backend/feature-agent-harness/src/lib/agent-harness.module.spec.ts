import { EventEmitter } from 'node:events';

import type { AgentHarnessEvent, AgentToolContext } from '@forepath/shared/shared/util-agent-harness';
import { Injectable, Scope } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Response } from 'express';

import { AgentContext, AgentTool } from './agent-harness.decorators';
import { AgentHarnessModule } from './agent-harness.module';
import { agentHarnessOptionsFromEnv } from './agent-harness.options';
import { AgentHarnessTurnRequestDto, relayAgentHarnessTurn } from './agent-harness.relay';
import { AgentHarnessService } from './agent-harness.service';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';

interface BillingContext {
  tenantId: string;
}

@Injectable()
class InvoiceTools {
  readonly calls: string[] = [];

  @AgentTool({
    name: 'get_invoice_total',
    description: 'Invoice total',
    parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] },
  })
  total(args: { number: string }, ctx: AgentToolContext<BillingContext>) {
    this.calls.push(`${ctx.context.tenantId}:${args.number}`);

    return { total: 42 };
  }

  @AgentContext('tenant', { order: 1 })
  tenant(context: BillingContext) {
    return `Tenant ${context.tenantId}`;
  }
}

@Injectable({ scope: Scope.REQUEST })
class RequestScopedTools {
  @AgentTool({ name: 'request_scoped' })
  run() {
    return 1;
  }
}

function sse(events: Array<Record<string, unknown>>): Response {
  return new globalThis.Response(
    events.map((event) => `event: ${event['type']}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream', 'X-Agenstra-Chat-Id': CHAT } },
  ) as unknown as Response;
}

describe('AgentHarnessModule', () => {
  it('discovers decorated singleton providers and runs tool turns with the run context', async () => {
    const bodies: any[] = [];
    const replies = [
      sse([
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            status: 'completed',
            output_text: '',
            output: [
              {
                type: 'function_call',
                id: 'fc_1',
                call_id: 'call_aaaaaaaaaaaaaaaaaaaaaaaa',
                name: 'get_invoice_total',
                arguments: '{"number":"INV-7"}',
                status: 'completed',
              },
            ],
          },
        },
      ]),
      sse([
        {
          type: 'response.completed',
          response: { id: 'resp_2', status: 'completed', output_text: 'The total is 42.', output: [] },
        },
      ]),
    ];
    const fetch = jest.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));

      return replies.shift();
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        AgentHarnessModule.forRootAsync({
          useFactory: () => ({
            connection: {
              apiUrl: 'https://agenstra.example.com/api',
              clientId: CLIENT,
              agentId: AGENT,
              fetch: fetch as any,
            },
            instructions: 'Billing assistant',
          }),
        }),
      ],
      providers: [InvoiceTools, RequestScopedTools],
    }).compile();

    await moduleRef.init();

    const service = moduleRef.get(AgentHarnessService);
    const tools = moduleRef.get(InvoiceTools);

    expect(service.harness.tools.list().map((tool) => tool.name)).toEqual(['get_invoice_total']);

    const result = await service.run('Total of INV-7?', { context: { tenantId: 't1' } });

    expect(result.text).toBe('The total is 42.');
    expect(tools.calls).toEqual(['t1:INV-7']);
    expect(bodies[0].instructions).toBe(
      '<harness_instructions>\nBilling assistant\n\n<context name="tenant">\nTenant t1\n</context>\n</harness_instructions>',
    );
    expect(bodies[1].input).toEqual([
      { type: 'function_call_output', call_id: 'call_aaaaaaaaaaaaaaaaaaaaaaaa', output: '{"total":42}' },
    ]);

    await moduleRef.close();
  });

  it('skips discovery when disabled', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AgentHarnessModule.forRoot({
          connection: {
            apiUrl: 'https://agenstra.example.com/api',
            clientId: CLIENT,
            agentId: AGENT,
            fetch: jest.fn(),
          },
          discover: false,
        }),
      ],
      providers: [InvoiceTools],
    }).compile();

    await moduleRef.init();
    expect(moduleRef.get(AgentHarnessService).harness.tools.size).toBe(0);
    await moduleRef.close();
  });
});

describe('agentHarnessOptionsFromEnv', () => {
  it('reads prefixed variables and returns undefined when unconfigured', () => {
    expect(agentHarnessOptionsFromEnv('BILLING_AGENT', {})).toBeUndefined();
    expect(
      agentHarnessOptionsFromEnv('BILLING_AGENT', {
        BILLING_AGENT_API_URL: 'https://a.example.com/api',
        BILLING_AGENT_CLIENT_ID: CLIENT,
        BILLING_AGENT_AGENT_ID: AGENT,
        BILLING_AGENT_API_KEY: 'fp_pat_x',
        BILLING_AGENT_MODEL: 'opencode/x',
        BILLING_AGENT_TOOL_ACTIVITY: 'true',
        BILLING_AGENT_MAX_TOOL_ROUNDS: '5',
      }),
    ).toEqual({
      connection: { apiUrl: 'https://a.example.com/api', clientId: CLIENT, agentId: AGENT, credential: 'fp_pat_x' },
      model: 'opencode/x',
      toolActivity: true,
      maxToolRounds: 5,
    });
  });
});

class FakeResponse extends EventEmitter {
  chunks: string[] = [];
  headers: Record<string, string> = {};
  writableEnded = false;
  destroyed = false;
  statusCode = 0;

  status(code: number) {
    this.statusCode = code;

    return this;
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  flushHeaders() {
    return undefined;
  }

  write(chunk: string) {
    this.chunks.push(chunk);

    return true;
  }

  end() {
    this.writableEnded = true;
    this.emit('close');
  }
}

describe('relayAgentHarnessTurn', () => {
  it('streams redacted events by default', async () => {
    const res = new FakeResponse();

    async function* turn(): AsyncGenerator<AgentHarnessEvent> {
      yield { type: 'tool.call', call: { callId: 'c', name: 'n', arguments: '{"secret":true}' } };
      yield { type: 'text.delta', delta: 'hi' };
    }

    await relayAgentHarnessTurn(res as unknown as Response, () => turn());

    expect(res.headers['Content-Type']).toContain('text/event-stream');
    expect(res.chunks.join('')).not.toContain('secret');
    expect(res.chunks).toEqual([
      'event: tool.call\ndata: {"type":"tool.call","call":{"callId":"c","name":"n"}}\n\n',
      'event: text.delta\ndata: {"type":"text.delta","delta":"hi"}\n\n',
    ]);
    expect(res.writableEnded).toBe(true);
  });

  it('aborts the turn when the client disconnects and hides internal errors', async () => {
    const res = new FakeResponse();
    let signal!: AbortSignal;

    async function* turn(s: AbortSignal): AsyncGenerator<AgentHarnessEvent> {
      signal = s;
      res.emit('close');
      yield { type: 'text.delta', delta: 'late' };
    }

    await relayAgentHarnessTurn(res as unknown as Response, turn);
    expect(signal.aborted).toBe(true);

    const failing = new FakeResponse();

    // eslint-disable-next-line require-yield
    async function* broken(): AsyncGenerator<AgentHarnessEvent> {
      throw new Error('db password=secret');
    }

    await relayAgentHarnessTurn(failing as unknown as Response, broken);
    expect(failing.chunks.join('')).toContain('"type":"turn.failed"');
    expect(failing.chunks.join('')).not.toContain('secret');
  });
});

describe('AgentHarnessTurnRequestDto', () => {
  it('validates message and conversation id', () => {
    const valid = plainToInstance(AgentHarnessTurnRequestDto, { message: 'hi', conversationId: CHAT });
    const invalid = plainToInstance(AgentHarnessTurnRequestDto, { message: '', conversationId: '../x' });

    expect(validateSync(valid)).toHaveLength(0);
    expect(
      validateSync(invalid)
        .map((error) => error.property)
        .sort(),
    ).toEqual(['conversationId', 'message']);
  });
});
