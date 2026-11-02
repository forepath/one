import { buildDecabillBillingUpdateCommand } from '../contributors/decabill-billing/decabill-billing.utils';
import { buildLoadweaverUpdateCommand } from '../contributors/loadweaver/loadweaver.utils';
import type { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';

import { IntegratedStackRegistryService } from './integrated-stack-registry.service';
import type { ProvisioningDispatchService } from './provisioning-dispatch.service';
import type { SshExecutorService } from './ssh-executor.service';
import { SubscriptionItemUpdateJobHandler } from './subscription-item-update.job-handler';

describe('SubscriptionItemUpdateJobHandler', () => {
  const items = { findByIdWithRelations: jest.fn(), findProvisionedWithSshKey: jest.fn() };
  const provisioning = { getServerInfo: jest.fn() };
  const ssh = { exec: jest.fn() };
  let registry: IntegratedStackRegistryService;
  let handler: SubscriptionItemUpdateJobHandler;

  const item = (service: string) => ({
    id: 'item-1',
    providerReference: 'srv-1',
    sshPrivateKey: 'key',
    configSnapshot: { service, provider: 'hetzner' },
    serviceType: { providerDefaults: {} },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    registry = new IntegratedStackRegistryService();
    registry.register({
      key: 'decabill-billing',
      displayName: 'Decabill Billing',
      buildUpdateCommand: buildDecabillBillingUpdateCommand,
    });
    registry.register({
      key: 'loadweaver',
      displayName: 'Loadweaver',
      buildUpdateCommand: buildLoadweaverUpdateCommand,
      selfUpdating: true,
    });
    handler = new SubscriptionItemUpdateJobHandler(
      items as unknown as SubscriptionItemsRepository,
      provisioning as unknown as ProvisioningDispatchService,
      ssh as unknown as SshExecutorService,
      registry,
    );
    provisioning.getServerInfo.mockResolvedValue({ publicIp: '203.0.113.10' });
    ssh.exec.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  });

  it('pulls compose images for compose-based stacks', async () => {
    items.findByIdWithRelations.mockResolvedValue(item('decabill-billing'));

    await handler.updateItem('item-1');

    expect(ssh.exec.mock.calls[0][4]).toContain('docker compose up -d --pull=always');
  });

  it('never pulls a self-updating Loadweaver cluster; only re-pins its console', async () => {
    items.findByIdWithRelations.mockResolvedValue(item('loadweaver'));

    await handler.updateItem('item-1');

    const command = ssh.exec.mock.calls[0][4] as string;

    expect(command).not.toContain('--pull');
    expect(command).toContain('docker compose up -d console');
  });

  it('skips custom items', async () => {
    items.findByIdWithRelations.mockResolvedValue(item('custom'));

    await handler.updateItem('item-1');

    expect(ssh.exec).not.toHaveBeenCalled();
  });
});
