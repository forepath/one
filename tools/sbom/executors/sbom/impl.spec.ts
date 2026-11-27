import path from 'path';

jest.mock('@nx/js', () => ({
  createPackageJson: jest.fn(() => ({
    name: 'test-app',
    version: '0.0.1',
    dependencies: { foo: '1.0.0' },
  })),
  createLockFile: jest.fn(() => '{"lockfile": "content"}'),
  getLockFileName: jest.fn(() => 'package-lock.json'),
}));

jest.mock('@nx/devkit', () => ({
  detectPackageManager: jest.fn(() => 'npm'),
  logger: {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  workspaceRoot: '/workspace',
}));

jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({ status: 0 })),
}));

const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockReadFileSync = jest.fn();
const fileStore: Record<string, string> = {};

jest.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

const sbomExecutor = require('./impl').default;

function workspaceCyclonedxCliPath(): string {
  return path.join('/workspace', 'node_modules', '@cyclonedx', 'cyclonedx-npm', 'bin', 'cyclonedx-npm-cli.js');
}

describe('sbomExecutor', () => {
  const mockContext = {
    projectName: 'test',
    projectGraph: {
      nodes: {
        test: {
          data: { root: 'apps/test' },
        },
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(fileStore)) {
      delete fileStore[key];
    }
    mockExistsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s === workspaceCyclonedxCliPath()) {
        return true;
      }
      return Object.prototype.hasOwnProperty.call(fileStore, s);
    });
    mockMkdirSync.mockImplementation(() => {});
    mockWriteFileSync.mockImplementation((p: string, content: string) => {
      fileStore[p] = content;
    });
    mockReadFileSync.mockImplementation((p: string) => {
      if (Object.prototype.hasOwnProperty.call(fileStore, p)) {
        return fileStore[p];
      }
      throw new Error(`ENOENT: ${p}`);
    });
  });

  it('should return success when skip is true', async () => {
    const result = await sbomExecutor({ skip: true }, mockContext);
    expect(result.success).toBe(true);
    const { logger } = require('@nx/devkit');
    expect(logger.log).toHaveBeenCalledWith('SBOM generation skipped for this project.');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('should throw when project is not in graph', async () => {
    await expect(sbomExecutor({}, { ...mockContext, projectGraph: { nodes: {} } })).rejects.toThrow(
      'Project "test" not found',
    );
  });

  it('should generate manifest and lockfile when project has no package.json', async () => {
    const { spawnSync } = require('child_process');
    const { createPackageJson, createLockFile, getLockFileName } = require('@nx/js');

    const result = await sbomExecutor({ validate: false }, mockContext);

    expect(result.success).toBe(true);
    expect(createPackageJson).toHaveBeenCalledWith('test', mockContext.projectGraph, {
      root: '/workspace',
      isProduction: true,
    });
    expect(createLockFile).toHaveBeenCalled();
    expect(getLockFileName).toHaveBeenCalledWith('npm');
    expect(mockMkdirSync).toHaveBeenCalledWith(path.join('/workspace', 'dist', 'sbom-work', 'test'), {
      recursive: true,
    });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join('/workspace', 'dist', 'sbom-work', 'test', 'package.json'),
      expect.any(String),
      'utf-8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join('/workspace', 'dist', 'sbom-work', 'test', 'package-lock.json'),
      '{"lockfile": "content"}',
      'utf-8',
    );
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        workspaceCyclonedxCliPath(),
        'package.json',
        '--output-file',
        expect.stringContaining('test.cdx.json'),
        '--output-format',
        'JSON',
        '--output-reproducible',
        '--ignore-npm-errors',
        '--spec-version',
        '1.6',
        '--package-lock-only',
      ]),
      expect.objectContaining({ cwd: expect.any(String) }),
    );
  });

  it('should use project package.json when it exists', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s === workspaceCyclonedxCliPath()) {
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(fileStore, s)) {
        return true;
      }
      return s.endsWith('package.json') && s.includes('apps/');
    });
    const { spawnSync } = require('child_process');
    const { createPackageJson } = require('@nx/js');

    const result = await sbomExecutor({ validate: false }, mockContext);

    expect(result.success).toBe(true);
    expect(createPackageJson).not.toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([workspaceCyclonedxCliPath(), 'package.json']),
      expect.objectContaining({
        cwd: path.join('/workspace', 'dist', 'apps', 'test'),
      }),
    );
  });

  it('should return failure when cyclonedx-npm fails', async () => {
    const { spawnSync } = require('child_process');
    spawnSync.mockReturnValueOnce({ status: 1 });

    const result = await sbomExecutor({ validate: false }, mockContext);

    expect(result.success).toBe(false);
    const { logger } = require('@nx/devkit');
    expect(logger.error).toHaveBeenCalledWith('cyclonedx-npm failed.');
  });

  it('should run validation when validate is true', async () => {
    const { spawnSync } = require('child_process');
    spawnSync.mockReturnValue({ status: 0 });

    await sbomExecutor({ validate: true }, mockContext);

    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(spawnSync).toHaveBeenLastCalledWith(
      'cyclonedx-cli',
      ['validate', '--input-file', expect.stringContaining('test.cdx.json')],
      expect.any(Object),
    );
  });

  it('should return failure when validation fails', async () => {
    const { spawnSync } = require('child_process');
    spawnSync.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1, error: null });

    const result = await sbomExecutor({ validate: true }, mockContext);

    expect(result.success).toBe(false);
    const { logger } = require('@nx/devkit');
    expect(logger.error).toHaveBeenCalledWith('cyclonedx-cli validate failed.');
  });

  it('should pass custom outputPath and specVersion', async () => {
    const { spawnSync } = require('child_process');
    await sbomExecutor(
      {
        validate: false,
        outputPath: 'custom/sboms',
        specVersion: '1.5',
      },
      mockContext,
    );
    const spawnArgs = spawnSync.mock.calls[0][1] as string[];
    expect(spawnArgs[0]).toBe(workspaceCyclonedxCliPath());
    const outputFileIdx = spawnArgs.indexOf('--output-file');
    expect(outputFileIdx).toBeGreaterThanOrEqual(0);
    expect(spawnArgs[outputFileIdx + 1]).toContain('custom');
    expect(spawnArgs[outputFileIdx + 1]).toContain('test.cdx.json');
    const specIdx = spawnArgs.indexOf('--spec-version');
    expect(spawnArgs[specIdx + 1]).toBe('1.5');
  });

  it('should override package.json and package-lock.json version when appVersion is set (generated workdir)', async () => {
    const workDir = path.join('/workspace', 'dist', 'sbom-work', 'test');
    const pkgPath = path.join(workDir, 'package.json');
    const lockPath = path.join(workDir, 'package-lock.json');

    const result = await sbomExecutor({ validate: false, appVersion: ' 2.3.4 ' }, mockContext);

    expect(result.success).toBe(true);
    const finalPkg = JSON.parse(fileStore[pkgPath] as string);
    expect(finalPkg.version).toBe('2.3.4');
    const finalLock = JSON.parse(fileStore[lockPath] as string);
    expect(finalLock.version).toBe('2.3.4');
  });

  it('should override versions when appVersion is set and project package.json exists', async () => {
    const workDir = path.join('/workspace', 'dist', 'apps/test');
    const pkgPath = path.join(workDir, 'package.json');
    const lockPath = path.join(workDir, 'package-lock.json');
    fileStore[pkgPath] = JSON.stringify({ name: 'app', version: '0.0.1' });
    fileStore[lockPath] = JSON.stringify({
      name: 'app',
      version: '0.0.1',
      lockfileVersion: 3,
      packages: { '': { name: 'app', version: '0.0.1' } },
    });
    mockExistsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s === workspaceCyclonedxCliPath()) {
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(fileStore, s)) {
        return true;
      }
      return s.endsWith('package.json') && s.includes('apps/');
    });

    const result = await sbomExecutor({ validate: false, appVersion: '9.0.0' }, mockContext);

    expect(result.success).toBe(true);
    expect(JSON.parse(fileStore[pkgPath] as string).version).toBe('9.0.0');
    expect(JSON.parse(fileStore[lockPath] as string).version).toBe('9.0.0');
    expect(JSON.parse(fileStore[lockPath] as string).packages[''].version).toBe('9.0.0');
  });
});
