import { ContextApiClient, ContextApiError } from './context-api.client';
import { CONTEXT_TOOL_DEFINITIONS } from './context-tools';
import { callGraphTool, GRAPH_TOOL_DEFINITIONS, isGraphToolName } from './graph-tools';

describe('graph tools', () => {
  let client: { graph: jest.Mock; refreshGraph: jest.Mock };

  beforeEach(() => {
    client = {
      graph: jest.fn().mockResolvedValue({ ok: true }),
      refreshGraph: jest.fn().mockResolvedValue({ queued: true }),
    };
  });

  const call = (name: string, args: unknown) => callGraphTool(client as unknown as ContextApiClient, name, args);

  it('defines uniquely named tools that do not collide with the context tools', () => {
    const names = GRAPH_TOOL_DEFINITIONS.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith('graph_') && isGraphToolName(name))).toBe(true);
    expect(CONTEXT_TOOL_DEFINITIONS.some((tool) => isGraphToolName(tool.name))).toBe(false);
  });

  it('maps arguments to query parameters', async () => {
    await call('graph_search', {
      query: ' auth ',
      environment: '*',
      types: ['file', 'symbol'],
      limit: 5.7,
      extra: 'x',
    });

    expect(client.graph).toHaveBeenCalledWith('search', {
      query: 'auth',
      environment: '*',
      layer: undefined,
      types: 'file,symbol',
      limit: 5,
    });

    await call('graph_neighbors', { id: 'file:a.ts', depth: 2, edgeTypes: ['imports'] });

    expect(client.graph).toHaveBeenLastCalledWith('neighbors', {
      id: 'file:a.ts',
      environment: undefined,
      layer: undefined,
      depth: 2,
      limit: undefined,
      edgeTypes: 'imports',
    });

    await call('graph_file', { path: '/opt/workspace/m1/src/a.ts' });

    expect(client.graph).toHaveBeenLastCalledWith('file', {
      path: '/opt/workspace/m1/src/a.ts',
      environment: undefined,
    });
  });

  it('validates required arguments without calling the API', async () => {
    for (const [name, args] of [
      ['graph_search', {}],
      ['graph_node', {}],
      ['graph_neighbors', { id: '' }],
      ['graph_path', { from: 'a' }],
      ['graph_file', {}],
    ] as const) {
      await expect(call(name, args)).resolves.toMatchObject({ isError: true });
    }

    expect(client.graph).not.toHaveBeenCalled();
  });

  it('refreshes the own graph and reports API errors as tool errors', async () => {
    await expect(call('graph_refresh', {})).resolves.toMatchObject({ content: [{ text: '{"queued":true}' }] });

    client.graph.mockRejectedValue(
      new ContextApiError('Prompt references of environments outside your workspace are not available.', 403),
    );

    await expect(call('graph_references', { environment: 'm2' })).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Prompt references of environments outside your workspace are not available.' }],
    });
  });
});
