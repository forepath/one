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
