import { AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION } from '@forepath/agenstra/shared/util-opencode-config';

import { OpencodeConfigSyncTargetsService } from './opencode-config-sync-targets.service';

describe('OpencodeConfigSyncTargetsService.hashRevision', () => {
  it('changes when platform wire version is reflected in the payload', () => {
    const config = { model: 'azure/gpt-5.5', agents: {} };
    const secrets = { AZURE_API_KEY: 'x' };
    const hash = OpencodeConfigSyncTargetsService.hashRevision(config, secrets);

    expect(hash).toHaveLength(64);
    expect(hash).not.toEqual(
      // Overlay-only hash (pre-fix) must differ once platform inject + version are included.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('crypto')
        .createHash('sha256')
        .update(JSON.stringify({ config, secrets: { AZURE_API_KEY: 'x' } }))
        .digest('hex'),
    );
    expect(AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION).toBeGreaterThan(0);
  });

  it('is stable for the same effective config and secrets', () => {
    const config = { model: 'azure/gpt-5.5', agents: { test: { mode: 'primary' } } };
    const a = OpencodeConfigSyncTargetsService.hashRevision(config, { B: '2', A: '1' });
    const b = OpencodeConfigSyncTargetsService.hashRevision(config, { A: '1', B: '2' });

    expect(a).toBe(b);
  });
});

describe('OpencodeConfigSyncTargetsService platform policy', () => {
  const policy = (mode: string, deny: string[] = []) =>
    ({
      egress: {
        mode,
        allowHosts: [],
        denyHosts: deny.map((value) => ({ value, source: 'global' })),
        denyUrlPatterns: [],
        networkAllow: [],
        blockPrivateNetworks: true,
        blockIpLiterals: false,
        logAllowed: true,
        scalarSources: { mode: 'global', blockPrivateNetworks: null, blockIpLiterals: null, logAllowed: null },
      },
      messageFilters: [],
    }) as never;

  it('includes the platform policy in the revision hash', () => {
    const config = { model: 'x/y' };

    expect(OpencodeConfigSyncTargetsService.hashRevision(config, {}, policy('off'))).not.toBe(
      OpencodeConfigSyncTargetsService.hashRevision(config, {}, policy('enforce')),
    );
    expect(OpencodeConfigSyncTargetsService.hashEgressRevision(policy('enforce', ['a.example']))).toBe(
      OpencodeConfigSyncTargetsService.hashEgressRevision(policy('enforce', ['a.example'])),
    );
    expect(OpencodeConfigSyncTargetsService.hashEgressRevision(undefined)).toBeNull();
  });

  function buildService(syncResult: Record<string, unknown>, target: Record<string, unknown>) {
    const saved: Array<Record<string, unknown>> = [];
    const targetsRepo = {
      findOne: jest.fn().mockResolvedValue(target),
      save: jest.fn(async (value: Record<string, unknown>) => {
        saved.push({ ...value });

        return value;
      }),
    };
    const effectiveConfigSync = { syncAgent: jest.fn().mockResolvedValue(syncResult) };
    const publisher = { publishEgressPolicy: jest.fn() };
    const service = new OpencodeConfigSyncTargetsService(
      targetsRepo as never,
      effectiveConfigSync as never,
      {} as never,
      publisher as never,
    );

    return { service, publisher, saved };
  }

  it('publishes egress.policy_applied once per new egress revision', async () => {
    const target = { id: 't1', clientId: 'c1', agentId: 'a1', syncStatus: 'pending', desiredRevision: 'r1' };
    const { service, publisher, saved } = buildService({ ok: true, platformPolicy: policy('enforce') }, target);

    await service.processTargetById('t1');

    expect(publisher.publishEgressPolicy).toHaveBeenCalledWith(
      'egress.policy_applied',
      'c1',
      expect.objectContaining({ agentId: 'a1', mode: 'enforce' }),
    );
    expect(saved[0]['appliedEgressRevision']).toEqual(expect.any(String));

    publisher.publishEgressPolicy.mockClear();
    Object.assign(target, { syncStatus: 'pending', appliedEgressRevision: saved[0]['appliedEgressRevision'] });
    await service.processTargetById('t1');
    expect(publisher.publishEgressPolicy).not.toHaveBeenCalled();
  });

  it('does not notify the initial default (off) policy', async () => {
    const { service, publisher } = buildService(
      { ok: true, platformPolicy: policy('off') },
      { id: 't1', clientId: 'c1', agentId: 'a1', syncStatus: 'pending', desiredRevision: 'r1' },
    );

    await service.processTargetById('t1');

    expect(publisher.publishEgressPolicy).not.toHaveBeenCalled();
  });

  it('publishes egress.policy_failed for new egress errors only', async () => {
    const target = { id: 't1', clientId: 'c1', agentId: 'a1', syncStatus: 'pending', desiredRevision: 'r1' };
    const error = 'Egress policy not applied: squid configuration rejected';
    const { service, publisher } = buildService({ ok: false, error, platformPolicy: policy('enforce') }, target);

    await service.processTargetById('t1');
    expect(publisher.publishEgressPolicy).toHaveBeenCalledWith(
      'egress.policy_failed',
      'c1',
      expect.objectContaining({ error }),
    );

    publisher.publishEgressPolicy.mockClear();
    Object.assign(target, { syncStatus: 'failed', lastError: error });
    await service.processTargetById('t1');
    expect(publisher.publishEgressPolicy).not.toHaveBeenCalled();
  });
});
