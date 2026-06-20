import { Test } from '@nestjs/testing';
import { join } from 'node:path';

import { ProviderLoadTargetError } from './resolve-provider-load-target';
import { DynamicProviderLoaderService } from './dynamic-provider-loader.service';
import { DYNAMIC_PROVIDERS_FAIL_FAST_ENV } from './types';

const runtimeFixtureAppRoot = join(__dirname, '../test-fixtures/app-root-fixture');
const pluginFixtureRoot = join(__dirname, '../test-fixtures/plugin-root');

describe('DynamicProviderLoaderService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads plugin instances from baked-in runtime dependencies', async () => {
    process.env['DYNAMIC_TEST_PROVIDERS'] = '@forepath/test/runtime-provider-fixture';

    const moduleRef = await Test.createTestingModule({
      providers: [DynamicProviderLoaderService],
    }).compile();
    const loader = moduleRef.get(DynamicProviderLoaderService);

    const instances = await loader.loadInstances<{ getType(): string }>('DYNAMIC_TEST_PROVIDERS', 'optional', {
      appRoot: runtimeFixtureAppRoot,
    });

    expect(instances).toHaveLength(1);
    expect(instances[0]?.getType()).toBe('fixture-provider');
  });

  it('loads plugin instances from mounted plugin path fallback', async () => {
    process.env['DYNAMIC_TEST_PROVIDERS'] = '@forepath/test/mounted-plugin-fixture';

    const moduleRef = await Test.createTestingModule({
      providers: [DynamicProviderLoaderService],
    }).compile();
    const loader = moduleRef.get(DynamicProviderLoaderService);

    const instances = await loader.loadInstances<{ getType(): string }>('DYNAMIC_TEST_PROVIDERS', 'optional', {
      appRoot: runtimeFixtureAppRoot,
      pluginPath: pluginFixtureRoot,
    });

    expect(instances).toHaveLength(1);
    expect(instances[0]?.getType()).toBe('mounted-fixture-provider');
  });

  it('loads file: plugin entries from mounted plugin path', async () => {
    process.env['DYNAMIC_TEST_PROVIDERS'] = 'file:mounted-plugin-fixture';

    const moduleRef = await Test.createTestingModule({
      providers: [DynamicProviderLoaderService],
    }).compile();
    const loader = moduleRef.get(DynamicProviderLoaderService);

    const instances = await loader.loadInstances<{ getType(): string }>('DYNAMIC_TEST_PROVIDERS', 'optional', {
      appRoot: runtimeFixtureAppRoot,
      pluginPath: pluginFixtureRoot,
    });

    expect(instances).toHaveLength(1);
    expect(instances[0]?.getType()).toBe('mounted-fixture-provider');
  });

  it('skips unresolved optional entries permissively', async () => {
    process.env['DYNAMIC_TEST_PROVIDERS'] = '@forepath/missing/package';

    const moduleRef = await Test.createTestingModule({
      providers: [DynamicProviderLoaderService],
    }).compile();
    const loader = moduleRef.get(DynamicProviderLoaderService);

    const instances = await loader.loadInstances('DYNAMIC_TEST_PROVIDERS', 'optional', {
      appRoot: runtimeFixtureAppRoot,
      pluginPath: pluginFixtureRoot,
    });

    expect(instances).toEqual([]);
  });

  it('throws for critical entries when fail-fast is enabled', async () => {
    process.env['DYNAMIC_TEST_PROVIDERS'] = '@forepath/missing/package';
    process.env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV] = 'true';

    const moduleRef = await Test.createTestingModule({
      providers: [DynamicProviderLoaderService],
    }).compile();
    const loader = moduleRef.get(DynamicProviderLoaderService);

    await expect(
      loader.loadInstances('DYNAMIC_TEST_PROVIDERS', 'critical', {
        appRoot: runtimeFixtureAppRoot,
        pluginPath: pluginFixtureRoot,
      }),
    ).rejects.toBeInstanceOf(ProviderLoadTargetError);
  });

  it('loads providerMetadata exports', async () => {
    process.env['DYNAMIC_TEST_METADATA'] = '@forepath/test/runtime-provider-fixture';

    const moduleRef = await Test.createTestingModule({
      providers: [DynamicProviderLoaderService],
    }).compile();
    const loader = moduleRef.get(DynamicProviderLoaderService);

    const metadata = await loader.loadMetadata('DYNAMIC_TEST_METADATA', 'optional', {
      appRoot: runtimeFixtureAppRoot,
    });

    expect(metadata).toEqual([{ id: 'fixture-provider', displayName: 'Fixture Provider' }]);
  });
});
