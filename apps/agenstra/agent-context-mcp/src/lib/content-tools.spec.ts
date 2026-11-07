import { AGENSTRA_CONTEXT_MCP_TOOL_PERMISSION } from '@forepath/agenstra/shared/util-opencode-config';

import { callContentTool, CONTENT_TOOL_DEFINITIONS, isContentToolName } from './content-tools';
import { ContextApiClient, ContextApiError } from './context-api.client';
import { CONTEXT_TOOL_DEFINITIONS } from './context-tools';
import { TASK_TOOL_DEFINITIONS } from './task-tools';

describe('content tools', () => {
  let client: jest.Mocked<Pick<ContextApiClient, 'requestChange' | 'changeStatus'>>;

  beforeEach(() => {
    client = {
      requestChange: jest.fn().mockResolvedValue({ requestId: '', decision: 'applied', operation: 'ticket.comment' }),
      changeStatus: jest
        .fn()
        .mockResolvedValue({ requestId: 'ctx_chg_1', decision: 'pending', operation: 'page.update' }),
    };
  });

  const call = (name: string, args: unknown) => callContentTool(client as unknown as ContextApiClient, name, args);

  it('defines content tools outside the read-only context prefix with unique names', () => {
    const names = CONTENT_TOOL_DEFINITIONS.map((tool) => tool.name);
    const readOnlyPrefix = AGENSTRA_CONTEXT_MCP_TOOL_PERMISSION.replace('agenstra_', '').replace('*', '');

    expect(names.every((name) => name.startsWith('content_') && !name.startsWith(readOnlyPrefix))).toBe(true);
    expect(
      new Set([...names, ...CONTEXT_TOOL_DEFINITIONS.map((t) => t.name), ...TASK_TOOL_DEFINITIONS.map((t) => t.name)])
        .size,
    ).toBe(names.length + CONTEXT_TOOL_DEFINITIONS.length + TASK_TOOL_DEFINITIONS.length);
    expect(CONTENT_TOOL_DEFINITIONS.every((tool) => tool.inputSchema.required?.includes('ticket'))).toBe(true);
    expect(isContentToolName('content_ticket_update')).toBe(true);
    expect(isContentToolName('context_get')).toBe(false);
  });

  it('sends the change with the operation of the tool and known string fields only', async () => {
    await call('content_ticket_update', {
      ticket: ' ctx-1 ',
      ref: 'ticket:abcd1234',
      revision: '2026-11-03T10:00:00.000Z',
      status: 'done',
      priority: 7,
      operation: 'ticket.delete',
      unexpected: 'x',
    });

    expect(client.requestChange).toHaveBeenCalledWith('ctx-1', {
      operation: 'ticket.update',
      ref: 'ticket:abcd1234',
      revision: '2026-11-03T10:00:00.000Z',
      status: 'done',
    });
  });

  it('continues waiting on pending changes', async () => {
    const result = await call('content_change_status', { ticket: 'ctx-1', requestId: 'ctx_chg_1' });

    expect(client.changeStatus).toHaveBeenCalledWith('ctx-1', 'ctx_chg_1');
    expect(JSON.parse(result.content[0].text)).toMatchObject({ decision: 'pending' });
  });

  it('reports missing arguments and API errors as tool errors', async () => {
    await expect(call('content_ticket_comment', { ref: 'ticket:abcd', body: 'x' })).resolves.toMatchObject({
      isError: true,
    });
    await expect(call('content_change_status', { ticket: 'ctx-1' })).resolves.toMatchObject({ isError: true });

    client.requestChange.mockRejectedValue(new ContextApiError('Unknown or expired context ticket', 404));

    await expect(
      call('content_page_delete', { ticket: 'ctx-1', ref: 'knowledge:abcd', revision: 'r' }),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'Unknown or expired context ticket' }],
      isError: true,
    });
    expect(client.changeStatus).not.toHaveBeenCalled();
  });

  it('forwards initiative proposals and findings with their structured fields', async () => {
    await call('content_initiative_propose', {
      ticket: 'ctx-1',
      ref: 'initiative:abcd1234',
      title: 'Add SSO story',
      rationale: 'Retro',
      workItems: [{ op: 'add', parentKey: 'E1', item: { key: 'N1', title: 'SSO' } }],
      decisions: 'not a list',
      operation: 'ticket.delete',
    });

    expect(client.requestChange).toHaveBeenCalledWith('ctx-1', {
      operation: 'initiative.propose',
      ref: 'initiative:abcd1234',
      title: 'Add SSO story',
      rationale: 'Retro',
      workItems: [{ op: 'add', parentKey: 'E1', item: { key: 'N1', title: 'SSO' } }],
    });

    await call('content_initiative_finding', {
      ticket: 'ctx-1',
      ref: 'initiative:abcd1234',
      body: 'Deferred: rate limiting',
      severity: 'major',
      itemKey: 'E1.S2',
      evidence: ['ticket:ffff'],
    });

    expect(client.requestChange).toHaveBeenLastCalledWith('ctx-1', {
      operation: 'initiative.finding',
      ref: 'initiative:abcd1234',
      body: 'Deferred: rate limiting',
      severity: 'major',
      itemKey: 'E1.S2',
      evidence: ['ticket:ffff'],
    });
  });
});
