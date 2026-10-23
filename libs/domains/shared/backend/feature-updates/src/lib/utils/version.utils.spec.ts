import { compareVersions, getInstalledVersion, normalizeVersion, resolveUpdateState } from './version.utils';

describe('version.utils', () => {
  it('getInstalledVersion prefers configured env then VERSION then APP_VERSION', () => {
    expect(getInstalledVersion({ VERSION: '1.2.3' })).toBe('1.2.3');
    expect(getInstalledVersion({ APP_VERSION: '4.5.6' })).toBe('4.5.6');
    expect(getInstalledVersion({ CUSTOM_VERSION: '9.9.9' }, 'CUSTOM_VERSION')).toBe('9.9.9');
    expect(getInstalledVersion({})).toBe('0.0.0');
  });

  it('getInstalledVersion ignores unresolved $VERSION placeholders', () => {
    expect(getInstalledVersion({ VERSION: '$VERSION' })).toBe('0.0.0');
    expect(getInstalledVersion({ VERSION: '${VERSION}', APP_VERSION: '2.22.0' })).toBe('2.22.0');
    expect(getInstalledVersion({ VERSION: '  $APP_VERSION  ' })).toBe('0.0.0');
  });

  it('compareVersions coerces semver tags', () => {
    expect(compareVersions('v1.0.0', '1.1.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('not-a-version', '1.0.0')).toBeNull();
  });

  it('compareVersions orders prereleases before their release (beta channel)', () => {
    expect(compareVersions('v3.6.0-beta.1', '3.6.0')).toBe(-1);
    expect(compareVersions('3.6.0-beta.2', '3.6.0-beta.10')).toBe(-1);
    expect(compareVersions('3.6.0-beta.1', '3.5.9')).toBe(1);
    expect(resolveUpdateState('3.6.0-beta.1', 'v3.6.0')).toBe('update_available');
    expect(normalizeVersion('v3.6.0-beta.1')).toBe('3.6.0-beta.1');
  });

  it('resolveUpdateState compares installed and latest versions', () => {
    expect(resolveUpdateState('1.0.0', '1.1.0')).toBe('update_available');
    expect(resolveUpdateState('2.0.0', '2.0.0')).toBe('up_to_date');
    expect(resolveUpdateState('1.0.0', null)).toBe('unknown');
    expect(resolveUpdateState('broken', '1.0.0')).toBe('unknown');
  });

  it('normalizeVersion returns coerced semver', () => {
    expect(normalizeVersion('v3.4.5')).toBe('3.4.5');
    expect(normalizeVersion('invalid')).toBeNull();
  });
});
