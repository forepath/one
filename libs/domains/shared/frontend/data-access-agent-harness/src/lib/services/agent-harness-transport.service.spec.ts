import { HttpEventType, provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { encodeAgentHarnessEvent, type AgentHarnessEvent } from '@forepath/shared/shared/util-agent-harness';

import { AGENT_HARNESS_ENVIRONMENT } from '../tokens/agent-harness-environment';

import { AgentHarnessToolsService } from './agent-harness-tools.service';
import { AgentHarnessTransportService } from './agent-harness-transport.service';

const CONV = 'conv_33333333333343338333333333333333';

describe('AgentHarnessTransportService (relay)', () => {
  let service: AgentHarnessTransportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: AGENT_HARNESS_ENVIRONMENT, useValue: { mode: 'relay', relayUrl: '/api/assistant/' } },
      ],
    });
    service = TestBed.inject(AgentHarnessTransportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('streams relayed events from progress chunks', () => {
    const events: AgentHarnessEvent[] = [];
    let completed = false;

    service.send('Hello', CONV).subscribe({ next: (event) => events.push(event), complete: () => (completed = true) });

    const request = http.expectOne('/api/assistant/turns');
    const first = encodeAgentHarnessEvent({ type: 'text.delta', delta: 'Hi' });
    const second = encodeAgentHarnessEvent({ type: 'text.done', text: 'Hi' });

    expect(request.request.body).toEqual({ message: 'Hello', conversationId: CONV });
    request.event({ type: HttpEventType.DownloadProgress, loaded: 1, partialText: first.slice(0, 12) });
    expect(events).toEqual([]);
    request.event({ type: HttpEventType.DownloadProgress, loaded: 2, partialText: first + second.slice(0, 5) });
    expect(events).toEqual([{ type: 'text.delta', delta: 'Hi' }]);
    request.flush(first + second);

    expect(events).toEqual([
      { type: 'text.delta', delta: 'Hi' },
      { type: 'text.done', text: 'Hi' },
    ]);
    expect(completed).toBe(true);
  });

  it('loads history and creates conversations through the relay', () => {
    let items: unknown;

    service.history(CONV).subscribe((value) => (items = value));
    http.expectOne(`/api/assistant/conversations/${CONV}/items`).flush({ data: [{ id: 'msg_1' }] });
    expect(items).toEqual([{ id: 'msg_1' }]);

    service.createConversation('Title').subscribe();
    expect(http.expectOne('/api/assistant/conversations').request.body).toEqual({ title: 'Title' });
  });

  it('rejects malformed conversation ids', () => {
    expect(() => service.history('../admin')).toThrow();
  });
});

/** Minimal fetch Response (jsdom has no Response / ReadableStream). */
function fakeStreamResponse(text: string, headers: Record<string, string>) {
  const bytes = new TextEncoder().encode(text);
  let sent = false;

  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => undefined,
        releaseLock: () => undefined,
      }),
    },
  };
}

describe('AgentHarnessTransportService (direct)', () => {
  it('runs turns against the OpenAI-compatible API with browser tools', async () => {
    const fetchMock = jest.fn(async (_url: string, _init: RequestInit) =>
      fakeStreamResponse(
        [
          { type: 'response.output_text.delta', delta: 'Hi' },
          {
            type: 'response.completed',
            response: { id: 'resp_1', status: 'completed', output: [], output_text: 'Hi' },
          },
        ]
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { 'content-type': 'text/event-stream', 'x-agenstra-chat-id': '33333333-3333-4333-8333-333333333333' },
      ),
    );
    const originalFetch = globalThis.fetch;

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withXhr()),
          {
            provide: AGENT_HARNESS_ENVIRONMENT,
            useValue: {
              mode: 'direct',
              apiUrl: 'https://agenstra.example.com/api',
              clientId: '11111111-1111-4111-8111-111111111111',
              agentId: '22222222-2222-4222-8222-222222222222',
            },
          },
        ],
      });

      const tools = TestBed.inject(AgentHarnessToolsService);

      tools.registerTool({ name: 'navigate', handler: () => 'ok' });

      const events: AgentHarnessEvent[] = await new Promise((resolve, reject) => {
        const collected: AgentHarnessEvent[] = [];

        TestBed.inject(AgentHarnessTransportService)
          .send('Hello', null)
          .subscribe({ next: (event) => collected.push(event), error: reject, complete: () => resolve(collected) });
      });
      const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));

      expect(body.tools).toEqual([expect.objectContaining({ name: 'navigate' })]);
      expect(events.map((event) => event.type)).toEqual(['turn.started', 'text.delta', 'text.done', 'turn.completed']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
