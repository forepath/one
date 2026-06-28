import {
  DEFAULT_CLOUD_INIT_WORK_DIR,
  normalizeCloudInitWorkDir,
  quoteShellLiteral,
  validateCloudInitWorkDir,
} from './work-dir.utils';

describe('workDirUtils', () => {
  it('normalizes empty workDir to default', () => {
    expect(normalizeCloudInitWorkDir(undefined)).toBe(DEFAULT_CLOUD_INIT_WORK_DIR);
    expect(normalizeCloudInitWorkDir('  ')).toBe(DEFAULT_CLOUD_INIT_WORK_DIR);
  });

  it('accepts valid paths under /opt', () => {
    expect(validateCloudInitWorkDir('/opt/custom-app')).toBe('/opt/custom-app');
    expect(validateCloudInitWorkDir('/opt/my_app/sub-dir')).toBe('/opt/my_app/sub-dir');
  });

  it('rejects paths outside the allowlist', () => {
    expect(() => validateCloudInitWorkDir('/tmp/evil')).toThrow();
    expect(() => validateCloudInitWorkDir('/opt/bad;rm')).toThrow();
    expect(() => validateCloudInitWorkDir('relative/path')).toThrow();
  });

  it('quotes shell literals safely', () => {
    expect(quoteShellLiteral('/opt/custom-app')).toBe("'/opt/custom-app'");
    expect(quoteShellLiteral("'/opt/evil'")).toBe(`''"'"'/opt/evil'"'"''`);
  });
});
