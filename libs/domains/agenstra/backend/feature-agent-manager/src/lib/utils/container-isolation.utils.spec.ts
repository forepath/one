import type { HostIsolationCapabilitiesDto } from '../dto/container-isolation.dto';

import {
  availableIsolationLevels,
  buildIsolationSelection,
  containerRuntimeForIsolationLevel,
  computeIsolationCapabilityRevision,
  effectiveIsolationLevel,
  isIsolationLevel,
  isolationRuntimeArgs,
  isolationRuntimeOptions,
  IsolationResolutionError,
  resolveIsolationRequest,
  runtimeForIsolationLevel,
  strongestAvailableIsolationLevel,
} from './container-isolation.utils';

type Levels = HostIsolationCapabilitiesDto['levels'];

function levels(standard: string, sandboxed: string): Levels {
  return {
    standard: { rank: 1, runtime: 'runc', state: standard as Levels['standard']['state'] },
    sandboxed: { rank: 2, runtime: 'runsc-systrap', state: sandboxed as Levels['sandboxed']['state'] },
  };
}

function capabilities(standard: string, sandboxed: string, revision = 'sha256:rev') {
  return { revision, levels: levels(standard, sandboxed) };
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
    expect(isIsolationLevel('vm')).toBe(false);
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

  it('treats environments without a stored level as standard', () => {
    expect(effectiveIsolationLevel(undefined)).toBe('standard');
    expect(effectiveIsolationLevel(null)).toBe('standard');
    expect(effectiveIsolationLevel('sandboxed')).toBe('sandboxed');
  });

  it('pins the persisted runtime for recreate paths', () => {
    expect(isolationRuntimeOptions({ isolationLevel: 'sandboxed' }, {})).toEqual({ runtime: 'runsc-systrap' });
    expect(isolationRuntimeOptions({}, {})).toEqual({});
    expect(isolationRuntimeOptions({ isolationLevel: 'standard' }, {})).toEqual({});
    expect(isolationRuntimeOptions(null, {})).toEqual({});
    expect(isolationRuntimeArgs({ isolationLevel: 'sandboxed' }, {})).toEqual(['runsc-systrap']);
    expect(isolationRuntimeArgs({ isolationLevel: 'standard' }, {})).toEqual([]);
  });

  it("requests a runtime only for the sandboxed level (standard keeps Docker's default runtime)", () => {
    expect(containerRuntimeForIsolationLevel('sandboxed', {})).toBe('runsc-systrap');
    expect(containerRuntimeForIsolationLevel('standard', {})).toBeUndefined();
  });

  it('lists ready levels strongest first and requires the standard floor for a recommendation', () => {
    expect(availableIsolationLevels(levels('ready', 'ready'))).toEqual(['sandboxed', 'standard']);
    expect(strongestAvailableIsolationLevel(levels('ready', 'ready'))).toBe('sandboxed');
    expect(strongestAvailableIsolationLevel(levels('ready', 'unsupported'))).toBe('standard');
    expect(strongestAvailableIsolationLevel(levels('probe-failed', 'ready'))).toBeNull();
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

    it('rejects unknown levels', () => {
      expect(
        resolutionError(() => resolveIsolationRequest(capabilities('ready', 'ready'), { isolationLevel: 'vm' })).code,
      ).toBe('invalid-level');
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
  });
});
