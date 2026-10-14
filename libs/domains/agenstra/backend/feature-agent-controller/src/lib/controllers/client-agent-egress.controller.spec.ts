import { BadRequestException } from '@nestjs/common';

import { ClientAgentEgressController, parseEgressDestination } from './client-agent-egress.controller';

jest.mock('@forepath/identity/backend', () => ({
  ...jest.requireActual('@forepath/identity/backend'),
  ensureWorkspaceManagementAccess: jest.fn().mockResolvedValue(undefined),
}));

describe('parseEgressDestination', () => {
  it('parses URLs, hosts with ports and IPv6 literals', () => {
    expect(parseEgressDestination('https://Api.GitHub.com/repos?x=1')).toEqual({
      host: 'api.github.com',
      scheme: 'https',
      url: 'https://api.github.com/repos',
    });
    expect(parseEgressDestination('example.org:8080/path')).toEqual({ host: 'example.org', scheme: null });
    expect(parseEgressDestination('[2001:db8::1]:443')).toEqual({ host: '2001:db8::1', scheme: null });
    expect(parseEgressDestination('2001:db8::1')).toEqual({ host: '2001:db8::1', scheme: null });
  });

  it('rejects unsupported schemes and empty hosts', () => {
    expect(() => parseEgressDestination('ftp://example.org')).toThrow(BadRequestException);
    expect(() => parseEgressDestination('/path')).toThrow(BadRequestException);
  });
});

describe('ClientAgentEgressController', () => {
  const clientId = '11111111-1111-4111-8111-111111111111';
  const agentId = '22222222-2222-4222-8222-222222222222';
  const clientAgentProxy = { getClientAgentEgress: jest.fn().mockResolvedValue({ agentId }) };
  const agentConfigProxy = { get: jest.fn().mockResolvedValue({ config: {}, overrides: {} }) };
  const opencodeConfigService = {
    getLayerConfigs: jest.fn().mockResolvedValue({
      global: { egress: { mode: 'enforce', deny_hosts: ['example.org'] } },
      workspace: {},
    }),
    composeStoredLayer: jest.fn().mockReturnValue({ egress: { allow_hosts: ['github.com'] } }),
    resolvePlatformPolicy: jest.requireActual('../services/opencode-config.service').OpencodeConfigService.prototype
      .resolvePlatformPolicy,
  };
  const controller = new ClientAgentEgressController(
    clientAgentProxy as never,
    agentConfigProxy as never,
    opencodeConfigService as never,
    {} as never,
    {} as never,
  );

  it('proxies the egress details of an environment', async () => {
    await expect(controller.getEgress(clientId, agentId)).resolves.toEqual({ agentId });
    expect(clientAgentProxy.getClientAgentEgress).toHaveBeenCalledWith(clientId, agentId);
  });

  it('evaluates destinations against the layered policy (deny wins, allowlist applies)', async () => {
    await expect(controller.evaluate(clientId, agentId, { destination: 'https://www.example.org' })).resolves.toEqual({
      host: 'www.example.org',
      decision: 'blocked',
      rule: 'deny_host',
      matchedEntry: 'example.org',
      source: 'global',
      mode: 'enforce',
      scheme: 'https',
    });
    await expect(controller.evaluate(clientId, agentId, { destination: 'gitlab.com' })).resolves.toEqual(
      expect.objectContaining({ decision: 'blocked', rule: 'not_allowlisted' }),
    );
    await expect(controller.evaluate(clientId, agentId, { destination: 'api.github.com' })).resolves.toEqual(
      expect.objectContaining({ decision: 'allowed', rule: null }),
    );
  });
});
