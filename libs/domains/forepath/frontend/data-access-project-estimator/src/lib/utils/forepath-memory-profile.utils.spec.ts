import {
  canSwitchToMemoryProfile,
  listLowerMemoryProfileIds,
  listMemoryProfileSwitcherOptions,
  resolveRestoredMemoryProfileId,
} from './forepath-memory-profile.utils';

describe('forepath memory profile utils', () => {
  it('should list only lower profiles than the active profile', () => {
    expect(listLowerMemoryProfileIds('standard', 'standard')).toEqual(['balanced', 'lite']);
    expect(listLowerMemoryProfileIds('balanced', 'balanced')).toEqual(['lite']);
    expect(listLowerMemoryProfileIds('lite', 'standard')).toEqual([]);
  });

  it('should allow switching within the device max but not above it', () => {
    expect(canSwitchToMemoryProfile('standard', 'balanced', 'standard')).toBe(true);
    expect(canSwitchToMemoryProfile('balanced', 'balanced', 'standard')).toBe(false);
    expect(canSwitchToMemoryProfile('lite', 'balanced', 'balanced')).toBe(true);
    expect(canSwitchToMemoryProfile('balanced', 'lite', 'balanced')).toBe(true);
    expect(canSwitchToMemoryProfile('standard', 'lite', 'balanced')).toBe(false);
  });

  it('should list all profiles up to the device max in the switcher', () => {
    expect(listMemoryProfileSwitcherOptions('standard', 'standard')).toEqual([
      { profileId: 'lite', isActive: false, canSelect: true },
      { profileId: 'balanced', isActive: false, canSelect: true },
      { profileId: 'standard', isActive: true, canSelect: false },
    ]);
    expect(listMemoryProfileSwitcherOptions('lite', 'standard')).toEqual([
      { profileId: 'lite', isActive: true, canSelect: false },
      { profileId: 'balanced', isActive: false, canSelect: true },
      { profileId: 'standard', isActive: false, canSelect: true },
    ]);
    expect(listMemoryProfileSwitcherOptions('balanced', 'balanced')).toEqual([
      { profileId: 'lite', isActive: false, canSelect: true },
      { profileId: 'balanced', isActive: true, canSelect: false },
    ]);
  });

  it('should restore a saved profile only when the device benchmark allows it', () => {
    expect(resolveRestoredMemoryProfileId('standard', 'standard')).toBe('standard');
    expect(resolveRestoredMemoryProfileId('balanced', 'standard')).toBe('balanced');
    expect(resolveRestoredMemoryProfileId('standard', 'balanced')).toBe('balanced');
    expect(resolveRestoredMemoryProfileId(null, 'lite')).toBe('lite');
  });
});
