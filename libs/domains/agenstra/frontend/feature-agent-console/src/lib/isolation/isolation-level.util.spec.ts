import type { ClientIsolationSummaryDto } from '@forepath/agenstra/frontend/data-access-agent-console';

import {
  getAvailableIsolationLevels,
  getDisplayedIsolationLevel,
  INITIAL_ISOLATION_SELECTION,
  type IsolationSelectionState,
  reconcileIsolationSelection,
  resolveIsolationSubmission,
  getEnvironmentIsolationLevel,
  getIsolationBadgeColor,
  getIsolationLevelUnavailableReason,
  getRecommendedIsolationLevel,
  getWorkspaceIsolationIndicatorLabel,
  isIsolationDowngrade,
  isIsolationLevelAvailable,
  isolationLevelLabel,
  isolationRuntimeStateLabel,
  isGvisorIsolationLevel,
  isKnownIsolationLevel,
  ISOLATION_LEVELS_STRONGEST_FIRST,
  getSelectableIsolationLevels,
  isolationDowngradeDialogTexts,
  isolationLevelDescription,
} from './isolation-level.util';

describe('isolation-level.util', () => {
  const sandboxReady: ClientIsolationSummaryDto = {
    supported: true,
    recommendedLevel: 'sandboxed',
    availableLevels: ['sandboxed', 'standard'],
    levels: {
      standard: { rank: 1, runtime: 'runc', state: 'ready' },
      sandboxed: { rank: 2, runtime: 'runsc-systrap', state: 'ready' },
    },
    revision: 'rev-1',
    probedAt: '2024-01-01T00:00:00Z',
    probing: false,
    stale: false,
  };
  const standardOnly: ClientIsolationSummaryDto = {
    ...sandboxReady,
    recommendedLevel: 'standard',
    availableLevels: ['standard'],
    levels: {
      ...sandboxReady.levels,
      sandboxed: {
        rank: 2,
        runtime: 'runsc-systrap',
        state: 'installation-failed',
        reasonCode: 'E_RUNTIME_NOT_REGISTERED',
        reason: 'runsc-systrap is not registered with Docker',
      },
    },
  };
  const legacy: ClientIsolationSummaryDto = { ...standardOnly, supported: false };

  it('labels levels and runtime states', () => {
    expect(isolationLevelLabel('sandboxed')).toBe('Sandboxed (gVisor)');
    expect(isolationLevelLabel('standard')).toBe('Standard Docker');
    expect(isolationRuntimeStateLabel('ready')).toBe('Ready');
    expect(isolationRuntimeStateLabel('disabled-by-admin')).not.toBe('disabled-by-admin');
  });

  it('recommends the host level and falls back to standard for legacy or unknown hosts', () => {
    expect(getRecommendedIsolationLevel({ isolation: sandboxReady })).toBe('sandboxed');
    expect(getRecommendedIsolationLevel({ isolation: standardOnly })).toBe('standard');
    expect(getRecommendedIsolationLevel({ isolation: legacy })).toBe('standard');
    expect(getRecommendedIsolationLevel({})).toBe('standard');
    expect(getRecommendedIsolationLevel(null)).toBe('standard');
    expect(
      getRecommendedIsolationLevel({ isolation: { ...sandboxReady, recommendedLevel: null, availableLevels: [] } }),
    ).toBeNull();
  });

  it('lists available levels strongest first (legacy / unknown hosts: standard only)', () => {
    expect(
      getAvailableIsolationLevels({ isolation: { ...sandboxReady, availableLevels: ['standard', 'sandboxed'] } }),
    ).toEqual(['sandboxed', 'standard']);
    expect(getAvailableIsolationLevels({ isolation: legacy })).toEqual(['standard']);
    expect(getAvailableIsolationLevels(undefined)).toEqual(['standard']);
    expect(isIsolationLevelAvailable({ isolation: standardOnly }, 'sandboxed')).toBe(false);
    expect(isIsolationLevelAvailable({ isolation: standardOnly }, 'standard')).toBe(true);
  });

  it('detects downgrades below the recommended level', () => {
    expect(isIsolationDowngrade('standard', 'sandboxed')).toBe(true);
    expect(isIsolationDowngrade('sandboxed', 'sandboxed')).toBe(false);
    expect(isIsolationDowngrade('standard', 'standard')).toBe(false);
    expect(isIsolationDowngrade('standard', null)).toBe(false);
  });

  it('explains why a level is unavailable', () => {
    expect(getIsolationLevelUnavailableReason({ isolation: sandboxReady }, 'sandboxed')).toBeNull();
    expect(getIsolationLevelUnavailableReason({ isolation: standardOnly }, 'sandboxed')).toBe(
      'runsc-systrap is not registered with Docker',
    );
    expect(
      getIsolationLevelUnavailableReason(
        {
          isolation: {
            ...standardOnly,
            levels: { ...standardOnly.levels, sandboxed: { rank: 2, runtime: 'runsc-systrap', state: 'unsupported' } },
          },
        },
        'sandboxed',
      ),
    ).toBe('Not supported');
    expect(getIsolationLevelUnavailableReason({ isolation: legacy }, 'sandboxed')).toContain('agent manager');
  });

  it('maps badge colors, environment levels and workspace indicators', () => {
    expect(getIsolationBadgeColor('sandboxed')).toBe('success');
    expect(getIsolationBadgeColor('standard')).toBe('secondary');
    expect(getEnvironmentIsolationLevel({ isolation: { level: 'sandboxed', runtime: 'runsc-systrap' } })).toBe(
      'sandboxed',
    );
    expect(getEnvironmentIsolationLevel({})).toBe('standard');
    expect(getWorkspaceIsolationIndicatorLabel({ isolation: sandboxReady })).toBe('Sandbox available');
    expect(getWorkspaceIsolationIndicatorLabel({ isolation: standardOnly })).toBe('Standard only');
    expect(getWorkspaceIsolationIndicatorLabel({ isolation: legacy })).toBe('Standard only');
    expect(getWorkspaceIsolationIndicatorLabel({})).toBeNull();
  });

  describe('Add Environment selection', () => {
    const standardOnlyRev2: ClientIsolationSummaryDto = { ...standardOnly, revision: 'rev-2' };
    const pinned = (overrides: Partial<IsolationSelectionState> = {}): IsolationSelectionState => ({
      ...INITIAL_ISOLATION_SELECTION,
      pinnedRevision: 'rev-1',
      ...overrides,
    });

    describe('reconcileIsolationSelection', () => {
      it('keeps the selection while the revision is unchanged', () => {
        const selection = pinned({ explicitLevel: 'sandboxed' });

        expect(reconcileIsolationSelection(selection, sandboxReady)).toBe(selection);
      });

      it('follows the latest revision without an explicit choice', () => {
        expect(reconcileIsolationSelection(pinned(), standardOnlyRev2)).toEqual(pinned({ pinnedRevision: 'rev-2' }));
        expect(reconcileIsolationSelection(INITIAL_ISOLATION_SELECTION, sandboxReady)).toEqual(pinned());
      });

      it('resets an explicit choice and requires a review when the revision changes', () => {
        expect(reconcileIsolationSelection(pinned({ explicitLevel: 'sandboxed' }), standardOnlyRev2)).toEqual({
          explicitLevel: null,
          pinnedRevision: 'rev-2',
          reviewRequired: true,
        });
      });

      it('keeps a pending review when a later refresh changes the revision again', () => {
        const selection = pinned({ pinnedRevision: 'rev-2', reviewRequired: true });

        expect(reconcileIsolationSelection(selection, { ...standardOnly, revision: 'rev-3' })).toEqual({
          ...selection,
          pinnedRevision: 'rev-3',
        });
      });
    });

    describe('getDisplayedIsolationLevel', () => {
      it('shows the explicit choice, else the recommendation', () => {
        expect(getDisplayedIsolationLevel(pinned({ explicitLevel: 'standard' }), { isolation: sandboxReady })).toBe(
          'standard',
        );
        expect(getDisplayedIsolationLevel(pinned(), { isolation: sandboxReady })).toBe('sandboxed');
      });

      it('never switches an unavailable explicit choice to another level', () => {
        expect(getDisplayedIsolationLevel(pinned({ explicitLevel: 'sandboxed' }), { isolation: standardOnly })).toBe(
          'sandboxed',
        );
      });

      it('selects nothing while a review is required', () => {
        expect(getDisplayedIsolationLevel(pinned({ reviewRequired: true }), { isolation: standardOnly })).toBeNull();
      });
    });

    describe('resolveIsolationSubmission', () => {
      it('omits the level but pins the displayed revision without an explicit choice', () => {
        expect(
          resolveIsolationSubmission({ explicitLevel: null, pinnedRevision: 'rev-1', isolation: sandboxReady }),
        ).toEqual({ capabilityRevision: 'rev-1' });
      });

      it('submits the pinned (not the latest) revision so the server rejects capability changes', () => {
        expect(
          resolveIsolationSubmission({ explicitLevel: null, pinnedRevision: 'rev-1', isolation: standardOnlyRev2 }),
        ).toEqual({ capabilityRevision: 'rev-1' });
      });

      it('sends an explicit level with the pinned revision', () => {
        expect(
          resolveIsolationSubmission({ explicitLevel: 'sandboxed', pinnedRevision: 'rev-1', isolation: sandboxReady }),
        ).toEqual({ isolationLevel: 'sandboxed', capabilityRevision: 'rev-1' });
        expect(
          resolveIsolationSubmission({ explicitLevel: 'standard', pinnedRevision: null, isolation: sandboxReady }),
        ).toEqual({ isolationLevel: 'standard' });
      });

      it('blocks an explicit level that became unavailable instead of downgrading', () => {
        expect(
          resolveIsolationSubmission({ explicitLevel: 'sandboxed', pinnedRevision: 'rev-1', isolation: standardOnly }),
        ).toEqual({ blockedReason: 'level-unavailable' });
      });

      it('blocks until the user reviews changed capabilities', () => {
        expect(
          resolveIsolationSubmission({
            explicitLevel: null,
            pinnedRevision: 'rev-2',
            reviewRequired: true,
            isolation: standardOnlyRev2,
          }),
        ).toEqual({ blockedReason: 'review-required' });
        expect(
          resolveIsolationSubmission({
            explicitLevel: 'standard',
            pinnedRevision: 'rev-2',
            reviewRequired: true,
            isolation: standardOnlyRev2,
          }),
        ).toEqual({ isolationLevel: 'standard', capabilityRevision: 'rev-2' });
      });

      it('blocks when the host has no ready level', () => {
        expect(
          resolveIsolationSubmission({
            explicitLevel: null,
            pinnedRevision: 'rev-1',
            isolation: { ...sandboxReady, recommendedLevel: null, availableLevels: [] },
          }),
        ).toEqual({ blockedReason: 'no-level-available' });
      });

      it('requests standard explicitly on legacy or unknown hosts (never a level the user did not see)', () => {
        expect(resolveIsolationSubmission({ explicitLevel: null, pinnedRevision: null, isolation: legacy })).toEqual({
          isolationLevel: 'standard',
        });
        expect(
          resolveIsolationSubmission({ explicitLevel: 'standard', pinnedRevision: 'rev-1', isolation: undefined }),
        ).toEqual({ isolationLevel: 'standard' });
        expect(
          resolveIsolationSubmission({ explicitLevel: 'sandboxed', pinnedRevision: 'rev-1', isolation: legacy }),
        ).toEqual({ blockedReason: 'level-unavailable' });
        expect(
          resolveIsolationSubmission({
            explicitLevel: null,
            pinnedRevision: null,
            reviewRequired: true,
            isolation: legacy,
          }),
        ).toEqual({ blockedReason: 'review-required' });
      });
    });
  });
  describe('sandboxed-kvm', () => {
    const kvmReady: ClientIsolationSummaryDto = {
      ...sandboxReady,
      recommendedLevel: 'sandboxed-kvm',
      availableLevels: ['sandboxed-kvm', 'sandboxed', 'standard'],
      levels: {
        ...sandboxReady.levels,
        'sandboxed-kvm': { rank: 3, runtime: 'runsc-kvm', state: 'ready' },
      },
    };
    const kvmUnavailable: ClientIsolationSummaryDto = {
      ...sandboxReady,
      levels: {
        ...sandboxReady.levels,
        'sandboxed-kvm': {
          rank: 3,
          runtime: 'runsc-kvm',
          state: 'probe-failed',
          reasonCode: 'E_KVM_UNAVAILABLE',
          reason: 'The KVM device (/dev/kvm) is not available on this host',
        },
      },
    };

    it('orders, labels and colours the level', () => {
      expect(ISOLATION_LEVELS_STRONGEST_FIRST).toEqual(['microvm', 'sandboxed-kvm', 'sandboxed', 'standard']);
      expect(isolationLevelLabel('sandboxed-kvm')).toBe('Sandboxed (gVisor on KVM)');
      expect(getIsolationBadgeColor('sandboxed-kvm')).toBe('primary');
      expect(isGvisorIsolationLevel('sandboxed-kvm')).toBe(true);
      expect(isGvisorIsolationLevel('sandboxed')).toBe(true);
      expect(isGvisorIsolationLevel('standard')).toBe(false);
      expect(isKnownIsolationLevel('sandboxed-kvm')).toBe(true);
      expect(isKnownIsolationLevel('kata')).toBe(false);
    });

    it('recommends sandboxed-kvm and lists it strongest first', () => {
      expect(getRecommendedIsolationLevel({ isolation: kvmReady })).toBe('sandboxed-kvm');
      expect(
        getAvailableIsolationLevels({
          isolation: { ...kvmReady, availableLevels: ['standard', 'sandboxed-kvm', 'sandboxed'] },
        }),
      ).toEqual(['sandboxed-kvm', 'sandboxed', 'standard']);
    });

    it('ignores levels this console does not know yet', () => {
      expect(
        getAvailableIsolationLevels({
          isolation: { ...kvmReady, availableLevels: ['future-level' as never, 'sandboxed', 'standard'] },
        }),
      ).toEqual(['sandboxed', 'standard']);
    });

    it('treats sandboxed and standard as downgrades of sandboxed-kvm', () => {
      expect(isIsolationDowngrade('sandboxed', 'sandboxed-kvm')).toBe(true);
      expect(isIsolationDowngrade('standard', 'sandboxed-kvm')).toBe(true);
      expect(isIsolationDowngrade('sandboxed-kvm', 'sandboxed-kvm')).toBe(false);
      expect(isIsolationDowngrade('sandboxed-kvm', 'sandboxed')).toBe(false);
    });

    it('explains why the level is unavailable', () => {
      expect(getIsolationLevelUnavailableReason({ isolation: kvmReady }, 'sandboxed-kvm')).toBeNull();
      expect(getIsolationLevelUnavailableReason({ isolation: kvmUnavailable }, 'sandboxed-kvm')).toBe(
        'The KVM device (/dev/kvm) is not available on this host',
      );
      // Controllers that predate the level do not report it: nothing to explain.
      expect(getIsolationLevelUnavailableReason({ isolation: sandboxReady }, 'sandboxed-kvm')).toBeNull();
    });

    it('shows the KVM sandbox in the workspace indicator', () => {
      expect(getWorkspaceIsolationIndicatorLabel({ isolation: kvmReady })).toBe('KVM sandbox available');
      expect(getWorkspaceIsolationIndicatorLabel({ isolation: kvmUnavailable })).toBe('Sandbox available');
    });

    it('offers sandboxed-kvm only when the host reports it', () => {
      expect(getSelectableIsolationLevels({ isolation: kvmReady })).toEqual(['sandboxed-kvm', 'sandboxed', 'standard']);
      expect(getSelectableIsolationLevels({ isolation: kvmUnavailable })).toEqual([
        'sandboxed-kvm',
        'sandboxed',
        'standard',
      ]);
      expect(getSelectableIsolationLevels({ isolation: sandboxReady })).toEqual(['sandboxed', 'standard']);
      expect(getSelectableIsolationLevels(undefined)).toEqual(['sandboxed', 'standard']);
    });

    it('describes every level and the downgrade confirmations', () => {
      for (const level of ISOLATION_LEVELS_STRONGEST_FIRST) {
        expect(isolationLevelDescription(level)).not.toBe('');
      }

      expect(isolationDowngradeDialogTexts('standard').confirmLabel).toBe('Use Standard Docker');
      expect(isolationDowngradeDialogTexts('sandboxed').confirmLabel).toBe('Use Sandboxed (gVisor)');
      expect(isolationDowngradeDialogTexts('sandboxed').message).toContain('KVM');
    });

    it('keeps the environment level', () => {
      expect(
        getEnvironmentIsolationLevel({ isolation: { level: 'sandboxed-kvm', runtime: 'runsc-kvm', selection: null } }),
      ).toBe('sandboxed-kvm');
    });

    it('submits explicit sandboxed-kvm choices only when available', () => {
      expect(
        resolveIsolationSubmission({ explicitLevel: 'sandboxed-kvm', pinnedRevision: 'rev-1', isolation: kvmReady }),
      ).toEqual({ isolationLevel: 'sandboxed-kvm', capabilityRevision: 'rev-1' });
      expect(
        resolveIsolationSubmission({
          explicitLevel: 'sandboxed-kvm',
          pinnedRevision: 'rev-1',
          isolation: kvmUnavailable,
        }),
      ).toEqual({ blockedReason: 'level-unavailable' });
      expect(
        resolveIsolationSubmission({ explicitLevel: 'sandboxed-kvm', pinnedRevision: null, isolation: legacy }),
      ).toEqual({ blockedReason: 'level-unavailable' });
    });
  });
  describe('microvm', () => {
    const microvmReady: ClientIsolationSummaryDto = {
      ...sandboxReady,
      recommendedLevel: 'microvm',
      availableLevels: ['microvm', 'sandboxed-kvm', 'sandboxed', 'standard'],
      levels: {
        ...sandboxReady.levels,
        'sandboxed-kvm': { rank: 3, runtime: 'runsc-kvm', state: 'ready' },
        microvm: { rank: 4, runtime: 'runc', state: 'ready' },
      },
    };
    const microvmUnavailable: ClientIsolationSummaryDto = {
      ...sandboxReady,
      levels: {
        ...sandboxReady.levels,
        microvm: {
          rank: 4,
          runtime: 'runc',
          state: 'unsupported',
          reasonCode: 'E_KVM_UNAVAILABLE',
          reason: 'The KVM device (/dev/kvm) is not available on this host',
        },
      },
    };

    it('orders, labels and colours the level (not a gVisor level)', () => {
      expect(ISOLATION_LEVELS_STRONGEST_FIRST[0]).toBe('microvm');
      expect(isolationLevelLabel('microvm')).toBe('MicroVM (KVM)');
      expect(isolationLevelDescription('microvm')).toContain('virtual machine');
      expect(getIsolationBadgeColor('microvm')).toBe('dark');
      expect(isGvisorIsolationLevel('microvm')).toBe(false);
      expect(isKnownIsolationLevel('microvm')).toBe(true);
    });

    it('recommends microvm and lists it strongest first', () => {
      expect(getRecommendedIsolationLevel({ isolation: microvmReady })).toBe('microvm');
      expect(
        getAvailableIsolationLevels({
          isolation: { ...microvmReady, availableLevels: ['standard', 'microvm', 'sandboxed-kvm', 'sandboxed'] },
        }),
      ).toEqual(['microvm', 'sandboxed-kvm', 'sandboxed', 'standard']);
    });

    it('treats every other level as a downgrade of microvm and confirms the gVisor one specifically', () => {
      expect(isIsolationDowngrade('sandboxed-kvm', 'microvm')).toBe(true);
      expect(isIsolationDowngrade('standard', 'microvm')).toBe(true);
      expect(isIsolationDowngrade('microvm', 'microvm')).toBe(false);
      expect(isolationDowngradeDialogTexts('sandboxed-kvm')).toEqual({
        title: 'Use the gVisor sandbox instead of a microVM?',
        message: expect.stringContaining('its own virtual machine'),
        confirmLabel: 'Use Sandboxed (gVisor on KVM)',
      });
      // The Standard confirmation no longer names a specific recommended level.
      expect(isolationDowngradeDialogTexts('standard').message).toContain('the recommended isolation level');
    });

    it('offers microvm only when the host reports it and explains why it is unavailable', () => {
      expect(getSelectableIsolationLevels({ isolation: microvmReady })).toEqual([
        'microvm',
        'sandboxed-kvm',
        'sandboxed',
        'standard',
      ]);
      expect(getSelectableIsolationLevels({ isolation: microvmUnavailable })).toEqual([
        'microvm',
        'sandboxed',
        'standard',
      ]);
      expect(getIsolationLevelUnavailableReason({ isolation: microvmUnavailable }, 'microvm')).toBe(
        'The KVM device (/dev/kvm) is not available on this host',
      );
      expect(getIsolationLevelUnavailableReason({ isolation: sandboxReady }, 'microvm')).toBeNull();
    });

    it('shows the microVM in the workspace indicator and keeps the environment level', () => {
      expect(getWorkspaceIsolationIndicatorLabel({ isolation: microvmReady })).toBe('MicroVM available');
      expect(getWorkspaceIsolationIndicatorLabel({ isolation: microvmUnavailable })).toBe('Sandbox available');
      expect(getEnvironmentIsolationLevel({ isolation: { level: 'microvm', runtime: 'runc', selection: null } })).toBe(
        'microvm',
      );
    });

    it('submits explicit microvm choices only when available', () => {
      expect(
        resolveIsolationSubmission({ explicitLevel: 'microvm', pinnedRevision: 'rev-1', isolation: microvmReady }),
      ).toEqual({ isolationLevel: 'microvm', capabilityRevision: 'rev-1' });
      expect(
        resolveIsolationSubmission({
          explicitLevel: 'microvm',
          pinnedRevision: 'rev-1',
          isolation: microvmUnavailable,
        }),
      ).toEqual({ blockedReason: 'level-unavailable' });
    });
  });
});
