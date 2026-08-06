import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AddonsRepository } from '../repositories/addons.repository';
import { AddonService } from '../services/addon.service';
import { MeterService } from '../services/meter.service';
import { BillingIntervalType } from '../entities/service-plan.entity';

import { AddonsController } from './addons.controller';

describe('AddonsController', () => {
  const sampleRow = {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'default',
    key: 'av',
    name: 'Antivirus',
    description: 'AV agent',
    implementationType: 'cloud_init_script' as const,
    moduleKey: null,
    scriptTemplate: '#!/bin/bash\necho {{env.REGION}}',
    configSchema: {
      environmentVariables: [{ key: 'REGION', label: 'Region', showInOrderForm: true, hasDefault: false }],
    },
    configDefaultValues: { REGION: 'eu' },
    compatibleProviders: ['hetzner'],
    basePrice: '5',
    priceIntervalType: BillingIntervalType.MONTH,
    priceIntervalValue: 1,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const createModule = async (repository: Record<string, jest.Mock>, addonService: Record<string, jest.Mock>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AddonsController],
      providers: [
        { provide: AddonsRepository, useValue: repository },
        { provide: AddonService, useValue: addonService },
        {
          provide: MeterService,
          useValue: {
            listAddonMeters: jest.fn().mockResolvedValue([]),
            attachAddonMeter: jest.fn(),
            updateAddonMeter: jest.fn(),
            detachAddonMeter: jest.fn(),
            syncAddonModuleMeters: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    return moduleRef.get(AddonsController);
  };

  describe('list', () => {
    it('maps rows without default values', async () => {
      const repository = { findAll: jest.fn().mockResolvedValue([sampleRow]) };
      const addonService = {};
      const controller = await createModule(repository, addonService);
      const result = await controller.list();

      expect(result[0].defaultValues).toBeUndefined();
      expect(result[0].key).toBe('av');
      expect(repository.findAll).toHaveBeenCalledWith(10, 0);
    });

    it('passes pagination to repository', async () => {
      const repository = { findAll: jest.fn().mockResolvedValue([]) };
      const controller = await createModule(repository, {});

      await controller.list(25, 50);

      expect(repository.findAll).toHaveBeenCalledWith(25, 50);
    });
  });

  describe('get', () => {
    it('includes decrypted defaults for admin detail', async () => {
      const repository = { findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow) };
      const controller = await createModule(repository, {});
      const result = await controller.get(sampleRow.id);

      expect(result.defaultValues).toEqual({ REGION: 'eu' });
    });
  });

  describe('create', () => {
    it('validates, resolves config, and persists addon', async () => {
      const repository = { create: jest.fn().mockResolvedValue(sampleRow) };
      const addonService = {
        validateCreatePayload: jest.fn(),
        resolveConfigForWrite: jest.fn().mockReturnValue({
          configSchema: sampleRow.configSchema,
          configDefaultValues: sampleRow.configDefaultValues,
        }),
      };
      const controller = await createModule(repository, addonService);

      const result = await controller.create({
        key: 'av',
        name: 'Antivirus',
        implementationType: 'cloud_init_script',
        scriptTemplate: '#!/bin/bash\necho {{env.REGION}}',
        configSchema: sampleRow.configSchema,
        defaultValues: { REGION: 'eu' },
        compatibleProviders: ['hetzner'],
        basePrice: '5',
        priceIntervalType: BillingIntervalType.MONTH,
        priceIntervalValue: 1,
      } as never);

      expect(addonService.validateCreatePayload).toHaveBeenCalled();
      expect(addonService.resolveConfigForWrite).toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'av',
          implementationType: 'cloud_init_script',
          moduleKey: null,
          isActive: true,
        }),
      );
      expect(result.defaultValues).toEqual({ REGION: 'eu' });
    });

    it('persists the deprovision script template for script addons', async () => {
      const repository = { create: jest.fn().mockResolvedValue(sampleRow) };
      const addonService = {
        validateCreatePayload: jest.fn(),
        resolveConfigForWrite: jest.fn().mockReturnValue({
          configSchema: sampleRow.configSchema,
          configDefaultValues: {},
        }),
      };
      const controller = await createModule(repository, addonService);

      await controller.create({
        key: 'av',
        name: 'Antivirus',
        implementationType: 'cloud_init_script',
        scriptTemplate: '#!/bin/bash\necho {{env.REGION}}',
        deprovisionScriptTemplate: '#!/bin/bash\nremove {{env.REGION}}',
      } as never);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ deprovisionScriptTemplate: '#!/bin/bash\nremove {{env.REGION}}' }),
      );
    });

    it('rejects deprovision script templates that cannot interpolate', async () => {
      const repository = { create: jest.fn() };
      const addonService = {
        validateCreatePayload: jest.fn(),
        resolveConfigForWrite: jest.fn().mockReturnValue({
          configSchema: { environmentVariables: [{ key: 'REGION', label: 'Region', showInOrderForm: true }] },
          configDefaultValues: {},
        }),
      };
      const controller = await createModule(repository, addonService);

      await expect(
        controller.create({
          key: 'av',
          name: 'Antivirus',
          implementationType: 'cloud_init_script',
          scriptTemplate: '#!/bin/bash\necho {{env.REGION}}',
          deprovisionScriptTemplate: '#!/bin/bash\nremove {{env.MISSING}}',
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects invalid script templates that cannot interpolate', async () => {
      const repository = { create: jest.fn() };
      const addonService = {
        validateCreatePayload: jest.fn(),
        resolveConfigForWrite: jest.fn().mockReturnValue({
          configSchema: { environmentVariables: [{ key: 'REGION', label: 'Region', showInOrderForm: true }] },
          configDefaultValues: {},
        }),
      };
      const controller = await createModule(repository, addonService);

      await expect(
        controller.create({
          key: 'av',
          name: 'Antivirus',
          implementationType: 'cloud_init_script',
          scriptTemplate: '#!/bin/bash\necho {{env.MISSING}}',
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('merges fields and persists update', async () => {
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow),
        update: jest.fn().mockResolvedValue({ ...sampleRow, name: 'Renamed' }),
      };
      const addonService = {
        validateUpdatePayload: jest.fn().mockReturnValue({
          implementationType: 'cloud_init_script',
          moduleKey: null,
          scriptTemplate: sampleRow.scriptTemplate,
        }),
        resolveConfigForWrite: jest.fn(),
        assertNotReferencedByActivePlans: jest.fn(),
      };
      const controller = await createModule(repository, addonService);

      const result = await controller.update(sampleRow.id, { name: 'Renamed' } as never);

      expect(repository.update).toHaveBeenCalledWith(
        sampleRow.id,
        expect.objectContaining({ name: 'Renamed', implementationType: 'cloud_init_script' }),
      );
      expect(result.name).toBe('Renamed');
    });

    it('keeps the stored deprovision script when the payload omits it', async () => {
      const existing = { ...sampleRow, deprovisionScriptTemplate: '#!/bin/bash\nremove {{env.REGION}}' };
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(existing),
      };
      const addonService = {
        validateUpdatePayload: jest.fn().mockReturnValue({
          implementationType: 'cloud_init_script',
          moduleKey: null,
          scriptTemplate: sampleRow.scriptTemplate,
        }),
        resolveConfigForWrite: jest.fn(),
        assertNotReferencedByActivePlans: jest.fn(),
      };
      const controller = await createModule(repository, addonService);

      const result = await controller.update(sampleRow.id, { name: 'Renamed' } as never);

      expect(repository.update).toHaveBeenCalledWith(
        sampleRow.id,
        expect.objectContaining({ deprovisionScriptTemplate: '#!/bin/bash\nremove {{env.REGION}}' }),
      );
      expect(result.deprovisionScriptTemplate).toBe('#!/bin/bash\nremove {{env.REGION}}');
    });

    it('resolves config when schema or defaults change', async () => {
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow),
        update: jest.fn().mockResolvedValue(sampleRow),
      };
      const addonService = {
        validateUpdatePayload: jest.fn().mockReturnValue({
          implementationType: 'cloud_init_script',
          moduleKey: null,
          scriptTemplate: sampleRow.scriptTemplate,
        }),
        resolveConfigForWrite: jest.fn().mockReturnValue({
          configSchema: sampleRow.configSchema,
          configDefaultValues: { REGION: 'us' },
        }),
        assertNotReferencedByActivePlans: jest.fn(),
      };
      const controller = await createModule(repository, addonService);

      await controller.update(sampleRow.id, { defaultValues: { REGION: 'us' } } as never);

      expect(addonService.resolveConfigForWrite).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        sampleRow.id,
        expect.objectContaining({
          configDefaultValues: { REGION: 'us' },
        }),
      );
    });

    it('blocks deactivation when referenced by active plans', async () => {
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow),
        update: jest.fn(),
      };
      const addonService = {
        validateUpdatePayload: jest.fn().mockReturnValue({
          implementationType: 'cloud_init_script',
          moduleKey: null,
          scriptTemplate: sampleRow.scriptTemplate,
        }),
        assertNotReferencedByActivePlans: jest.fn().mockRejectedValue(new Error('referenced')),
      };
      const controller = await createModule(repository, addonService);

      await expect(controller.update(sampleRow.id, { isActive: false } as never)).rejects.toThrow('referenced');
      expect(addonService.assertNotReferencedByActivePlans).toHaveBeenCalledWith(sampleRow.id);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('allows deactivation when addon is already inactive', async () => {
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({ ...sampleRow, isActive: false }),
        update: jest.fn().mockResolvedValue({ ...sampleRow, isActive: false }),
      };
      const addonService = {
        validateUpdatePayload: jest.fn().mockReturnValue({
          implementationType: 'cloud_init_script',
          moduleKey: null,
          scriptTemplate: sampleRow.scriptTemplate,
        }),
        assertNotReferencedByActivePlans: jest.fn(),
      };
      const controller = await createModule(repository, addonService);

      await controller.update(sampleRow.id, { isActive: false } as never);

      expect(addonService.assertNotReferencedByActivePlans).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('asserts delete guards before delete', async () => {
      const repository = { delete: jest.fn().mockResolvedValue(undefined) };
      const addonService = {
        assertCanDelete: jest.fn().mockResolvedValue(undefined),
      };
      const controller = await createModule(repository, addonService);

      await controller.remove(sampleRow.id);

      expect(addonService.assertCanDelete).toHaveBeenCalledWith(sampleRow.id);
      expect(repository.delete).toHaveBeenCalledWith(sampleRow.id);
    });
  });
});
