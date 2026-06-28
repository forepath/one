import { BadRequestException, NotFoundException } from '@nestjs/common';

import { CloudInitConfigEntity } from '../entities/cloud-init-config.entity';
import { CloudInitConfigService } from './cloud-init-config.service';

describe('CloudInitConfigService', () => {
  const cloudInitConfigsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const servicePlansRepository = {
    findAll: jest.fn().mockResolvedValue([]),
    findByIdOrThrow: jest.fn(),
  };
  const serviceTypesRepository = {
    findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'st-1', provider: 'hetzner' }),
  };
  const service = new CloudInitConfigService(
    cloudInitConfigsRepository as any,
    servicePlansRepository as any,
    serviceTypesRepository as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'hetzner' });
    servicePlansRepository.findAll.mockResolvedValue([]);
  });

  describe('sanitizeEnvironmentVariables', () => {
    it('trims keys and syncs hasDefault flags', () => {
      const result = service.sanitizeEnvironmentVariables(
        [{ key: ' API_KEY ', label: ' API Key ', showInOrderForm: true, hasDefault: false }],
        { API_KEY: 'secret' },
      );

      expect(result.environmentVariables).toEqual([
        {
          key: 'API_KEY',
          label: 'API Key',
          showInOrderForm: true,
          hasDefault: true,
        },
      ]);
      expect(result.envDefaultValues).toEqual({ API_KEY: 'secret' });
    });

    it('rejects invalid env key format', () => {
      expect(() =>
        service.sanitizeEnvironmentVariables(
          [{ key: 'bad-key', label: 'Bad', showInOrderForm: false, hasDefault: false }],
          {},
        ),
      ).toThrow(BadRequestException);
    });

    it('skips empty keys and rejects duplicate keys', () => {
      const result = service.sanitizeEnvironmentVariables(
        [
          { key: '', label: 'Empty', showInOrderForm: false, hasDefault: false },
          { key: 'API_KEY', label: 'Key', showInOrderForm: true, hasDefault: false },
        ],
        {},
      );

      expect(result.environmentVariables).toHaveLength(1);

      expect(() =>
        service.sanitizeEnvironmentVariables(
          [
            { key: 'API_KEY', label: 'One', showInOrderForm: false, hasDefault: false },
            { key: 'API_KEY', label: 'Two', showInOrderForm: false, hasDefault: false },
          ],
          {},
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects default values for undeclared keys', () => {
      expect(() =>
        service.sanitizeEnvironmentVariables(
          [{ key: 'API_KEY', label: 'Key', showInOrderForm: true, hasDefault: false }],
          { UNKNOWN: 'value' },
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('resolveEnvironmentVariables', () => {
    const config = {
      environmentVariables: [
        { key: 'API_KEY', label: 'Key', showInOrderForm: true, hasDefault: true },
        { key: 'REGION', label: 'Region', showInOrderForm: true, hasDefault: false },
      ],
      envDefaultValues: { API_KEY: 'default-key' },
    } as unknown as CloudInitConfigEntity;

    it('merges customer overrides over defaults', () => {
      const resolved = service.resolveEnvironmentVariables(config, {
        API_KEY: 'customer-key',
        REGION: 'eu',
      });

      expect(resolved).toEqual({ API_KEY: 'customer-key', REGION: 'eu' });
    });

    it('throws when required variable is missing', () => {
      expect(() => service.resolveEnvironmentVariables(config, { API_KEY: 'only-key' })).toThrow(BadRequestException);
    });

    it('rejects undeclared customer env keys', () => {
      expect(() =>
        service.resolveEnvironmentVariables(config, {
          API_KEY: 'customer-key',
          REGION: 'eu',
          EXTRA: 'injected',
        }),
      ).toThrow(BadRequestException);
    });

    it('ignores null customer overrides and keeps defaults', () => {
      const resolved = service.resolveEnvironmentVariables(config, {
        API_KEY: null,
        REGION: 'eu',
      });

      expect(resolved).toEqual({ API_KEY: 'default-key', REGION: 'eu' });
    });

    it('generates random defaults when configured', () => {
      const randomConfig = {
        environmentVariables: [
          {
            key: 'API_KEY',
            label: 'Key',
            showInOrderForm: false,
            hasDefault: true,
            useRandomDefault: true,
            randomDefaultLength: 24,
            randomDefaultSpecialChars: true,
          },
        ],
        envDefaultValues: {},
      } as unknown as CloudInitConfigEntity;

      const resolved = service.resolveEnvironmentVariables(randomConfig, {});

      expect(resolved.API_KEY).toHaveLength(24);
      expect(/[a-z]/.test(resolved.API_KEY)).toBe(true);
      expect(/[A-Z]/.test(resolved.API_KEY)).toBe(true);
      expect(/[0-9]/.test(resolved.API_KEY)).toBe(true);
    });
  });

  describe('findByIdForProvisioning', () => {
    it('rejects inactive configs', async () => {
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue({ id: 'cfg-1', isActive: false });

      await expect(service.findByIdForProvisioning('cfg-1')).rejects.toThrow(BadRequestException);
    });

    it('returns active configs', async () => {
      const row = { id: 'cfg-1', isActive: true };
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue(row);

      await expect(service.findByIdForProvisioning('cfg-1')).resolves.toBe(row);
    });
  });

  describe('getOrderFields', () => {
    it('returns only showInOrderForm variables without exposing default values', () => {
      const fields = service.getOrderFields({
        environmentVariables: [
          { key: 'A', label: 'A', showInOrderForm: true, hasDefault: true },
          { key: 'B', label: 'B', showInOrderForm: false, hasDefault: false },
          { key: 'C', label: 'C', showInOrderForm: true, hasDefault: false },
        ],
        envDefaultValues: { A: 'secret-from-admin' },
      } as unknown as CloudInitConfigEntity);

      expect(fields).toEqual([
        { key: 'A', label: 'A', description: null, required: false, hasDefault: true },
        { key: 'C', label: 'C', description: null, required: true, hasDefault: false },
      ]);
    });
  });

  describe('getOrderFieldsForPlan', () => {
    it('returns order fields when config is on the plan', async () => {
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        providerConfigDefaults: {
          provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-1' }],
        },
      });
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'cfg-1',
        isActive: true,
        environmentVariables: [{ key: 'API_KEY', label: 'Key', showInOrderForm: true, hasDefault: false }],
      });

      const fields = await service.getOrderFieldsForPlan('plan-1', 'cfg-1');

      expect(fields).toEqual([{ key: 'API_KEY', label: 'Key', description: null, required: true, hasDefault: false }]);
    });

    it('returns 404 when config is not on the plan', async () => {
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        providerConfigDefaults: {
          provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-other' }],
        },
      });

      await expect(service.getOrderFieldsForPlan('plan-1', 'cfg-1')).rejects.toThrow(NotFoundException);
      expect(cloudInitConfigsRepository.findByIdOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('assertNotReferencedByActivePlans', () => {
    it('paginates through service plans when checking references', async () => {
      servicePlansRepository.findAll
        .mockResolvedValueOnce(
          Array.from({ length: 100 }, (_, index) => ({
            id: `plan-${index}`,
            isActive: false,
            providerConfigDefaults: {},
          })),
        )
        .mockResolvedValueOnce([
          {
            id: 'plan-ref',
            isActive: true,
            providerConfigDefaults: {
              provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-1' }],
            },
          },
        ]);

      await expect(service.assertNotReferencedByActivePlans('cfg-1')).rejects.toThrow(BadRequestException);
      expect(servicePlansRepository.findAll).toHaveBeenNthCalledWith(1, 100, 0);
      expect(servicePlansRepository.findAll).toHaveBeenNthCalledWith(2, 100, 100);
    });

    it('detects legacy cloudInitConfigId references', async () => {
      servicePlansRepository.findAll.mockResolvedValueOnce([
        {
          id: 'plan-legacy',
          isActive: true,
          providerConfigDefaults: { cloudInitConfigId: 'cfg-1', service: 'custom' },
        },
      ]);

      await expect(service.assertNotReferencedByActivePlans('cfg-1')).rejects.toThrow(BadRequestException);
    });

    it('detects legacy cloudInitConfigIds array references', async () => {
      servicePlansRepository.findAll.mockResolvedValueOnce([
        {
          id: 'plan-legacy',
          isActive: true,
          providerConfigDefaults: { cloudInitConfigIds: ['cfg-2'] },
        },
      ]);

      await expect(service.assertNotReferencedByActivePlans('cfg-2')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateProvisioningPayload', () => {
    it('rejects invalid workDir values', () => {
      expect(() =>
        service.validateProvisioningPayload({
          provisioningMode: 'simple',
          dockerImage: 'nginx:alpine',
          workDir: '/tmp/evil',
          environmentVariables: [],
        }),
      ).toThrow(BadRequestException);
    });

    it('requires docker image for simple mode', () => {
      expect(() =>
        service.validateProvisioningPayload({
          provisioningMode: 'simple',
          dockerImage: '',
          environmentVariables: [],
        }),
      ).toThrow(BadRequestException);
    });

    it('requires compose template for compose-template mode', () => {
      expect(() =>
        service.validateProvisioningPayload({
          provisioningMode: 'compose-template',
          dockerComposeTemplate: '',
          environmentVariables: [],
        }),
      ).toThrow(BadRequestException);
    });

    it('validates compose template placeholders', () => {
      expect(() =>
        service.validateProvisioningPayload({
          provisioningMode: 'compose-template',
          dockerComposeTemplate: 'image: {{UNKNOWN}}',
          environmentVariables: [],
        }),
      ).toThrow(BadRequestException);
    });

    it('wraps compose template interpolation errors', () => {
      expect(() =>
        service.validateProvisioningPayload({
          provisioningMode: 'compose-template',
          dockerComposeTemplate: 'image: {{API_KEY}}',
          environmentVariables: [],
        }),
      ).toThrow(BadRequestException);
    });

    it('requires user data template for user-data-template mode', () => {
      expect(() =>
        service.validateProvisioningPayload({
          provisioningMode: 'user-data-template',
          userDataTemplate: '',
          environmentVariables: [],
        }),
      ).toThrow(BadRequestException);
    });

    it('accepts valid user-data template', () => {
      expect(() =>
        service.validateProvisioningPayload({
          provisioningMode: 'user-data-template',
          userDataTemplate: '#!/bin/bash\necho {{HOSTNAME}}',
          environmentVariables: [],
        }),
      ).not.toThrow();
    });
  });

  describe('assertActiveConfigForPlanDefaults', () => {
    it('requires provisioning options for provisionable service types', async () => {
      await expect(service.assertActiveConfigForPlanDefaults('st-1', {})).rejects.toThrow(BadRequestException);
    });

    it('allows empty provisioning options for non-provisionable service types', async () => {
      serviceTypesRepository.findByIdOrThrow.mockResolvedValue({ id: 'st-1', provider: 'manual' });

      await expect(service.assertActiveConfigForPlanDefaults('st-1', {})).resolves.toBeUndefined();
      expect(cloudInitConfigsRepository.findByIdOrThrow).not.toHaveBeenCalled();
    });

    it('validates each custom option in provisioningOptions', async () => {
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue({ id: 'cfg-1', isActive: true });

      await expect(
        service.assertActiveConfigForPlanDefaults('st-1', {
          provisioningOptions: [
            { type: 'integrated', service: 'controller' },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
          ],
        }),
      ).resolves.toBeUndefined();

      expect(cloudInitConfigsRepository.findByIdOrThrow).toHaveBeenCalledWith('cfg-1');
    });

    it('loads config in current tenant and rejects inactive templates', async () => {
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue({ id: 'cfg-1', isActive: false });

      await expect(
        service.assertActiveConfigForPlanDefaults('st-1', {
          provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-1' }],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(cloudInitConfigsRepository.findByIdOrThrow).toHaveBeenCalledWith('cfg-1');
    });

    it('accepts active config in current tenant', async () => {
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue({ id: 'cfg-1', isActive: true });

      await expect(
        service.assertActiveConfigForPlanDefaults('st-1', {
          provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-1' }],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('buildOrderProvisioningOptions', () => {
    it('returns integrated and custom labels', async () => {
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'cfg-1',
        name: 'WordPress',
        description: 'Blog stack',
        isActive: true,
      });

      const options = await service.buildOrderProvisioningOptions({
        provisioningOptions: [
          { type: 'integrated', service: 'manager' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(options).toEqual([
        expect.objectContaining({ optionKey: 'integrated:manager', type: 'integrated', label: 'Agenstra Manager' }),
        expect.objectContaining({
          optionKey: 'custom:cfg-1',
          type: 'custom',
          cloudInitConfigId: 'cfg-1',
          label: 'WordPress',
          description: 'Blog stack',
        }),
      ]);
    });

    it('falls back to legacy service defaults', async () => {
      const options = await service.buildOrderProvisioningOptions({ service: 'manager', region: 'fsn1' });

      expect(options).toEqual([
        expect.objectContaining({ optionKey: 'integrated:manager', type: 'integrated', label: 'Agenstra Manager' }),
      ]);
    });

    it('rejects plans whose configured options are all inactive', async () => {
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'cfg-1',
        name: 'WordPress',
        isActive: false,
      });

      await expect(
        service.buildOrderProvisioningOptions({
          provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('omits inactive custom options when other options remain active', async () => {
      cloudInitConfigsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'cfg-inactive',
        name: 'Inactive',
        isActive: false,
      });

      await expect(
        service.buildOrderProvisioningOptions({
          provisioningOptions: [
            { type: 'integrated', service: 'controller' },
            { type: 'custom', cloudInitConfigId: 'cfg-inactive' },
            { type: 'custom', cloudInitConfigId: 'cfg-active' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
