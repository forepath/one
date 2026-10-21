import { resolveAgentContextEgressAllows } from './agent-context-egress.utils';

describe('resolveAgentContextEgressAllows', () => {
  const lookup = jest.fn();

  beforeEach(() => lookup.mockReset());

  it('is empty when the context MCP is not configured or disabled', async () => {
    await expect(resolveAgentContextEgressAllows({}, lookup)).resolves.toEqual([]);
    await expect(
      resolveAgentContextEgressAllows(
        { AGENT_CONTEXT_MCP_MANAGER_URL: 'http://m:3000/api', AGENT_CONTEXT_MCP_ENABLED: 'false' },
        lookup,
      ),
    ).resolves.toEqual([]);
    await expect(
      resolveAgentContextEgressAllows({ AGENT_CONTEXT_MCP_MANAGER_URL: 'ftp://m' }, lookup),
    ).resolves.toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('uses IP literals directly with explicit or default ports', async () => {
    await expect(
      resolveAgentContextEgressAllows({ AGENT_CONTEXT_MCP_MANAGER_URL: 'http://172.18.0.5:3000/api' }, lookup),
    ).resolves.toEqual([{ destination: '172.18.0.5', port: 3000 }]);
    await expect(
      resolveAgentContextEgressAllows({ AGENT_CONTEXT_MCP_MANAGER_URL: 'https://[fd00::5]/api' }, lookup),
    ).resolves.toEqual([{ destination: 'fd00::5', port: 443 }]);
  });

  it('resolves host names to every address', async () => {
    lookup.mockResolvedValue([
      { address: '172.18.0.5', family: 4 },
      { address: 'fd00::5', family: 6 },
    ]);

    await expect(
      resolveAgentContextEgressAllows({ AGENT_CONTEXT_MCP_MANAGER_URL: 'http://agent-manager-api/api' }, lookup),
    ).resolves.toEqual([
      { destination: '172.18.0.5', port: 80, hostname: 'agent-manager-api' },
      { destination: 'fd00::5', port: 80, hostname: 'agent-manager-api' },
    ]);
    expect(lookup).toHaveBeenCalledWith('agent-manager-api');
  });

  it('is empty when resolution fails', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(
      resolveAgentContextEgressAllows({ AGENT_CONTEXT_MCP_MANAGER_URL: 'http://missing:3000' }, lookup),
    ).resolves.toEqual([]);
  });
});
