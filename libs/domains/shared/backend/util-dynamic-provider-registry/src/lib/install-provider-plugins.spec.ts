import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { DYNAMIC_PROVIDER_PLUGIN_INSTALL_ENV, DYNAMIC_PROVIDER_PLUGIN_PATH_ENV } from './types';
import { installProviderPluginsFromEnv } from './install-provider-plugins';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

describe('installProviderPluginsFromEnv', () => {
  const tempRoot = join(__dirname, '../test-fixtures/temp-install-root');
  const mountedFixture = join(__dirname, '../test-fixtures/mounted-plugin-fixture');
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true });
    const linkedMounted = join(tempRoot, 'mounted-plugin-fixture');

    if (existsSync(linkedMounted)) {
      rmSync(linkedMounted, { recursive: true, force: true });
    }

    cpSync(mountedFixture, linkedMounted, { recursive: true });

    process.env = { ...originalEnv };
    spawnMock.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;

    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('no-ops when plugin path is unset', async () => {
    delete process.env[DYNAMIC_PROVIDER_PLUGIN_PATH_ENV];

    await expect(installProviderPluginsFromEnv(process.env)).resolves.toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('creates plugin path without install spec', async () => {
    process.env[DYNAMIC_PROVIDER_PLUGIN_PATH_ENV] = tempRoot;
    delete process.env[DYNAMIC_PROVIDER_PLUGIN_INSTALL_ENV];

    await installProviderPluginsFromEnv(process.env);

    expect(existsSync(tempRoot)).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('runs npm install for registry and file targets', async () => {
    process.env[DYNAMIC_PROVIDER_PLUGIN_PATH_ENV] = tempRoot;
    process.env[DYNAMIC_PROVIDER_PLUGIN_INSTALL_ENV] =
      'file:mounted-plugin-fixture,@forepath/test/mounted-plugin-fixture@0.0.1';

    spawnMock.mockImplementation(() => {
      return {
        on: (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            callback(0);
          }
        },
      } as never;
    });

    await installProviderPluginsFromEnv(process.env);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['install', expect.stringMatching(/^file:/), '--prefix', tempRoot]),
    );
    expect(spawnMock.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(['install', '@forepath/test/mounted-plugin-fixture@0.0.1', '--prefix', tempRoot]),
    );
  });

  it('throws when npm install fails', async () => {
    process.env[DYNAMIC_PROVIDER_PLUGIN_PATH_ENV] = tempRoot;
    process.env[DYNAMIC_PROVIDER_PLUGIN_INSTALL_ENV] = '@forepath/broken@1.0.0';

    spawnMock.mockImplementation(() => {
      return {
        on: (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            callback(1);
          }
        },
      } as never;
    });

    await expect(installProviderPluginsFromEnv(process.env)).rejects.toThrow('npm install');
  });
});
