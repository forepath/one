import { ContextApiClient, ContextApiError } from './context-api.client';
import { callContextTool, CONTEXT_TOOL_DEFINITIONS } from './context-tools';

describe('context tools', () => {
  let client: jest.Mocked<
    Pick<ContextApiClient, 'list' | 'mounts' | 'search' | 'get' | 'requestAccess' | 'accessStatus' | 'health'>
  >;

  beforeEach(() => {
    client = {
      health: jest.fn(),
      list: jest.fn(),
      mounts: jest.fn(),
      search: jest.fn(),
      get: jest.fn(),
      requestAccess: jest.fn(),
      accessStatus: jest.fn(),
    };
  });

  const call = (name: string, args: unknown) => callContextTool(client as unknown as ContextApiClient, name, args);

  it('exposes the five context tools, each requiring a ticket', () => {
    expect(CONTEXT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'context_list',
      'context_mounts',
      'context_search',
      'context_get',
      'context_request_access',
    ]);

    for (const tool of CONTEXT_TOOL_DEFINITIONS) {
      expect(tool.inputSchema.required).toContain('ticket');
    }
  });

  it('rejects calls without a ticket', async () => {
    const result = await call('context_list', {});

    expect(result.isError).toBe(true);
    expect(client.list).not.toHaveBeenCalled();
  });

  it('lists granted context as JSON', async () => {
    client.list.mockResolvedValue({
      ticket: 'ctx-1',
      items: [],
      attachments: [],
      environments: [],
      canRequestAccess: true,
    });

    const result = await call('context_list', { ticket: 'ctx-1' });

    expect(JSON.parse(result.content[0].text)).toMatchObject({ ticket: 'ctx-1', canRequestAccess: true });
  });

  it('lists and resolves workspace mounts', async () => {
    client.mounts.mockResolvedValue({ root: '/opt/workspace', readOnly: true, mounts: [] });

    const listed = await call('context_mounts', { ticket: 'ctx-1' });

    await call('context_mounts', { ticket: 'ctx-1', resolve: ' /opt/workspace/abc/src ' });
    await call('context_mounts', { ticket: 'ctx-1', resolve: '   ' });

    expect(JSON.parse(listed.content[0].text)).toMatchObject({ root: '/opt/workspace', readOnly: true });
    expect(client.mounts.mock.calls).toEqual([
      ['ctx-1', undefined],
      ['ctx-1', '/opt/workspace/abc/src'],
      ['ctx-1', undefined],
    ]);
  });

  it('passes search filters through', async () => {
    client.search.mockResolvedValue({ items: [] });

    await call('context_search', { ticket: 'ctx-1', query: ' login ', kinds: ['ticket', 3], limit: 5 });

    expect(client.search).toHaveBeenCalledWith('ctx-1', { query: 'login', kinds: ['ticket'], limit: 5 });
  });

  it('returns item content as markdown text', async () => {
    client.get.mockResolvedValue({ ref: 'item:1', kind: 'ticket', title: 'Fix login', content: 'BODY' });

    const result = await call('context_get', { ticket: 'ctx-1', ref: 'item:1' });

    expect(result.content[0].text).toBe('# Fix login (item:1)\n\nBODY');
    expect(result.isError).toBeUndefined();
  });

  it('names the full ref and revision content changes need', async () => {
    client.get
      .mockResolvedValueOnce({ ref: 'item:1', kind: 'ticket', title: 'Fix login', sha: 'abcd1234', content: 'BODY' })
      .mockResolvedValueOnce({
        ref: 'ticket:abcd1234',
        kind: 'ticket',
        title: 'Fix login',
        sha: 'abcd1234',
        revision: '2026-11-03T10:00:00.000Z',
        content: 'BODY',
      });

    expect((await call('context_get', { ticket: 'ctx-1', ref: 'item:1' })).content[0].text).toBe(
      '# Fix login (item:1)\nref: ticket:abcd1234\n\nBODY',
    );
    expect((await call('context_get', { ticket: 'ctx-1', ref: 'ticket:abcd1234' })).content[0].text).toBe(
      '# Fix login (ticket:abcd1234)\nrevision: 2026-11-03T10:00:00.000Z\n\nBODY',
    );
  });

  it('requires a ref for context_get', async () => {
    expect((await call('context_get', { ticket: 'ctx-1' })).isError).toBe(true);
  });

  it('creates access requests or continues waiting on a request id', async () => {
    client.requestAccess.mockResolvedValue({ requestId: 'ctx_1', decision: 'pending', refs: ['ticket:abcd'] });
    client.accessStatus.mockResolvedValue({ requestId: 'ctx_1', decision: 'granted', refs: ['ticket:abcd'] });

    await call('context_request_access', { ticket: 'ctx-1', refs: ['ticket:abcd'], reason: 'why' });
    await call('context_request_access', { ticket: 'ctx-1', requestId: 'ctx_1' });

    expect(client.requestAccess).toHaveBeenCalledWith('ctx-1', ['ticket:abcd'], 'why');
    expect(client.accessStatus).toHaveBeenCalledWith('ctx-1', 'ctx_1');
    expect((await call('context_request_access', { ticket: 'ctx-1' })).isError).toBe(true);
  });

  it('converts API errors into tool errors', async () => {
    client.get.mockRejectedValue(new ContextApiError('Access is not granted', 403));

    const result = await call('context_get', { ticket: 'ctx-1', ref: 'ticket:abcd' });

    expect(result).toEqual({ content: [{ type: 'text', text: 'Access is not granted' }], isError: true });
  });

  it('reports unknown tools', async () => {
    expect((await call('context_delete', { ticket: 'ctx-1' })).isError).toBe(true);
  });
});
