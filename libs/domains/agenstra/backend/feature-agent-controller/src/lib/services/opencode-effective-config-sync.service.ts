import { Injectable, Logger } from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentOpencodeConfigProxyService } from './client-agent-opencode-config-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { OpencodeConfigService } from './opencode-config.service';

export interface OpencodeAgentSyncResult {
  ok: boolean;
  /** When true, keep target `pending` (e.g. container not running) instead of `failed`. */
  defer?: boolean;
  error?: string;
}

/**
 * Builds and pushes fully merged OpenCode config (global → workspace → agent) + secrets to workers.
 */
@Injectable()
export class OpencodeEffectiveConfigSyncService {
  private readonly logger = new Logger(OpencodeEffectiveConfigSyncService.name);

  constructor(
    private readonly opencodeConfigService: OpencodeConfigService,
    private readonly agentConfigProxy: ClientAgentOpencodeConfigProxyService,
    private readonly clientAgentProxy: ClientAgentProxyService,
    private readonly clientsRepository: ClientsRepository,
  ) {}

  async listClientIds(): Promise<string[]> {
    return await this.clientsRepository.findAllIds();
  }

  async buildEffectivePayload(
    clientId: string,
    agentId: string,
  ): Promise<{ effective: Record<string, unknown>; secrets: Record<string, string> }> {
    const layers = await this.opencodeConfigService.getLayerConfigs(clientId);
    const secrets = await this.opencodeConfigService.getLayerSecrets(clientId);
    const agentConfig = await this.agentConfigProxy.get(clientId, agentId);
    const agentOverlay = this.opencodeConfigService.composeStoredLayer(agentConfig.config, agentConfig.overrides);
    const effective = await this.opencodeConfigService.mergeEffectiveForSync(
      agentOverlay,
      layers.workspace,
      layers.global,
    );
    // Agent-layer secrets are merged inside manager syncEffective; pass workspace + global only.
    const workerSecrets = this.opencodeConfigService.mergeSecrets({}, secrets.workspace, secrets.global);

    return { effective, secrets: workerSecrets };
  }

  /** Sync one agent with the full layered effective config. */
  async syncAgent(clientId: string, agentId: string): Promise<OpencodeAgentSyncResult> {
    const { effective, secrets } = await this.buildEffectivePayload(clientId, agentId);

    return await this.agentConfigProxy.syncEffective(clientId, agentId, effective, secrets);
  }

  /** Sync every agent for one workspace/client (paged). Prefer sync targets + BullMQ for durability. */
  async syncClientAgents(clientId: string): Promise<void> {
    const pageSize = 100;
    let offset = 0;

    for (;;) {
      const agents = await this.clientAgentProxy.getClientAgents(clientId, pageSize, offset);

      if (agents.length === 0) {
        break;
      }

      for (const agent of agents) {
        try {
          const result = await this.syncAgent(clientId, agent.id);

          if (!result.ok) {
            this.logger.debug(`Cascade sync incomplete for agent ${agent.id}: ${result.error ?? 'unknown'}`);
          }
        } catch (error: unknown) {
          const err = error as { message?: string };

          this.logger.debug(`Skipping cascade sync for agent ${agent.id}: ${err.message ?? 'unknown error'}`);
        }
      }

      if (agents.length < pageSize) {
        break;
      }

      offset += pageSize;
    }
  }

  /** Sync every agent across all clients (e.g. after global layer PUT). */
  async syncAllClients(): Promise<void> {
    const clientIds = await this.clientsRepository.findAllIds();

    for (const clientId of clientIds) {
      try {
        await this.syncClientAgents(clientId);
      } catch (error: unknown) {
        const err = error as { message?: string };

        this.logger.warn(`Cascade OpenCode config sync failed for client ${clientId}: ${err.message ?? 'unknown'}`);
      }
    }
  }
}
