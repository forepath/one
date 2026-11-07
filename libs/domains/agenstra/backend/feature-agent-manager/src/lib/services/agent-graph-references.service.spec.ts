import type { AgentEventEnvelope } from '../providers/agent-events.types';

import { AgentGraphReferencesService } from './agent-graph-references.service';

const AGENT = 'a1';
const TURN = 'turn-1';

function event(kind: 'toolCall' | 'toolResult', payload: Record<string, unknown>): AgentEventEnvelope {
  return {
    kind,
    payload,
    agentId: AGENT,
    correlationId: TURN,
    eventId: 'e',
    sequence: 1,
    timestamp: '',
  } as unknown as AgentEventEnvelope;
}

describe('AgentGraphReferencesService', () => {
  let prompts: { upsert: jest.Mock; trim: jest.Mock; findLatest: jest.Mock; findByCorrelationId: jest.Mock };
  let graphs: { findStatus: jest.Mock; upsert: jest.Mock };
  let service: AgentGraphReferencesService;

  beforeEach(() => {
    prompts = { upsert: jest.fn(), trim: jest.fn(), findLatest: jest.fn(), findByCorrelationId: jest.fn() };
    graphs = {
      findStatus: jest.fn().mockResolvedValue({
        implicitContext: {
          instructions: [],
          skills: ['deploy'],
          mcpServers: ['github'],
          commands: [],
          agents: [],
          plugins: [],
        },
        instructionFiles: [{ path: 'AGENTS.md', label: 'AGENTS.md' }],
        referencedMountIds: [],
      }),
      upsert: jest.fn(),
    };
    service = new AgentGraphReferencesService(prompts as never, graphs as never);
  });

  afterEach(() => service.onModuleDestroy());

  async function finish(): Promise<Record<string, string[]>> {
    await service.endTurn(AGENT, TURN);

    const saved = prompts.upsert.mock.calls.at(-1)?.[0] as {
      references: { kind: string; ref: string }[];
      finishedAt: Date | null;
    };
    const byKind: Record<string, string[]> = {};

    saved.references.forEach((entry) => (byKind[entry.kind] ??= []).push(entry.ref));
    expect(saved.finishedAt).toBeInstanceOf(Date);

    return byKind;
  }

  it('records attached, available, used and modified references of a turn', async () => {
    const finished = jest.fn();

    service.registerTurnFinishedListener(finished);
    service.beginTurn({
      agentId: AGENT,
      correlationId: TURN,
      origin: 'chat',
      prompt: 'Fix it <hidden-context>secret</hidden-context>',
      workingDirectory: '/app',
      contextInjection: { includeWorkspace: true },
    });
    await new Promise((resolve) => setImmediate(resolve));

    // Announced without input, completed with arguments on the result.
    service.recordEvent(AGENT, event('toolCall', { toolCallId: 't1', name: 'read', status: 'started', args: {} }));
    service.recordEvent(
      AGENT,
      event('toolResult', { toolCallId: 't1', name: 'read', isError: false, args: { filePath: '/app/src/a.ts' } }),
    );
    service.recordEvent(
      AGENT,
      event('toolCall', { toolCallId: 't2', name: 'edit', status: 'inProgress', args: { filePath: 'src/b.ts' } }),
    );
    service.recordEvent(
      AGENT,
      event('toolResult', { toolCallId: 't2', name: 'edit', isError: false, args: { filePath: 'src/b.ts' } }),
    );
    service.recordEvent(AGENT, event('toolResult', { toolCallId: 't3', name: 'github_list_issues', isError: false }));
    service.recordEvent(
      AGENT,
      event('toolResult', { toolCallId: 't4', name: 'read', isError: true, args: { filePath: 'src/x.ts' } }),
    );
    service.recordEvent(AGENT, {
      ...event('toolCall', { toolCallId: 't5', name: 'read', status: 'succeeded', args: { filePath: 'other.ts' } }),
      correlationId: 'other-turn',
    } as AgentEventEnvelope);

    const byKind = await finish();

    expect(byKind['attached']).toEqual(['mount:workspace']);
    expect(byKind['available']).toEqual(['file:AGENTS.md', 'skill:deploy', 'mcp-server:github']);
    expect(byKind['used']).toEqual([
      'tool:read',
      'file:src/a.ts',
      'tool:edit',
      'tool:github_list_issues',
      'mcp-server:github',
    ]);
    expect(byKind['modified']).toEqual(['file:src/b.ts']);
    expect(prompts.upsert.mock.calls.at(-1)?.[0].excerpt).toBe('Fix it');
    expect(finished).toHaveBeenCalledWith(AGENT);
  });

  it('never stores prompt text of hidden or ephemeral turns', async () => {
    for (const origin of ['hidden', 'ephemeral'] as const) {
      service.beginTurn({
        agentId: AGENT,
        correlationId: `${TURN}-${origin}`,
        origin,
        prompt: 'Automation instructions',
        workingDirectory: '/app',
      });
      await new Promise((resolve) => setImmediate(resolve));
      await service.endTurn(AGENT, `${TURN}-${origin}`);
      expect(prompts.upsert.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ origin, excerpt: null }));
    }
  });

  it('remembers mounts of other environments the turn touched', async () => {
    service.beginTurn({ agentId: AGENT, correlationId: TURN, origin: 'chat', prompt: 'x', workingDirectory: '/app' });
    await new Promise((resolve) => setImmediate(resolve));
    service.recordEvent(
      AGENT,
      event('toolCall', {
        toolCallId: 't1',
        name: 'read',
        status: 'succeeded',
        args: { filePath: '/opt/workspace/m2/a.ts' },
      }),
    );
    await finish();

    expect(graphs.upsert).toHaveBeenCalledWith(AGENT, { referencedMountIds: ['m2'] });
  });
});
