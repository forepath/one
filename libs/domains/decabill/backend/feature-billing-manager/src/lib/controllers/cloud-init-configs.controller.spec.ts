import { Test } from '@nestjs/testing';

import { CloudInitConfigsRepository } from '../repositories/cloud-init-configs.repository';
import { CloudInitConfigService } from '../services/cloud-init-config.service';

import { CloudInitConfigsController } from './cloud-init-configs.controller';

describe('CloudInitConfigsController', () => {
  const sampleRow = {
    id: 'cfg-1',
    tenantId: 'default',
    key: 'my-app',
    name: 'My App',
    description: 'Test',
    provisioningMode: 'simple',
    dockerImage: 'nginx:alpine',
    containerPort: 8080,
    hostPort: 80,
    workDir: '/opt/custom-app',
    environmentVariables: [{ key: 'API_KEY', label: 'API Key', showInOrderForm: true, hasDefault: true }],
    envDefaultValues: { API_KEY: 'secret' },
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const createModule = async (repository: Record<string, jest.Mock>, configService: Record<string, jest.Mock>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CloudInitConfigsController],
      providers: [
        { provide: CloudInitConfigsRepository, useValue: repository },
        { provide: CloudInitConfigService, useValue: configService },
      ],
    }).compile();

    return moduleRef.get(CloudInitConfigsController);
  };

  describe('list', () => {
    it('masks default values in list responses', async () => {
      const repository = { findAll: jest.fn().mockResolvedValue([sampleRow]) };
      const configService = { sanitizeEnvironmentVariables: jest.fn(), getOrderFields: jest.fn() };
      const controller = await createModule(repository, configService);
      const result = await controller.list();

      expect(result[0].defaultValues).toBeUndefined();
      expect(result[0].environmentVariables[0].hasDefault).toBe(true);
    });

    it('passes pagination to repository', async () => {
      const repository = { findAll: jest.fn().mockResolvedValue([]) };
      const configService = { sanitizeEnvironmentVariables: jest.fn(), getOrderFields: jest.fn() };
      const controller = await createModule(repository, configService);

      await controller.list(25, 50);

      expect(repository.findAll).toHaveBeenCalledWith(25, 50);
    });
  });

  describe('get', () => {
    it('includes decrypted defaults for admin detail', async () => {
      const repository = { findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow) };
      const configService = { sanitizeEnvironmentVariables: jest.fn(), getOrderFields: jest.fn() };
      const controller = await createModule(repository, configService);
      const result = await controller.get('cfg-1');

      expect(result.defaultValues).toEqual({ API_KEY: 'secret' });
    });
  });

  describe('create', () => {
    it('sanitizes env vars, validates payload, and persists config', async () => {
      const repository = {
        create: jest.fn().mockResolvedValue(sampleRow),
      };
      const configService = {
        sanitizeEnvironmentVariables: jest.fn().mockReturnValue({
          environmentVariables: sampleRow.environmentVariables,
          envDefaultValues: sampleRow.envDefaultValues,
        }),
        validateProvisioningPayload: jest.fn(),
        getOrderFields: jest.fn(),
      };
      const controller = await createModule(repository, configService);

      const result = await controller.create({
        key: 'my-app',
        name: 'My App',
        dockerImage: 'nginx:alpine',
        environmentVariables: [{ key: 'API_KEY', label: 'API Key', showInOrderForm: true }],
        defaultValues: { API_KEY: 'secret' },
      } as any);

      expect(configService.sanitizeEnvironmentVariables).toHaveBeenCalled();
      expect(configService.validateProvisioningPayload).toHaveBeenCalledWith(
        expect.objectContaining({ provisioningMode: 'simple', dockerImage: 'nginx:alpine' }),
      );
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'my-app',
          name: 'My App',
          provisioningMode: 'simple',
          isActive: true,
        }),
      );
      expect(result.defaultValues).toEqual({ API_KEY: 'secret' });
    });
  });

  describe('update', () => {
    it('merges env defaults and validates merged payload', async () => {
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow),
        update: jest.fn().mockResolvedValue({ ...sampleRow, name: 'Renamed' }),
      };
      const configService = {
        sanitizeEnvironmentVariables: jest.fn().mockReturnValue({
          environmentVariables: sampleRow.environmentVariables,
          envDefaultValues: sampleRow.envDefaultValues,
        }),
        validateProvisioningPayload: jest.fn(),
        getOrderFields: jest.fn(),
        assertNotReferencedByActivePlans: jest.fn().mockResolvedValue(undefined),
      };
      const controller = await createModule(repository, configService);

      const result = await controller.update('cfg-1', { name: 'Renamed' } as any);

      expect(repository.update).toHaveBeenCalledWith('cfg-1', { name: 'Renamed' });
      expect(configService.validateProvisioningPayload).toHaveBeenCalled();
      expect(result.name).toBe('Renamed');
    });

    it('updates environment variables when defaults change', async () => {
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow),
        update: jest.fn().mockResolvedValue(sampleRow),
      };
      const configService = {
        sanitizeEnvironmentVariables: jest.fn().mockReturnValue({
          environmentVariables: [{ key: 'API_KEY', label: 'API Key', showInOrderForm: true, hasDefault: true }],
          envDefaultValues: { API_KEY: 'new-secret' },
        }),
        validateProvisioningPayload: jest.fn(),
        getOrderFields: jest.fn(),
        assertNotReferencedByActivePlans: jest.fn().mockResolvedValue(undefined),
      };
      const controller = await createModule(repository, configService);

      await controller.update('cfg-1', { defaultValues: { API_KEY: 'new-secret' } } as any);

      expect(configService.sanitizeEnvironmentVariables).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        'cfg-1',
        expect.objectContaining({
          envDefaultValues: { API_KEY: 'new-secret' },
        }),
      );
    });

    it('blocks deactivation when referenced by active plans', async () => {
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow),
        update: jest.fn(),
      };
      const configService = {
        sanitizeEnvironmentVariables: jest.fn(),
        validateProvisioningPayload: jest.fn(),
        getOrderFields: jest.fn(),
        assertNotReferencedByActivePlans: jest.fn().mockRejectedValue(new Error('referenced')),
      };
      const controller = await createModule(repository, configService);

      await expect(controller.update('cfg-1', { isActive: false } as any)).rejects.toThrow('referenced');
      expect(configService.assertNotReferencedByActivePlans).toHaveBeenCalledWith('cfg-1');
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('allows deactivation when config is already inactive', async () => {
      const repository = {
        findByIdOrThrow: jest.fn().mockResolvedValue({ ...sampleRow, isActive: false }),
        update: jest.fn().mockResolvedValue({ ...sampleRow, isActive: false }),
      };
      const configService = {
        sanitizeEnvironmentVariables: jest.fn(),
        validateProvisioningPayload: jest.fn(),
        getOrderFields: jest.fn(),
        assertNotReferencedByActivePlans: jest.fn(),
      };
      const controller = await createModule(repository, configService);

      await controller.update('cfg-1', { isActive: false } as any);

      expect(configService.assertNotReferencedByActivePlans).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith('cfg-1', { isActive: false });
    });
  });

  describe('remove', () => {
    it('asserts plan references before delete', async () => {
      const repository = { delete: jest.fn().mockResolvedValue(undefined) };
      const configService = {
        assertNotReferencedByActivePlans: jest.fn().mockResolvedValue(undefined),
        getOrderFields: jest.fn(),
      };
      const controller = await createModule(repository, configService);

      await controller.remove('cfg-1');

      expect(configService.assertNotReferencedByActivePlans).toHaveBeenCalledWith('cfg-1');
      expect(repository.delete).toHaveBeenCalledWith('cfg-1');
    });
  });
});
