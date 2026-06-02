import { isAcpTransport, resolveAgentProviderTransport } from './agent-provider-transport.util';

describe('agent-provider-transport.util', () => {
  beforeEach(() => {
    delete process.env.AGENT_PROVIDER_TRANSPORT;
    delete process.env.CURSOR_AGENT_TRANSPORT;
    delete process.env.OPENCODE_AGENT_TRANSPORT;
    delete process.env.OPENCLAW_AGENT_TRANSPORT;
  });

  it('defaults to legacy transport', () => {
    expect(resolveAgentProviderTransport('cursor')).toBe('legacy');
    expect(isAcpTransport('cursor')).toBe(false);
  });

  it('uses global AGENT_PROVIDER_TRANSPORT=acp', () => {
    process.env.AGENT_PROVIDER_TRANSPORT = 'acp';
    delete process.env.OPENCODE_AGENT_TRANSPORT;

    expect(resolveAgentProviderTransport('opencode')).toBe('acp');
  });

  it('uses per-type override CURSOR_AGENT_TRANSPORT', () => {
    process.env.AGENT_PROVIDER_TRANSPORT = 'legacy';
    process.env.CURSOR_AGENT_TRANSPORT = 'acp';

    expect(resolveAgentProviderTransport('cursor')).toBe('acp');
    expect(resolveAgentProviderTransport('opencode')).toBe('legacy');
  });
});
