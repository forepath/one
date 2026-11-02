import { Injectable, Logger } from '@nestjs/common';

import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { CloudInitServiceType, normalizeCloudInitService } from '../utils/cloud-init/cloud-init-dispatch.utils';
import { canonicalizeIntegratedProvisioningService } from '../utils/cloud-init/integrated-provisioning-service';
import { getProvisioningCredentials } from '../utils/provider-env-defaults.utils';
import { resolveItemProvider } from '../utils/provider-selection.utils';

import { IntegratedStackRegistryService } from './integrated-stack-registry.service';
import { ProvisioningDispatchService } from './provisioning-dispatch.service';
import { SshExecutorService } from './ssh-executor.service';

const SSH_USER = 'root';
const SSH_PORT = 22;

@Injectable()
export class SubscriptionItemUpdateJobHandler {
  private readonly logger = new Logger(SubscriptionItemUpdateJobHandler.name);

  constructor(
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly provisioningDispatchService: ProvisioningDispatchService,
    private readonly sshExecutor: SshExecutorService,
    private readonly integratedStackRegistry: IntegratedStackRegistryService,
  ) {}

  async findProvisionedItemIds(): Promise<string[]> {
    const items = await this.subscriptionItemsRepository.findProvisionedWithSshKey();

    return items.map((item) => item.id);
  }

  async updateItem(subscriptionItemId: string): Promise<void> {
    const item = await this.subscriptionItemsRepository.findByIdWithRelations(subscriptionItemId);

    if (!item) {
      throw new Error(`Subscription item ${subscriptionItemId} not found`);
    }

    const provider = resolveItemProvider(item);

    if (!provider || !item.providerReference || !item.sshPrivateKey) {
      return;
    }

    const credentials = getProvisioningCredentials(provider, item.serviceType?.providerDefaults);
    const serverInfo = await this.provisioningDispatchService.getServerInfo(
      provider,
      item.providerReference,
      credentials,
    );

    if (!serverInfo?.publicIp) {
      this.logger.warn(`No public IP for item ${item.id}, skipping update`);

      return;
    }

    const rawService = item.configSnapshot?.service as string | undefined;
    const service = normalizeCloudInitService(rawService);

    if (service === CloudInitServiceType.Custom) {
      this.logger.log(`Skipping update for custom subscription item ${item.id}`);

      return;
    }

    const stackKey = canonicalizeIntegratedProvisioningService(rawService ?? '');
    const stack = stackKey ? this.integratedStackRegistry.get(stackKey) : undefined;

    if (!stack?.buildUpdateCommand) {
      this.logger.warn(`Skipping update; integrated stack is not updatable for item ${item.id}`);

      return;
    }

    if (stack.selfUpdating) {
      // e.g. Loadweaver: the product updates itself; the command only aligns auxiliary parts (never a compose pull).
      this.logger.log(
        `Item ${item.id} runs a self-updating stack (${stack.key}); running its non-pulling update command`,
      );
    }

    const command = stack.buildUpdateCommand();
    const result = await this.sshExecutor.exec(serverInfo.publicIp, SSH_PORT, SSH_USER, item.sshPrivateKey, command);

    if (result.code !== 0) {
      this.logger.error(
        `Update command failed for item ${item.id} (exit code ${result.code}): stderr=${result.stderr.slice(0, 500)}`,
      );
    } else {
      this.logger.log(`Update completed for subscription item ${item.id}`);
    }
  }
}
