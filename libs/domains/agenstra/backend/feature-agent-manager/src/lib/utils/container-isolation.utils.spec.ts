import type { HostIsolationCapabilitiesDto } from '../dto/container-isolation.dto';

import {
  availableIsolationLevels,
  buildIsolationSelection,
  containerRuntimeForIsolationLevel,
  computeIsolationCapabilityRevision,
  effectiveIsolationLevel,
  isEnhancedIsolationLevel,
  isGvisorIsolationLevel,
  isIsolationLevel,
  isMicrovmIsolationLevel,
  isolationRuntimeArgs,
  isolationRuntimeOptions,
  IsolationResolutionError,
  mapGvisorRuntimeForNetwork,
  resolveIsolationRequest,
  runtimeForIsolationLevel,
  strongestAvailableIsolationLevel,
} from './container-isolation.utils';

type Levels = HostIsolationCapabilitiesDto['levels'];

function levels(standard: string, sandboxed: string, sandboxedKvm = 'unsupported', microvm = 'unsupported'): Levels {
  return {
    standard: { rank: 1, runtime: 'runc', state: standard as Levels['standard']['state'] },
    sandboxed: { rank: 2, runtime: 'runsc-systrap', state: sandboxed as Levels['sandboxed']['state'] },
    'sandboxed-kvm': { rank: 3, runtime: 'runsc-kvm', state: sandboxedKvm as Levels['sandboxed-kvm']['state'] },
    microvm: { rank: 4, runtime: 'runc', state: microvm as Levels['microvm']['state'] },
  };
}

function capabilities(
  standard: string,
  sandboxed: string,
  revision = 'sha256:rev',
  sandboxedKvm = 'unsupported',
  microvm = 'unsupported',
) {
  return { revision, levels: levels(standard, sandboxed, sandboxedKvm, microvm) };
}

function resolutionError(fn: () => unknown): IsolationResolutionError {
  try {
    fn();
  } catch (error) {
    return error as IsolationResolutionError;
  }

  throw new Error('expected an IsolationResolutionError');
}

describe('container isolation utils', () => {
  it('recognizes isolation levels', () => {
    expect(isIsolationLevel('standard')).toBe(true);
    expect(isIsolationLevel('sandboxed')).toBe(true);
    expect(isIsolationLevel('sandboxed-kvm')).toBe(true);
    expect(isIsolationLevel('vm')).toBe(false);
    expect(isGvisorIsolationLevel('standard')).toBe(false);
    expect(isGvisorIsolationLevel('sandboxed')).toBe(true);
    expect(isGvisorIsolationLevel('sandboxed-kvm')).toBe(true);
    expect(isIsolationLevel(undefined)).toBe(false);
  });

  it('maps levels to runtimes (configurable sandbox runtime, sanitized)', () => {
    expect(runtimeForIsolationLevel('standard', {})).toBe('runc');
    expect(runtimeForIsolationLevel('sandboxed', {})).toBe('runsc-systrap');
    expect(runtimeForIsolationLevel('sandboxed', { AGENT_SANDBOX_RUNTIME: 'runsc-custom' })).toBe('runsc-custom');
    expect(runtimeForIsolationLevel('sandboxed', { AGENT_SANDBOX_RUNTIME: 'runsc --privileged' })).toBe(
      'runsc-systrap',
    );
  });

  it('maps the sandboxed-kvm level to its own runtime (configurable, sanitized)', () => {
    expect(runtimeForIsolationLevel('sandboxed-kvm', {})).toBe('runsc-kvm');
    expect(runtimeForIsolationLevel('sandboxed-kvm', { AGENT_SANDBOX_KVM_RUNTIME: 'runsc-kvm-custom' })).toBe(
      'runsc-kvm-custom',
    );
    expect(runtimeForIsolationLevel('sandboxed-kvm', { AGENT_SANDBOX_KVM_RUNTIME: 'runsc;reboot' })).toBe('runsc-kvm');
    // The sandboxed runtime override never leaks into the KVM level and vice versa.
    expect(runtimeForIsolationLevel('sandboxed-kvm', { AGENT_SANDBOX_RUNTIME: 'runsc-custom' })).toBe('runsc-kvm');
    expect(runtimeForIsolationLevel('sandboxed', { AGENT_SANDBOX_KVM_RUNTIME: 'runsc-kvm-custom' })).toBe(
      'runsc-systrap',
    );
  });

  describe('mapGvisorRuntimeForNetwork (runtime per level x network topology)', () => {
    const cases: [string, boolean, string][] = [
      // sandboxed: Netstack on the default bridge, kernel stack in a guard namespace / on the agent network
      ['runsc-systrap', false, 'runsc-systrap'],
      ['runsc-systrap', true, 'runsc-systrap-hostnet'],
      ['runsc-systrap-hostnet', false, 'runsc-systrap'],
      ['runsc-systrap-hostnet', true, 'runsc-systrap-hostnet'],
      // sandboxed-kvm: same rules with its own pair (never crosses to the systrap pair)
      ['runsc-kvm', false, 'runsc-kvm'],
      ['runsc-kvm', true, 'runsc-kvm-hostnet'],
      ['runsc-kvm-hostnet', false, 'runsc-kvm'],
      ['runsc-kvm-hostnet', true, 'runsc-kvm-hostnet'],
      // other runtimes are untouched
      ['runc', true, 'runc'],
      ['runc', false, 'runc'],
      ['nvidia', true, 'nvidia'],
    ];

    it.each(cases)('%s (shares namespace: %s) -> %s', (runtime, sharesNamespace, expected) => {
      expect(mapGvisorRuntimeForNetwork(runtime, sharesNamespace, {})).toBe(expected);
    });

    it('uses configured runtime names', () => {
      const env = {
        AGENT_SANDBOX_KVM_RUNTIME: 'kvm-a',
        AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME: 'kvm-b',
      };

      expect(mapGvisorRuntimeForNetwork('kvm-a', true, env)).toBe('kvm-b');
      expect(mapGvisorRuntimeForNetwork('kvm-b', false, env)).toBe('kvm-a');
      // The defaults are no gVisor runtimes of this manager anymore.
      expect(mapGvisorRuntimeForNetwork('runsc-kvm', true, env)).toBe('runsc-kvm');
    });
  });

  it('treats environments without a stored level as standard', () => {
    expect(effectiveIsolationLevel(undefined)).toBe('standard');
    expect(effectiveIsolationLevel(null)).toBe('standard');
    expect(effectiveIsolationLevel('sandboxed')).toBe('sandboxed');
    expect(effectiveIsolationLevel('sandboxed-kvm')).toBe('sandboxed-kvm');
    expect(effectiveIsolationLevel('kata')).toBe('standard');
  });

  it('pins the persisted runtime for recreate paths', () => {
    expect(isolationRuntimeOptions({ isolationLevel: 'sandboxed' }, {})).toEqual({ runtime: 'runsc-systrap' });
    expect(isolationRuntimeOptions({}, {})).toEqual({});
    expect(isolationRuntimeOptions({ isolationLevel: 'standard' }, {})).toEqual({});
    expect(isolationRuntimeOptions(null, {})).toEqual({});
    expect(isolationRuntimeArgs({ isolationLevel: 'sandboxed' }, {})).toEqual(['runsc-systrap']);
    expect(isolationRuntimeArgs({ isolationLevel: 'standard' }, {})).toEqual([]);
    expect(isolationRuntimeOptions({ isolationLevel: 'sandboxed-kvm' }, {})).toEqual({ runtime: 'runsc-kvm' });
    expect(isolationRuntimeArgs({ isolationLevel: 'sandboxed-kvm' }, {})).toEqual(['runsc-kvm']);
  });

  it("requests a runtime only for the sandboxed level (standard keeps Docker's default runtime)", () => {
    expect(containerRuntimeForIsolationLevel('sandboxed', {})).toBe('runsc-systrap');
    expect(containerRuntimeForIsolationLevel('sandboxed-kvm', {})).toBe('runsc-kvm');
    expect(containerRuntimeForIsolationLevel('standard', {})).toBeUndefined();
  });

  it('lists ready levels strongest first and requires the standard floor for a recommendation', () => {
    expect(availableIsolationLevels(levels('ready', 'ready'))).toEqual(['sandboxed', 'standard']);
    expect(strongestAvailableIsolationLevel(levels('ready', 'ready'))).toBe('sandboxed');
    expect(strongestAvailableIsolationLevel(levels('ready', 'unsupported'))).toBe('standard');
    expect(strongestAvailableIsolationLevel(levels('probe-failed', 'ready'))).toBeNull();
    expect(availableIsolationLevels(levels('ready', 'ready', 'ready'))).toEqual([
      'sandboxed-kvm',
      'sandboxed',
      'standard',
    ]);
    expect(strongestAvailableIsolationLevel(levels('ready', 'ready', 'ready'))).toBe('sandboxed-kvm');
    // The KVM level is independent of the systrap level.
    expect(strongestAvailableIsolationLevel(levels('ready', 'probe-failed', 'ready'))).toBe('sandboxed-kvm');
    expect(availableIsolationLevels(levels('ready', 'probe-failed', 'ready'))).toEqual(['sandboxed-kvm', 'standard']);
    expect(strongestAvailableIsolationLevel(levels('probe-failed', 'ready', 'ready'))).toBeNull();
  });

  describe('resolveIsolationRequest', () => {
    it('resolves an omitted level to the recommendation', () => {
      expect(resolveIsolationRequest(capabilities('ready', 'ready'), {})).toEqual({
        level: 'sandboxed',
        automaticSelection: 'sandboxed',
        selectionSource: 'automatic',
      });
      expect(resolveIsolationRequest(capabilities('ready', 'unsupported'), {}).level).toBe('standard');
    });

    it('marks an explicit weaker level as a user override', () => {
      expect(resolveIsolationRequest(capabilities('ready', 'ready'), { isolationLevel: 'standard' })).toEqual({
        level: 'standard',
        automaticSelection: 'sandboxed',
        selectionSource: 'user-override',
      });
    });

    it('marks an explicit recommended level as user confirmed', () => {
      expect(
        resolveIsolationRequest(capabilities('ready', 'ready'), { isolationLevel: 'sandboxed' }).selectionSource,
      ).toBe('user-confirmed');
    });

    it('rejects unavailable levels instead of downgrading', () => {
      expect(
        resolutionError(() =>
          resolveIsolationRequest(capabilities('ready', 'probe-failed'), { isolationLevel: 'sandboxed' }),
        ).code,
      ).toBe('level-unavailable');
    });

    it('rejects hosts without the standard floor', () => {
      expect(resolutionError(() => resolveIsolationRequest(capabilities('probe-failed', 'ready'), {})).code).toBe(
        'host-not-runnable',
      );
    });

    it('rejects stale capability revisions', () => {
      expect(
        resolutionError(() =>
          resolveIsolationRequest(capabilities('ready', 'ready', 'sha256:new'), { capabilityRevision: 'sha256:old' }),
        ).code,
      ).toBe('stale-revision');
      expect(
        resolveIsolationRequest(capabilities('ready', 'ready', 'sha256:new'), { capabilityRevision: 'sha256:new' })
          .level,
      ).toBe('sandboxed');
    });

    it('recommends sandboxed-kvm when ready and treats weaker choices as overrides', () => {
      const kvm = capabilities('ready', 'ready', 'sha256:rev', 'ready');

      expect(resolveIsolationRequest(kvm, {})).toEqual({
        level: 'sandboxed-kvm',
        automaticSelection: 'sandboxed-kvm',
        selectionSource: 'automatic',
      });
      expect(resolveIsolationRequest(kvm, { isolationLevel: 'sandboxed' }).selectionSource).toBe('user-override');
      expect(resolveIsolationRequest(kvm, { isolationLevel: 'standard' }).selectionSource).toBe('user-override');
      expect(resolveIsolationRequest(kvm, { isolationLevel: 'sandboxed-kvm' }).selectionSource).toBe('user-confirmed');
      // Choosing a stronger level than recommended is a confirmation, not an override.
      expect(
        resolveIsolationRequest(capabilities('ready', 'ready', 'sha256:rev', 'ready'), {
          isolationLevel: 'sandboxed-kvm',
        }).automaticSelection,
      ).toBe('sandboxed-kvm');
    });

    it('rejects sandboxed-kvm when it is not ready (never downgrades to sandboxed)', () => {
      expect(
        resolutionError(() =>
          resolveIsolationRequest(capabilities('ready', 'ready', 'sha256:rev', 'probe-failed'), {
            isolationLevel: 'sandboxed-kvm',
          }),
        ).code,
      ).toBe('level-unavailable');
    });

    it('rejects unknown levels', () => {
      expect(
        resolutionError(() => resolveIsolationRequest(capabilities('ready', 'ready'), { isolationLevel: 'vm' })).code,
      ).toBe('invalid-level');
    });
  });

  describe('microvm level', () => {
    it('is a recognised level that is neither gVisor nor standard', () => {
      expect(isIsolationLevel('microvm')).toBe(true);
      expect(isGvisorIsolationLevel('microvm')).toBe(false);
      expect(isMicrovmIsolationLevel('microvm')).toBe(true);
      expect(isEnhancedIsolationLevel('microvm')).toBe(true);
      expect(isEnhancedIsolationLevel('standard')).toBe(false);
      expect(effectiveIsolationLevel('microvm')).toBe('microvm');
    });

    it('always pins runc for microVM launchers (create and every recreate path)', () => {
      expect(runtimeForIsolationLevel('microvm', {})).toBe('runc');
      expect(containerRuntimeForIsolationLevel('microvm', {})).toBe('runc');
      expect(isolationRuntimeOptions({ isolationLevel: 'microvm' }, {})).toEqual({ runtime: 'runc' });
      expect(isolationRuntimeArgs({ isolationLevel: 'microvm' }, {})).toEqual(['runc']);
      // A runc runtime never gets mapped onto a gVisor variant.
      expect(mapGvisorRuntimeForNetwork('runc', true, {})).toBe('runc');
    });

    it('is recommended when ready and treats every weaker choice as an override', () => {
      const ready = capabilities('ready', 'ready', 'sha256:rev', 'ready', 'ready');

      expect(availableIsolationLevels(ready.levels)).toEqual(['microvm', 'sandboxed-kvm', 'sandboxed', 'standard']);
      expect(resolveIsolationRequest(ready, {})).toEqual({
        level: 'microvm',
        automaticSelection: 'microvm',
        selectionSource: 'automatic',
      });
      expect(resolveIsolationRequest(ready, { isolationLevel: 'sandboxed-kvm' }).selectionSource).toBe('user-override');
      expect(resolveIsolationRequest(ready, { isolationLevel: 'microvm' }).selectionSource).toBe('user-confirmed');
    });

    it('rejects microvm when it is not ready (never downgrades)', () => {
      const error = resolutionError(() =>
        resolveIsolationRequest(capabilities('ready', 'ready', 'sha256:rev', 'ready'), { isolationLevel: 'microvm' }),
      );

      expect(error.code).toBe('level-unavailable');
    });

    it('changes the revision with the microVM image and its state', () => {
      const base = {
        runtimes: { runc: 'runc' },
        probeImageId: 'sha256:image',
        microvmImageId: 'sha256:vm-1',
        levels: levels('ready', 'unsupported', 'unsupported', 'ready'),
      };
      const revision = computeIsolationCapabilityRevision(base);

      expect(computeIsolationCapabilityRevision({ ...base, microvmImageId: 'sha256:vm-2' })).not.toBe(revision);
      expect(
        computeIsolationCapabilityRevision({
          ...base,
          levels: levels('ready', 'unsupported', 'unsupported', 'probe-failed'),
        }),
      ).not.toBe(revision);
    });
  });

  it('builds a selection record that only takes the selecting user from the input', () => {
    const selection = buildIsolationSelection(
      { level: 'standard', automaticSelection: 'sandboxed', selectionSource: 'user-override' },
      'sha256:rev',
      { selectedBy: 'user-1', selectionSource: 'automatic', effectiveSelection: 'sandboxed' },
      new Date('2026-10-15T20:00:00.000Z'),
    );

    expect(selection).toEqual({
      automaticSelection: 'sandboxed',
      effectiveSelection: 'standard',
      selectionSource: 'user-override',
      selectedBy: 'user-1',
      selectedAt: '2026-10-15T20:00:00.000Z',
      capabilityRevision: 'sha256:rev',
    });
    expect(
      buildIsolationSelection(
        { level: 'standard', automaticSelection: 'standard', selectionSource: 'automatic' },
        'r',
        {
          selectedBy: 42,
        },
      ).selectedBy,
    ).toBeNull();
  });

  it('computes a deterministic revision that changes with the host state', () => {
    const base = {
      dockerVersion: '29.0.0',
      kernelVersion: '6.8.0',
      runtimes: { runc: 'runc', 'runsc-systrap': '/usr/local/bin/runsc' },
      probeImageId: 'sha256:image',
      levels: levels('ready', 'ready'),
    };
    const revision = computeIsolationCapabilityRevision(base);

    expect(revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      computeIsolationCapabilityRevision({
        ...base,
        runtimes: { 'runsc-systrap': '/usr/local/bin/runsc', runc: 'runc' },
      }),
    ).toBe(revision);
    expect(computeIsolationCapabilityRevision({ ...base, levels: levels('ready', 'probe-failed') })).not.toBe(revision);
    expect(computeIsolationCapabilityRevision({ ...base, levels: levels('ready', 'ready', 'ready') })).not.toBe(
      revision,
    );
  });
});
