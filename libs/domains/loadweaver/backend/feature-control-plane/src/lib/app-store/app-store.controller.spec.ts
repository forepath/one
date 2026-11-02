import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

import { ZodValidationPipe } from '../utils/zod-validation.pipe';
import {
  AppStoreController,
  installPlanBodySchema,
  refreshBodySchema,
  uninstallPlanBodySchema,
  updatePlanBodySchema,
} from './app-store.controller';

describe('AppStoreController (P1)', () => {
  const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);

  it('validates the plan bodies (unknown keys, names, versions, data policy required)', () => {
    expect(
      pipe(installPlanBodySchema).transform({ project: 'shop', parameters: { port: 8080, debug: false } }),
    ).toEqual({ project: 'shop', parameters: { port: 8080, debug: false } });
    expect(() => pipe(installPlanBodySchema).transform({ project: 'Shop' })).toThrow(BadRequestException);
    expect(() => pipe(installPlanBodySchema).transform({ project: 'shop', extra: 1 })).toThrow(BadRequestException);
    expect(() => pipe(installPlanBodySchema).transform({ project: 'shop', parameters: { a: { nested: 1 } } })).toThrow(
      BadRequestException,
    );
    expect(() => pipe(installPlanBodySchema).transform({ project: 'shop', suggestions: ['bogus'] })).toThrow(
      BadRequestException,
    );
    expect(pipe(updatePlanBodySchema).transform({ version: '1.2.0', backup: 'skip' })).toEqual({
      version: '1.2.0',
      backup: 'skip',
    });
    expect(() => pipe(updatePlanBodySchema).transform({ version: 'latest' })).toThrow(BadRequestException);
    expect(() => pipe(uninstallPlanBodySchema).transform({})).toThrow(BadRequestException);
    expect(pipe(uninstallPlanBodySchema).transform({ dataPolicy: 'delete', confirm: 'wiki' })).toEqual({
      dataPolicy: 'delete',
      confirm: 'wiki',
    });
    expect(pipe(refreshBodySchema).transform({})).toEqual({});
  });

  it('delegates to the services', async () => {
    const catalogs = {
      catalogs: jest.fn(async () => ({ catalogs: [], allowedTrust: [] })),
      apps: jest.fn(async () => ({ apps: [] })),
      app: jest.fn(async () => ({})),
      refresh: jest.fn(async () => ({ catalogs: [] })),
    };
    const plans = {
      installedApps: jest.fn(async () => ({ apps: [] })),
      installPlan: jest.fn(async () => ({})),
      updatePlan: jest.fn(async () => ({})),
      uninstallPlan: jest.fn(async () => ({})),
    };
    const controller = new AppStoreController(catalogs as never, plans as never);

    await controller.listApps('wiki', 'official', 'verified');
    await controller.app('official', 'wiki', '1.2.0');
    await controller.refresh({ catalog: 'official' });
    await controller.installed('shop');
    await controller.installPlan('official', 'wiki', '1.2.0', { project: 'shop' });
    await controller.updatePlan('shop', 'wiki', { version: '1.3.0' });
    await controller.uninstallPlan('shop', 'wiki', { dataPolicy: 'keep' });

    expect(catalogs.apps).toHaveBeenCalledWith(undefined, { q: 'wiki', catalog: 'official', trust: 'verified' });
    expect(catalogs.app).toHaveBeenCalledWith(undefined, 'official', 'wiki', '1.2.0');
    expect(catalogs.refresh).toHaveBeenCalledWith(undefined, 'official');
    expect(plans.installedApps).toHaveBeenCalledWith(undefined, 'shop');
    expect(plans.installPlan).toHaveBeenCalledWith(undefined, 'official', 'wiki', '1.2.0', { project: 'shop' });
    expect(plans.updatePlan).toHaveBeenCalledWith(undefined, 'shop', 'wiki', { version: '1.3.0' });
    expect(plans.uninstallPlan).toHaveBeenCalledWith(undefined, 'shop', 'wiki', { dataPolicy: 'keep' });
  });
});
