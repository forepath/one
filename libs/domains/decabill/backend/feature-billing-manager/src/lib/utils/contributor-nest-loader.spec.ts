import { Module } from '@nestjs/common';

import { loadContributorNestModulesFromEnv } from './contributor-nest-loader';

@Module({})
class NestOnlyModule {}

describe('loadContributorNestModulesFromEnv', () => {
  it('loads a package that only exports nestModule', async () => {
    const loadModule = jest.fn().mockResolvedValue({
      nestModule: NestOnlyModule,
      contributorKey: 'acme-ops',
    });
    const modules = await loadContributorNestModulesFromEnv({
      env: { DYNAMIC_ADDON_MODULES: 'acme-ops=@forepath/decabill/backend/addon-acme' } as NodeJS.ProcessEnv,
      loadModule,
    });

    expect(modules).toEqual([{ source: 'addon', sourceKey: 'acme-ops', nestModule: NestOnlyModule }]);
    expect(loadModule).toHaveBeenCalledTimes(1);
  });

  it('skips a package that only exports createProvider', async () => {
    const loadModule = jest.fn().mockResolvedValue({
      createProvider: () => ({ key: 'acme-ops' }),
    });
    const modules = await loadContributorNestModulesFromEnv({
      env: { DYNAMIC_ADDON_MODULES: 'acme-ops=@forepath/decabill/backend/addon-acme' } as NodeJS.ProcessEnv,
      loadModule,
    });

    expect(modules).toEqual([]);
  });

  it('skips optional package load failures', async () => {
    const loadModule = jest.fn().mockRejectedValue(new Error('missing package'));
    const logger = { warn: jest.fn() };
    const modules = await loadContributorNestModulesFromEnv({
      env: { DYNAMIC_ADDON_MODULES: '@forepath/decabill/backend/addon-missing' } as NodeJS.ProcessEnv,
      loadModule,
      logger: logger as never,
    });

    expect(modules).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('fails closed on invalid nestModule after a successful load', async () => {
    const loadModule = jest.fn().mockResolvedValue({ nestModule: 'nope', contributorKey: 'acme-ops' });

    await expect(
      loadContributorNestModulesFromEnv({
        env: { DYNAMIC_ADDON_MODULES: 'acme-ops=@forepath/decabill/backend/addon-acme' } as NodeJS.ProcessEnv,
        loadModule,
      }),
    ).rejects.toThrow('Invalid nestModule export');
  });

  it('requires contributorKey or env alias when nestModule is present', async () => {
    const loadModule = jest.fn().mockResolvedValue({ nestModule: NestOnlyModule });

    await expect(
      loadContributorNestModulesFromEnv({
        env: { DYNAMIC_ADDON_MODULES: '@forepath/decabill/backend/addon-acme' } as NodeJS.ProcessEnv,
        loadModule,
      }),
    ).rejects.toThrow('contributorKey export or env alias is required when nestModule is present');
  });
});
