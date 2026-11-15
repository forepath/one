import { callClientTool, CLIENT_TOOL_DEFINITIONS, isClientToolName } from './client-tools';
import { ContextApiError, type ContextApiClient } from './context-api.client';

describe('client tool bridge (MCP)', () => {
  const ticket = 'ctx-abcdefghijklmnopqrstuv';
  let client: { callClientTool: jest.Mock; waitClientTool: jest.Mock };

  beforeEach(() => {
    client = { callClientTool: jest.fn(), waitClientTool: jest.fn() };
  });

  const call = (name: string, args: unknown) => callClientTool(client as unknown as ContextApiClient, name, args);

  it('defines the call and result tools', () => {
    expect(CLIENT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(['client_tools_call', 'client_tools_result']);
    expect(isClientToolName('client_tools_call')).toBe(true);
    expect(isClientToolName('tasks_list')).toBe(false);
  });

  it('returns the client output of a completed call', async () => {
    client.callClientTool.mockResolvedValue({ callId: 'call_1', status: 'completed', output: '{"temp":21}' });

    await expect(
      call('client_tools_call', { ticket, name: 'get_weather', arguments: { city: 'Berlin' } }),
    ).resolves.toEqual({
      content: [{ type: 'text', text: '{"temp":21}' }],
    });
    expect(client.callClientTool).toHaveBeenCalledWith(ticket, 'get_weather', { city: 'Berlin' });
  });

  it('tells the agent to keep waiting on pending calls', async () => {
    client.callClientTool.mockResolvedValue({ callId: 'call_1', status: 'pending' });

    const result = await call('client_tools_call', { ticket, name: 'get_weather', arguments: {} });

    expect(JSON.parse(result.content[0].text)).toEqual(
      expect.objectContaining({ status: 'pending', callId: 'call_1' }),
    );

    client.waitClientTool.mockResolvedValue({ callId: 'call_1', status: 'completed', output: 'done' });
    await expect(call('client_tools_result', { ticket, callId: 'call_1' })).resolves.toEqual({
      content: [{ type: 'text', text: 'done' }],
    });
    expect(client.waitClientTool).toHaveBeenCalledWith(ticket, 'call_1');
  });

  it('reports failures and invalid input as tool errors', async () => {
    client.callClientTool.mockResolvedValueOnce({ callId: 'call_1', status: 'failed', error: 'client gone' });
    await expect(call('client_tools_call', { ticket, name: 'f', arguments: {} })).resolves.toEqual(
      expect.objectContaining({ isError: true, content: [{ type: 'text', text: 'Client tool failed: client gone' }] }),
    );

    client.callClientTool.mockRejectedValueOnce(new ContextApiError('Unknown or expired context ticket', 404));
    await expect(call('client_tools_call', { ticket, name: 'f', arguments: {} })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );

    for (const args of [{}, { ticket }, { ticket, name: 'f', arguments: [1] }, { ticket, name: '' }]) {
      await expect(call('client_tools_call', args)).resolves.toEqual(expect.objectContaining({ isError: true }));
    }

    await expect(call('client_tools_result', { ticket })).resolves.toEqual(expect.objectContaining({ isError: true }));
    expect(client.callClientTool).toHaveBeenCalledTimes(2);
    expect(client.waitClientTool).not.toHaveBeenCalled();
  });
});
