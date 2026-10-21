import { ContextApiClient, ContextApiError, readContextApiConfig } from './context-api.client';

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('readContextApiConfig', () => {
  it('reads and normalizes the MCP environment', () => {
    expect(
      readContextApiConfig({
        AGENSTRA_CONTEXT_API_URL: 'http://manager:3000/api/',
        AGENSTRA_CONTEXT_AGENT_ID: 'agent-1',
        AGENSTRA_CONTEXT_AGENT_TOKEN: 'tok',
      }),
    ).toEqual({ apiUrl: 'http://manager:3000/api', agentId: 'agent-1', agentToken: 'tok' });
  });

  it('lists every missing variable', () => {
    expect(() => readContextApiConfig({ AGENSTRA_CONTEXT_AGENT_ID: 'a' })).toThrow(
      'Missing environment: AGENSTRA_CONTEXT_API_URL, AGENSTRA_CONTEXT_AGENT_TOKEN',
    );
  });
});

describe('ContextApiClient', () => {
  const config = { apiUrl: 'http://manager:3000/api', agentId: 'agent-1', agentToken: 'tok' };
  let fetchFn: jest.Mock;
  let client: ContextApiClient;

  beforeEach(() => {
    fetchFn = jest.fn();
    client = new ContextApiClient(config, fetchFn as unknown as typeof fetch);
  });

  it('sends agent credentials and resolves JSON bodies', async () => {
    fetchFn.mockResolvedValue(jsonResponse(200, { ticket: 'ctx-1', items: [] }));

    await expect(client.list('ctx-1')).resolves.toEqual({ ticket: 'ctx-1', items: [] });
    expect(fetchFn).toHaveBeenCalledWith(
      'http://manager:3000/api/agent-context/tickets/ctx-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok', 'x-agenstra-agent-id': 'agent-1' }),
      }),
    );
  });

  it('encodes refs and search parameters', async () => {
    fetchFn.mockResolvedValue(jsonResponse(200, { items: [] }));

    await client.get('ctx-1', 'ticket:abcd');
    await client.search('ctx-1', { query: 'login fix', kinds: ['ticket', 'knowledge'], limit: 5 });

    expect(fetchFn.mock.calls[0][0]).toBe('http://manager:3000/api/agent-context/tickets/ctx-1/items/ticket%3Aabcd');
    expect(fetchFn.mock.calls[1][0]).toBe(
      'http://manager:3000/api/agent-context/tickets/ctx-1/search?query=login+fix&kinds=ticket%2Cknowledge&limit=5',
    );
  });

  it('posts access requests with a JSON body', async () => {
    fetchFn.mockResolvedValue(jsonResponse(200, { requestId: 'ctx_1', decision: 'granted', refs: [] }));

    await client.requestAccess('ctx-1', ['ticket:abcd'], 'needed');

    expect(fetchFn).toHaveBeenCalledWith(
      'http://manager:3000/api/agent-context/tickets/ctx-1/access-requests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refs: ['ticket:abcd'], reason: 'needed' }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('maps task operations to the tasks routes of the context API', async () => {
    fetchFn.mockResolvedValue(jsonResponse(200, {}));

    await client.listTasks();
    await client.getTask('task/1');
    await client.createTask({ title: 't', prompt: 'p', cronExpression: '0 9 * * *' });
    await client.updateTask('task-1', { enabled: false });
    await client.runTask('task-1');

    expect(fetchFn.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      ['GET', 'http://manager:3000/api/agent-context/tasks'],
      ['GET', 'http://manager:3000/api/agent-context/tasks/task%2F1'],
      ['POST', 'http://manager:3000/api/agent-context/tasks'],
      ['PATCH', 'http://manager:3000/api/agent-context/tasks/task-1'],
      ['POST', 'http://manager:3000/api/agent-context/tasks/task-1/runs'],
    ]);
    expect(fetchFn.mock.calls[3][1].body).toBe(JSON.stringify({ enabled: false }));

    fetchFn.mockResolvedValue(jsonResponse(204));

    await expect(client.deleteTask('task-1')).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenLastCalledWith(
      'http://manager:3000/api/agent-context/tasks/task-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('treats 204 as an empty success', async () => {
    fetchFn.mockResolvedValue(jsonResponse(204));

    await expect(client.health()).resolves.toBeUndefined();
  });

  it('surfaces API error messages with the status code', async () => {
    fetchFn.mockResolvedValue(jsonResponse(403, { message: 'Access to ticket:abcd is not granted.' }));

    await expect(client.get('ctx-1', 'ticket:abcd')).rejects.toMatchObject({
      message: 'Access to ticket:abcd is not granted.',
      status: 403,
    });
  });

  it('wraps network failures', async () => {
    fetchFn.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(client.health()).rejects.toBeInstanceOf(ContextApiError);
    await expect(client.health()).rejects.toThrow('Agenstra context API unreachable: ECONNREFUSED');
  });
});
