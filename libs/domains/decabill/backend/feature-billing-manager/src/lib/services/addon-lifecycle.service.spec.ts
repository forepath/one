import { BadRequestException } from '@nestjs/common';

import { AddonLifecycleService } from './addon-lifecycle.service';

describe('AddonLifecycleService', () => {
  const subscriptionAddonsRepository = {
    createMany: jest.fn(),
    findBySubscriptionId: jest.fn(),
    save: jest.fn(),
  };
  const addonModuleRegistry = {
    get: jest.fn(),
  };
  const billingNotificationPublisher = {
    publishAddon: jest.fn(),
  };
  const billingEmailPublisher = {
    publishAddonActivated: jest.fn(),
    publishAddonDeactivated: jest.fn(),
    publishAddonProvisionFailed: jest.fn(),
    publishAddonTeardownFailed: jest.fn(),
  };
  const addonsRepository = {
    findByIds: jest.fn(),
  };
  const provisioningService = {
    getServerInfo: jest.fn(),
  };
  const sshExecutor = {
    exec: jest.fn(),
    waitUntilReachable: jest.fn().mockResolvedValue(undefined),
  };

  const service = new AddonLifecycleService(
    subscriptionAddonsRepository as never,
    addonModuleRegistry as never,
    billingNotificationPublisher as never,
    billingEmailPublisher as never,
    addonsRepository as never,
    provisioningService as never,
    sshExecutor as never,
  );

  const scriptAddon = {
    id: 'a-1',
    key: 'script',
    name: 'Script',
    implementationType: 'cloud_init_script',
    scriptTemplate: 'install {{env.API_KEY}}',
    deprovisionScriptTemplate: 'remove {{env.API_KEY}}',
    configSchema: {
      environmentVariables: [{ key: 'API_KEY', label: 'Key', showInOrderForm: false, hasDefault: true }],
    },
    configDefaultValues: { API_KEY: 'secret' },
    basePrice: '0',
  };
  const provisionedItem = {
    id: 'item-1',
    providerReference: 'srv-1',
    hostname: 'host',
    sshPrivateKey: 'private-key',
    serverInfoSnapshot: { publicIp: '203.0.113.10' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sshExecutor.waitUntilReachable.mockResolvedValue(undefined);
    subscriptionAddonsRepository.save.mockImplementation(async (row: unknown) => row);
  });

  it('appends cloud-init scripts after primary user-data', () => {
    const result = service.appendScriptsToUserData('#!/bin/bash\necho base', ['echo addon']);

    expect(result).toContain('echo base');
    expect(result).toContain('Decabill addon script 1');
    expect(result).toContain('echo addon');
  });

  it('collects only cloud_init_script templates', () => {
    expect(
      service.collectCloudInitScripts([
        { implementationType: 'module', scriptTemplate: 'nope' } as never,
        { implementationType: 'cloud_init_script', scriptTemplate: '  #!/bin/bash\n  ' } as never,
      ]),
    ).toEqual(['#!/bin/bash']);
  });

  it('creates pending rows with resolved config snapshots', async () => {
    subscriptionAddonsRepository.createMany.mockImplementation(async (rows: unknown[]) => rows);

    await service.createPendingSubscriptionAddons({
      subscriptionId: 'sub-1',
      plan: { billingIntervalType: 'month', billingIntervalValue: 1 } as never,
      addonConfigs: { 'a-1': { REGION: 'eu' } },
      addons: [
        {
          id: 'a-1',
          name: 'Script',
          basePrice: '0',
          configSchema: {
            environmentVariables: [
              { key: 'API_KEY', label: 'Key', showInOrderForm: false, hasDefault: true },
              { key: 'REGION', label: 'Region', showInOrderForm: true, hasDefault: false },
            ],
          },
          configDefaultValues: { API_KEY: 'admin' },
        } as never,
      ],
    });

    expect(subscriptionAddonsRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        configSnapshot: { API_KEY: 'admin', REGION: 'eu' },
      }),
    ]);
  });

  it('never copies admin-only module secrets into config snapshots', async () => {
    subscriptionAddonsRepository.createMany.mockImplementation(async (rows: unknown[]) => rows);
    addonModuleRegistry.get.mockReturnValue({
      configFields: [
        { key: 'LOADWEAVER_API_URL', label: 'URL', showInOrderForm: false },
        { key: 'LOADWEAVER_API_TOKEN', label: 'Token', showInOrderForm: false, adminOnly: true },
      ],
    });

    const addon = {
      id: 'lw-1',
      name: 'Loadweaver usage',
      basePrice: '0',
      implementationType: 'module',
      moduleKey: 'loadweaver-usage',
      configSchema: {
        environmentVariables: [
          { key: 'LOADWEAVER_API_URL', label: 'URL', showInOrderForm: false, hasDefault: true },
          { key: 'LOADWEAVER_API_TOKEN', label: 'Token', showInOrderForm: false, hasDefault: true },
        ],
      },
      configDefaultValues: { LOADWEAVER_API_URL: 'https://lw.example.com/api', LOADWEAVER_API_TOKEN: 'lw_pat_secret' },
    };

    await service.createPendingSubscriptionAddons({
      subscriptionId: 'sub-1',
      plan: { billingIntervalType: 'month', billingIntervalValue: 1 } as never,
      addons: [addon as never],
    });

    expect(addonModuleRegistry.get).toHaveBeenCalledWith('loadweaver-usage');
    expect(subscriptionAddonsRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ configSnapshot: { LOADWEAVER_API_URL: 'https://lw.example.com/api' } }),
    ]);

    await expect(
      service.createPendingSubscriptionAddons({
        subscriptionId: 'sub-1',
        plan: { billingIntervalType: 'month', billingIntervalValue: 1 } as never,
        addonConfigs: { 'lw-1': { LOADWEAVER_API_TOKEN: 'customer-value' } },
        addons: [addon as never],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('interpolates addon scripts from config snapshots', () => {
    const scripts = service.collectInterpolatedCloudInitScripts([
      {
        configSnapshot: { API_KEY: 'secret' },
        addon: {
          implementationType: 'cloud_init_script',
          scriptTemplate: 'export K={{env.API_KEY}}',
          configSchema: {
            environmentVariables: [{ key: 'API_KEY', label: 'Key', showInOrderForm: false, hasDefault: true }],
          },
        },
      } as never,
    ]);

    expect(scripts[0]).toContain('secret');
  });

  it('never interpolates the Loadweaver admin claim token (secret snapshot key) into addon scripts', () => {
    const addon = (scriptTemplate: string) => ({
      implementationType: 'cloud_init_script',
      scriptTemplate,
      configSchema: {
        environmentVariables: [
          { key: 'API_KEY', label: 'Key', showInOrderForm: false, hasDefault: true },
          { key: 'loadweaverAdminClaimToken', label: 'Token', showInOrderForm: false, hasDefault: true },
        ],
      },
    });
    const snapshot = { API_KEY: 'k', loadweaverAdminClaimToken: 'lwc_secret-claim-token' };

    expect(
      service.collectInterpolatedCloudInitScripts([
        { configSnapshot: snapshot, addon: addon('export K={{env.API_KEY}}') } as never,
      ])[0],
    ).not.toContain('lwc_secret-claim-token');
    // A template that asks for it is refused instead of rendering the secret.
    expect(() =>
      service.collectInterpolatedCloudInitScripts([
        { configSnapshot: snapshot, addon: addon('export T={{env.loadweaverAdminClaimToken}}') } as never,
      ]),
    ).toThrow(/placeholder/);
  });

  it('marks addon active and notifies after successful module provision', async () => {
    const provision = jest.fn().mockResolvedValue(undefined);
    addonModuleRegistry.get.mockReturnValue({ key: 'av', displayName: 'AV', provision, teardown: jest.fn() });
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
      {
        id: 'sa-1',
        status: 'pending',
        addon: { id: 'a-1', key: 'av', name: 'AV', implementationType: 'module', moduleKey: 'av' },
      },
    ]);
    subscriptionAddonsRepository.save.mockImplementation(async (row: { status: string }) => row);

    await service.activateAfterProvisioning({
      subscription: { id: 'sub-1', userId: 'u-1' } as never,
      plan: { id: 'p-1', name: 'Pro', billInAdvance: false, billingIntervalType: 'month' } as never,
      item: { id: 'item-1', providerReference: 'srv-1', hostname: 'host' } as never,
      provider: 'hetzner',
    });

    expect(provision).toHaveBeenCalled();
    expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith('addon.activated', expect.any(Object));
    expect(billingEmailPublisher.publishAddonActivated).toHaveBeenCalled();
  });

  it('emits provision_failed when module provision throws', async () => {
    addonModuleRegistry.get.mockReturnValue({
      key: 'av',
      displayName: 'AV',
      provision: jest.fn().mockRejectedValue(new Error('boom')),
      teardown: jest.fn(),
    });
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
      {
        id: 'sa-1',
        status: 'pending',
        addon: { id: 'a-1', key: 'av', name: 'AV', implementationType: 'module', moduleKey: 'av' },
      },
    ]);
    subscriptionAddonsRepository.save.mockImplementation(async (row: { status: string }) => row);

    await service.activateAfterProvisioning({
      subscription: { id: 'sub-1', userId: 'u-1' } as never,
      plan: { id: 'p-1', name: 'Pro', billInAdvance: false, billingIntervalType: 'month' } as never,
      item: { id: 'item-1' } as never,
      provider: 'hetzner',
    });

    expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith(
      'addon.provision_failed',
      expect.objectContaining({ errorMessage: 'boom' }),
    );
  });

  it('returns empty when creating pending addons with no catalog rows', async () => {
    await expect(
      service.createPendingSubscriptionAddons({
        subscriptionId: 'sub-1',
        plan: { billingIntervalType: 'month', billingIntervalValue: 1 } as never,
        addons: [],
      }),
    ).resolves.toEqual([]);
    expect(subscriptionAddonsRepository.createMany).not.toHaveBeenCalled();
  });

  it('lists subscription addons via repository', async () => {
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([{ id: 'sa-1' }]);
    await expect(service.listForSubscription('sub-1')).resolves.toEqual([{ id: 'sa-1' }]);
  });

  it('leaves user-data unchanged when no scripts are appended', () => {
    expect(service.appendScriptsToUserData('#!/bin/bash\necho base', [])).toBe('#!/bin/bash\necho base');
  });

  it('appends addon scripts to base64-encoded stack user data without corrupting it', () => {
    for (const base of ['#!/bin/bash\necho base', '#!/bin/bash\necho base!']) {
      // Covers padded and unpadded base64.
      const encoded = Buffer.from(base).toString('base64');
      const result = service.appendScriptsToUserData(encoded, ['echo addon']);
      const decoded = Buffer.from(result, 'base64').toString('utf-8');

      expect(decoded.startsWith(base)).toBe(true);
      expect(decoded).toContain('# --- Decabill addon script 1 ---\necho addon');
      expect(Buffer.from(decoded).toString('base64')).toBe(result);
    }
  });

  it('skips activation when addon relation is missing', async () => {
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([{ id: 'sa-1', status: 'pending' }]);

    await service.activateAfterProvisioning({
      subscription: { id: 'sub-1' } as never,
      plan: { id: 'p-1', name: 'Pro' } as never,
      item: { id: 'item-1' } as never,
      provider: 'hetzner',
    });

    expect(subscriptionAddonsRepository.save).not.toHaveBeenCalled();
  });

  it('activates cloud_init_script addons without calling module registry', async () => {
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
      {
        id: 'sa-1',
        status: 'pending',
        addon: { id: 'a-1', key: 'script', name: 'Script', implementationType: 'cloud_init_script' },
      },
    ]);
    subscriptionAddonsRepository.save.mockImplementation(async (row: { status: string }) => row);

    await service.activateAfterProvisioning({
      subscription: { id: 'sub-1', userId: 'u-1' } as never,
      plan: { id: 'p-1', name: 'Pro', billInAdvance: false, billingIntervalType: 'month' } as never,
      item: { id: 'item-1' } as never,
      provider: 'hetzner',
    });

    expect(addonModuleRegistry.get).not.toHaveBeenCalled();
    expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith('addon.activated', expect.any(Object));
  });

  it('tears down module addons and notifies deactivation', async () => {
    const teardown = jest.fn().mockResolvedValue(undefined);
    addonModuleRegistry.get.mockReturnValue({ key: 'av', displayName: 'AV', provision: jest.fn(), teardown });
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
      {
        id: 'sa-1',
        status: 'active',
        addon: { id: 'a-1', key: 'av', name: 'AV', implementationType: 'module', moduleKey: 'av' },
      },
    ]);
    subscriptionAddonsRepository.save.mockImplementation(async (row: { status: string }) => row);

    await service.teardownForSubscription({
      subscription: { id: 'sub-1', userId: 'u-1' } as never,
      plan: { id: 'p-1', name: 'Pro' } as never,
      items: [{ id: 'item-1', providerReference: 'srv-1', hostname: 'host' } as never],
      providerByItemId: new Map([['item-1', 'hetzner']]),
    });

    expect(teardown).toHaveBeenCalled();
    expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith('addon.deactivated', expect.any(Object));
    expect(billingEmailPublisher.publishAddonDeactivated).toHaveBeenCalled();
  });

  it('emits teardown_failed when module teardown throws', async () => {
    addonModuleRegistry.get.mockReturnValue({
      key: 'av',
      displayName: 'AV',
      provision: jest.fn(),
      teardown: jest.fn().mockRejectedValue(new Error('teardown boom')),
    });
    subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
      {
        id: 'sa-1',
        status: 'active',
        addon: { id: 'a-1', key: 'av', name: 'AV', implementationType: 'module', moduleKey: 'av' },
      },
    ]);
    subscriptionAddonsRepository.save.mockImplementation(async (row: { status: string }) => row);

    await service.teardownForSubscription({
      subscription: { id: 'sub-1', userId: 'u-1' } as never,
      plan: { id: 'p-1', name: 'Pro' } as never,
      items: [{ id: 'item-1' } as never],
      providerByItemId: new Map([['item-1', 'hetzner']]),
    });

    expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith(
      'addon.teardown_failed',
      expect.objectContaining({ errorMessage: 'teardown boom' }),
    );
    expect(billingEmailPublisher.publishAddonTeardownFailed).toHaveBeenCalled();
  });

  it('stringifies non-string config snapshot values when interpolating scripts', () => {
    const scripts = service.collectInterpolatedCloudInitScripts([
      {
        configSnapshot: { PORT: 8080, FLAG: true, SKIP: null },
        addon: {
          implementationType: 'cloud_init_script',
          scriptTemplate: 'port={{env.PORT}} flag={{env.FLAG}}',
          configSchema: {
            environmentVariables: [
              { key: 'PORT', label: 'Port', showInOrderForm: true },
              { key: 'FLAG', label: 'Flag', showInOrderForm: true },
            ],
          },
        },
      } as never,
    ]);

    expect(scripts[0]).toContain('8080');
    expect(scripts[0]).toContain('true');
  });

  describe('provisionMidLife', () => {
    const request = {
      subscription: { id: 'sub-1', userId: 'u-1' },
      plan: { id: 'p-1', name: 'Pro', billingIntervalType: 'month', billingIntervalValue: 1 },
      item: provisionedItem,
      provider: 'hetzner',
      addonIds: ['a-1'],
    };

    beforeEach(() => {
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([]);
      addonsRepository.findByIds.mockResolvedValue([scriptAddon]);
      subscriptionAddonsRepository.createMany.mockImplementation(async (rows: Record<string, unknown>[]) =>
        rows.map((row, index) => ({ ...row, id: `sa-${index + 1}` })),
      );
    });

    it('runs the addon script over SSH and activates the row', async () => {
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      const activated = await service.provisionMidLife(request as never);

      expect(sshExecutor.exec).toHaveBeenCalledWith(
        '203.0.113.10',
        22,
        'root',
        'private-key',
        expect.stringContaining("install 'secret'"),
        { commandTimeoutMs: 120000 },
      );
      expect(activated).toHaveLength(1);
      expect(activated[0].status).toBe('active');
      expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith('addon.activated', expect.any(Object));
    });

    it('resolves the public IP from the provider when no snapshot is cached', async () => {
      provisioningService.getServerInfo.mockResolvedValue({ publicIp: '198.51.100.7' });
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      await service.provisionMidLife({
        ...request,
        item: { ...provisionedItem, serverInfoSnapshot: undefined },
      } as never);

      expect(provisioningService.getServerInfo).toHaveBeenCalledWith('hetzner', 'srv-1', expect.any(Object));
      expect(sshExecutor.exec).toHaveBeenCalledWith(
        '198.51.100.7',
        22,
        'root',
        'private-key',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('honors the configured SSH command timeout', async () => {
      process.env['BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS'] = '5000';
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      try {
        await service.provisionMidLife(request as never);
      } finally {
        delete process.env['BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS'];
      }

      expect(sshExecutor.exec).toHaveBeenCalledWith(expect.any(String), 22, 'root', 'private-key', expect.any(String), {
        commandTimeoutMs: 5000,
      });
    });

    it('skips addons that are already pending or active', async () => {
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
        { id: 'sa-1', addonId: 'a-1', status: 'active' },
      ]);

      await expect(service.provisionMidLife(request as never)).resolves.toEqual([]);
      expect(subscriptionAddonsRepository.createMany).not.toHaveBeenCalled();
      expect(sshExecutor.exec).not.toHaveBeenCalled();
    });

    it('fails the row with a generic message and aborts when the script exits non-zero', async () => {
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: 'secret leak', code: 3 });

      await expect(service.provisionMidLife(request as never)).rejects.toThrow('Addon provision failed');

      expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith(
        'addon.provision_failed',
        expect.objectContaining({
          errorMessage: 'Addon provision failed',
          subscriptionAddon: expect.objectContaining({ status: 'failed' }),
        }),
      );
      expect(billingEmailPublisher.publishAddonProvisionFailed).toHaveBeenCalled();
    });

    it('marks the remaining pending rows failed when the batch aborts', async () => {
      const secondAddon = { ...scriptAddon, id: 'a-2', key: 'script-2' };
      addonsRepository.findByIds.mockResolvedValue([scriptAddon, secondAddon]);
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: '', code: 1 });

      const savedRows: { addonId: string; status: string }[] = [];
      subscriptionAddonsRepository.save.mockImplementation(async (row: { addonId: string; status: string }) => {
        savedRows.push({ ...row });

        return row;
      });

      await expect(service.provisionMidLife({ ...request, addonIds: ['a-1', 'a-2'] } as never)).rejects.toThrow(
        'Addon provision failed',
      );

      expect(savedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ addonId: 'a-1', status: 'failed' }),
          expect.objectContaining({ addonId: 'a-2', status: 'failed' }),
        ]),
      );
      expect(sshExecutor.exec).toHaveBeenCalledTimes(1);
    });

    it('rejects unknown addon ids', async () => {
      addonsRepository.findByIds.mockResolvedValue([]);

      await expect(service.provisionMidLife(request as never)).rejects.toThrow(BadRequestException);
    });

    it('returns early when no addon ids are requested', async () => {
      await expect(service.provisionMidLife({ ...request, addonIds: [] } as never)).resolves.toEqual([]);
      expect(subscriptionAddonsRepository.findBySubscriptionId).not.toHaveBeenCalled();
    });
  });

  describe('deprovisionMidLife', () => {
    const request = {
      subscription: { id: 'sub-1', userId: 'u-1' },
      plan: { id: 'p-1', name: 'Pro' },
      item: provisionedItem,
      provider: 'hetzner',
      subscriptionAddonIds: ['sa-1'],
    };

    it('runs the deprovision script, deactivates the row and clears the config snapshot', async () => {
      const row = {
        id: 'sa-1',
        addonId: 'a-1',
        status: 'active',
        configSnapshot: { API_KEY: 'secret' },
        addon: scriptAddon,
      };
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([row]);
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      const deactivated = await service.deprovisionMidLife(request as never);

      expect(sshExecutor.exec).toHaveBeenCalledWith(
        '203.0.113.10',
        22,
        'root',
        'private-key',
        expect.stringContaining("remove 'secret'"),
        { commandTimeoutMs: 120000 },
      );
      expect(deactivated[0].status).toBe('inactive');
      expect(row.configSnapshot).toEqual({});
      expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith('addon.deactivated', expect.any(Object));
      expect(billingEmailPublisher.publishAddonDeactivated).toHaveBeenCalled();
    });

    it('deactivates without SSH when the addon has no deprovision script', async () => {
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
        {
          id: 'sa-1',
          addonId: 'a-1',
          status: 'active',
          addon: { ...scriptAddon, deprovisionScriptTemplate: null },
        },
      ]);

      const deactivated = await service.deprovisionMidLife(request as never);

      expect(sshExecutor.exec).not.toHaveBeenCalled();
      expect(deactivated[0].status).toBe('inactive');
    });

    it('matches rows by addon id as well', async () => {
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
        { id: 'sa-9', addonId: 'a-1', status: 'pending', addon: { ...scriptAddon, deprovisionScriptTemplate: null } },
      ]);

      const deactivated = await service.deprovisionMidLife({
        ...request,
        subscriptionAddonIds: undefined,
        addonIds: ['a-1'],
      } as never);

      expect(deactivated).toHaveLength(1);
    });

    it('fails the row with a generic message and aborts when the script exits non-zero', async () => {
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
        { id: 'sa-1', addonId: 'a-1', status: 'active', configSnapshot: { API_KEY: 'secret' }, addon: scriptAddon },
      ]);
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: 'boom', code: 1 });

      await expect(service.deprovisionMidLife(request as never)).rejects.toThrow('Addon teardown failed');

      expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith(
        'addon.teardown_failed',
        expect.objectContaining({
          errorMessage: 'Addon teardown failed',
          subscriptionAddon: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });

    it('tears down module addons through the registry', async () => {
      const teardown = jest.fn().mockResolvedValue(undefined);
      addonModuleRegistry.get.mockReturnValue({ key: 'av', displayName: 'AV', provision: jest.fn(), teardown });
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
        {
          id: 'sa-1',
          addonId: 'a-2',
          status: 'active',
          addon: { id: 'a-2', key: 'av', name: 'AV', implementationType: 'module', moduleKey: 'av' },
        },
      ]);

      await service.deprovisionMidLife(request as never);

      expect(teardown).toHaveBeenCalled();
      expect(sshExecutor.exec).not.toHaveBeenCalled();
    });

    it('returns early when neither subscription addon ids nor addon ids are given', async () => {
      await expect(
        service.deprovisionMidLife({ ...request, subscriptionAddonIds: undefined } as never),
      ).resolves.toEqual([]);
      expect(subscriptionAddonsRepository.findBySubscriptionId).not.toHaveBeenCalled();
    });
  });

  describe('teardownForSubscription with deprovision scripts', () => {
    it('runs the deprovision script before the server is removed', async () => {
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
        { id: 'sa-1', addonId: 'a-1', status: 'active', configSnapshot: { API_KEY: 'secret' }, addon: scriptAddon },
      ]);
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      await service.teardownForSubscription({
        subscription: { id: 'sub-1', userId: 'u-1' } as never,
        plan: { id: 'p-1', name: 'Pro' } as never,
        items: [provisionedItem as never],
        providerByItemId: new Map([['item-1', 'hetzner']]),
      });

      expect(sshExecutor.exec).toHaveBeenCalledWith(
        '203.0.113.10',
        22,
        'root',
        'private-key',
        expect.stringContaining("remove 'secret'"),
        expect.any(Object),
      );
      expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith('addon.deactivated', expect.any(Object));
    });

    it('skips the script when the item has no SSH key', async () => {
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
        { id: 'sa-1', addonId: 'a-1', status: 'active', addon: scriptAddon },
      ]);

      await service.teardownForSubscription({
        subscription: { id: 'sub-1', userId: 'u-1' } as never,
        plan: { id: 'p-1', name: 'Pro' } as never,
        items: [{ id: 'item-1' } as never],
        providerByItemId: new Map([['item-1', 'hetzner']]),
      });

      expect(sshExecutor.exec).not.toHaveBeenCalled();
      expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith('addon.deactivated', expect.any(Object));
    });

    it('emits teardown_failed when the deprovision script exits non-zero', async () => {
      subscriptionAddonsRepository.findBySubscriptionId.mockResolvedValue([
        { id: 'sa-1', addonId: 'a-1', status: 'active', configSnapshot: { API_KEY: 'secret' }, addon: scriptAddon },
      ]);
      sshExecutor.exec.mockResolvedValue({ stdout: '', stderr: '', code: 2 });

      await service.teardownForSubscription({
        subscription: { id: 'sub-1', userId: 'u-1' } as never,
        plan: { id: 'p-1', name: 'Pro' } as never,
        items: [provisionedItem as never],
        providerByItemId: new Map([['item-1', 'hetzner']]),
      });

      expect(billingNotificationPublisher.publishAddon).toHaveBeenCalledWith(
        'addon.teardown_failed',
        expect.any(Object),
      );
    });
  });
});
