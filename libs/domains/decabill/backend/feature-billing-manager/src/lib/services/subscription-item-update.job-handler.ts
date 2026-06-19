import { Injectable, Logger } from '@nestjs/common';

import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { buildAgentControllerUpdateCommand } from '../utils/cloud-init/agent-controller.utils';
import { buildAgentManagerUpdateCommand } from '../utils/cloud-init/agent-manager.utils';

import { ProvisioningService } from './provisioning.service';
import { SshExecutorService } from './ssh-executor.service';

const SSH_USER = 'root';
const SSH_PORT = 22;

@Injectable()
export class SubscriptionItemUpdateJobHandler {
  private readonly logger = new Logger(SubscriptionItemUpdateJobHandler.name);

  constructor(
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly provisioningService: ProvisioningService,
    private readonly sshExecutor: SshExecutorService,
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

    const provider = item.serviceType?.provider;

    if (!provider || !item.providerReference || !item.sshPrivateKey) {
      return;
    }

    const serverInfo = await this.provisioningService.getServerInfo(provider, item.providerReference);

    if (!serverInfo?.publicIp) {
      this.logger.warn(`No public IP for item ${item.id}, skipping update`);

      return;
    }

    const service = (item.configSnapshot?.service as string) ?? 'controller';
    const command = service === 'manager' ? buildAgentManagerUpdateCommand() : buildAgentControllerUpdateCommand();
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
