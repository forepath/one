import { NotFoundException } from '@nestjs/common';
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

describe('OpencodeConfigSyncTargetsService stale targets', () => {
  const agentId = '5bd368c5-164f-48e4-99c7-f7faf8a1b3e2';
  const target = () => ({
    id: 't1',
    clientId: 'c1',
    agentId,
    syncStatus: 'synced',
    desiredRevision: 'old',
    appliedRevision: 'old',
    lastError: null,
  });

  function build(options: { payloadError?: unknown; syncResult?: unknown; syncError?: unknown }) {
    const targetsRepo = {
      find: jest.fn().mockResolvedValue([target()]),
      findOne: jest.fn().mockResolvedValue({ ...target(), syncStatus: 'pending', desiredRevision: 'new' }),
      save: jest.fn(async (value: unknown) => value),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const effectiveConfigSync = {
      buildEffectivePayload: options.payloadError
        ? jest.fn().mockRejectedValue(options.payloadError)
        : jest.fn().mockResolvedValue({ effective: {}, secrets: {}, platformPolicy: undefined }),
      syncAgent: options.syncError
        ? jest.fn().mockRejectedValue(options.syncError)
        : jest.fn().mockResolvedValue(options.syncResult ?? { ok: true }),
    };
    const service = new OpencodeConfigSyncTargetsService(
      targetsRepo as never,
      effectiveConfigSync as never,
      {} as never,
    );

    return { service, targetsRepo };
  }

  it('matches only the manager wording for this exact agent', () => {
    expect(OpencodeConfigSyncTargetsService.isAgentGoneMessage(`Agent with ID '${agentId}' not found`, agentId)).toBe(
      true,
    );
    expect(OpencodeConfigSyncTargetsService.isAgentGoneMessage(`Agent with ID ${agentId} not found`, agentId)).toBe(
      true,
    );
    expect(
      OpencodeConfigSyncTargetsService.isAgentGoneMessage(
        "Agent with ID '00000000-0000-4000-8000-000000000000' not found",
        agentId,
      ),
    ).toBe(false);
    expect(
      OpencodeConfigSyncTargetsService.isAgentGoneMessage('Cannot GET /api/agents/x/opencode/config', agentId),
    ).toBe(false);
    expect(
      OpencodeConfigSyncTargetsService.isAgentGoneError(new Error(`Agent with ID '${agentId}' not found`), agentId),
    ).toBe(false);
  });

  it('prunes a reconciled target whose agent no longer exists on the manager', async () => {
    const { service, targetsRepo } = build({
      payloadError: new NotFoundException(`Agent with ID '${agentId}' not found`),
    });

    await expect(service.reconcileOutdatedSyncedTargets(5)).resolves.toEqual([]);
    expect(targetsRepo.delete).toHaveBeenCalledWith({ id: 't1' });
  });

  it('keeps targets on other errors (manager down, older manager without the route)', async () => {
    for (const payloadError of [new Error('connect ECONNREFUSED'), new NotFoundException('Cannot GET /api/x')]) {
      const { service, targetsRepo } = build({ payloadError });

      await service.reconcileOutdatedSyncedTargets(5);
      expect(targetsRepo.delete).not.toHaveBeenCalled();
    }
  });

  it('prunes on sync when the manager reports the agent missing (thrown or as a result)', async () => {
    const thrown = build({ syncError: new NotFoundException(`Agent with ID '${agentId}' not found`) });
    const returned = build({ syncResult: { ok: false, error: `Agent with ID '${agentId}' not found` } });

    await thrown.service.processTargetById('t1');
    await returned.service.processTargetById('t1');

    expect(thrown.targetsRepo.delete).toHaveBeenCalledWith({ id: 't1' });
    expect(returned.targetsRepo.delete).toHaveBeenCalledWith({ id: 't1' });
    expect(returned.targetsRepo.save).not.toHaveBeenCalled();
  });

  it('removes the target of a deleted agent', async () => {
    const { service, targetsRepo } = build({});

    await service.removeAgentTarget('c1', agentId);
    expect(targetsRepo.delete).toHaveBeenCalledWith({ clientId: 'c1', agentId });
  });
});
