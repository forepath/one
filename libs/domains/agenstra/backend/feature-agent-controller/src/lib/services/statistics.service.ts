import { ClientUserRole, UserRole } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';

import { FilterDropDirection } from '../entities/statistics-chat-filter-drop.entity';
import { FilterFlagDirection } from '../entities/statistics-chat-filter-flag.entity';
import { ChatDirection, StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { StatisticsEntityEventType, StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { StatisticsRepository } from '../repositories/statistics.repository';
import { sanitizeProviderMetadata } from '../utils/statistics-metadata-sanitizer';

/**
 * Service for recording persistent statistics. Fire-and-forget pattern:
 * records are written asynchronously and errors are logged without blocking.
 */
@Injectable()
export class StatisticsService {
  private readonly logger = new Logger(StatisticsService.name);

  constructor(
    private readonly statisticsRepository: StatisticsRepository,
    private readonly clientsRepository: ClientsRepository,
  ) {}

  /**
   * Record chat input (user message). Ensures shadow entries exist.
   */
  async recordChatInput(
    clientId: string,
    agentId: string,
    wordCount: number,
    charCount: number,
    userId?: string,
    interactionKind: StatisticsInteractionKind = StatisticsInteractionKind.CHAT,
  ): Promise<void> {
    try {
      const { statisticsClientId, statisticsAgentId, statisticsUserId } = await this.ensureShadowEntries(
        clientId,
        agentId,
        userId,
      );

      await this.statisticsRepository.createStatisticsChatIo({
        statisticsAgentId,
        statisticsClientId,
        statisticsUserId,
        direction: ChatDirection.INPUT,
        interactionKind,
        wordCount,
        charCount,
        occurredAt: new Date(),
      });
    } catch (error) {
      this.logger.warn(`Failed to record chat input: ${(error as Error).message}`);
    }
  }

  /**
   * Record chat output (agent response). Ensures shadow entries exist.
   */
  async recordChatOutput(
    clientId: string,
    agentId: string,
    wordCount: number,
    charCount: number,
    userId?: string,
    interactionKind: StatisticsInteractionKind = StatisticsInteractionKind.CHAT,
  ): Promise<void> {
    try {
      const { statisticsClientId, statisticsAgentId, statisticsUserId } = await this.ensureShadowEntries(
        clientId,
        agentId,
        userId,
      );

      await this.statisticsRepository.createStatisticsChatIo({
        statisticsAgentId,
        statisticsClientId,
        statisticsUserId,
        direction: ChatDirection.OUTPUT,
        interactionKind,
        wordCount,
        charCount,
        occurredAt: new Date(),
      });
    } catch (error) {
      this.logger.warn(`Failed to record chat output: ${(error as Error).message}`);
    }
  }

  /**
   * Record auto-context enrichment application counts per turn.
   * Stores injected section count in wordCount and combined character volume in charCount.
   */
  async recordAutoContextEnrichment(
    clientId: string,
    agentId: string,
    sectionsInjected: number,
    charsInjected: number,
  ): Promise<void> {
    await this.recordChatOutput(
      clientId,
      agentId,
      sectionsInjected,
      charsInjected,
      undefined,
      StatisticsInteractionKind.AUTO_CONTEXT_ENRICHMENT,
    );
  }

  /**
   * Record a chat message that was filtered/dropped. For outgoing drops,
   * wordCount/charCount may be 0 when not available from agent-manager.
   */
  async recordChatFilterDrop(
    clientId: string,
    agentId: string,
    filterType: string,
    filterDisplayName: string,
    direction: FilterDropDirection,
    wordCount: number,
    charCount: number,
    userId?: string,
    filterReason?: string,
  ): Promise<void> {
    try {
      const { statisticsClientId, statisticsAgentId, statisticsUserId } = await this.ensureShadowEntries(
        clientId,
        agentId,
        userId,
      );

      await this.statisticsRepository.createStatisticsChatFilterDrop({
        statisticsAgentId,
        statisticsClientId,
        statisticsUserId,
        filterType,
        filterDisplayName,
        filterReason,
        direction,
        wordCount,
        charCount,
        occurredAt: new Date(),
      });
    } catch (error) {
      this.logger.warn(`Failed to record chat filter drop: ${(error as Error).message}`);
    }
  }

  /**
   * Record a chat message that was flagged/modified by a filter but NOT dropped.
   * These messages were allowed through (possibly modified) and appear in Chat I/O.
   */
  async recordChatFilterFlag(
    clientId: string,
    agentId: string,
    filterType: string,
    filterDisplayName: string,
    direction: FilterFlagDirection,
    wordCount: number,
    charCount: number,
    userId?: string,
    filterReason?: string,
  ): Promise<void> {
    try {
      const { statisticsClientId, statisticsAgentId, statisticsUserId } = await this.ensureShadowEntries(
        clientId,
        agentId,
        userId,
      );

      await this.statisticsRepository.createStatisticsChatFilterFlag({
        statisticsAgentId,
        statisticsClientId,
        statisticsUserId,
        filterType,
        filterDisplayName,
        filterReason,
        direction,
        wordCount,
        charCount,
        occurredAt: new Date(),
      });
    } catch (error) {
      this.logger.warn(`Failed to record chat filter flag: ${(error as Error).message}`);
    }
  }

  /**
   * Record entity created. Creates shadow entry first, then event.
   */
  async recordEntityCreated(
    entityType: StatisticsEntityType,
    originalEntityId: string,
    metadata: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    try {
      const now = new Date();
      let statisticsUserId: string | undefined;

      if (userId) {
        const shadowUser = await this.statisticsRepository.upsertStatisticsUser(
          userId,
          (metadata.role as string) ?? UserRole.USER,
        );

        statisticsUserId = shadowUser.id;
      }

      switch (entityType) {
        case StatisticsEntityType.USER: {
          const shadowUser = await this.statisticsRepository.upsertStatisticsUser(
            originalEntityId,
            (metadata.role as string) ?? UserRole.USER,
          );

          await this.statisticsRepository.createStatisticsEntityEvent({
            eventType: StatisticsEntityEventType.CREATED,
            entityType: StatisticsEntityType.USER,
            originalEntityId,
            statisticsUserId,
            statisticsUsersId: shadowUser.id,
            occurredAt: now,
          });
          break;
        }

        case StatisticsEntityType.CLIENT: {
          const client = await this.clientsRepository.findById(originalEntityId);

          if (!client) {
            this.logger.warn(`Cannot record client created: client ${originalEntityId} not found`);

            return;
          }

          const shadowClient = await this.statisticsRepository.upsertStatisticsClient(originalEntityId, {
            name: client.name,
            endpoint: client.endpoint,
            authenticationType: client.authenticationType,
          });

          await this.statisticsRepository.createStatisticsEntityEvent({
            eventType: StatisticsEntityEventType.CREATED,
            entityType: StatisticsEntityType.CLIENT,
            originalEntityId,
            statisticsUserId,
            statisticsClientsId: shadowClient.id,
            occurredAt: now,
          });
          break;
        }

        case StatisticsEntityType.AGENT: {
          const statisticsClient = await this.statisticsRepository.findStatisticsClientByOriginalId(
            metadata.clientId as string,
          );

          if (!statisticsClient) {
            this.logger.warn(`Cannot record agent created: statistics client for ${metadata.clientId} not found`);

            return;
          }

          const shadowAgent = await this.statisticsRepository.upsertStatisticsAgent(
            originalEntityId,
            statisticsClient.id,
            {
              agentType: metadata.agentType as string,
              containerType: metadata.containerType as string,
              name: metadata.name as string,
              description: metadata.description as string,
            },
          );

          await this.statisticsRepository.createStatisticsEntityEvent({
            eventType: StatisticsEntityEventType.CREATED,
            entityType: StatisticsEntityType.AGENT,
            originalEntityId,
            statisticsUserId,
            statisticsAgentsId: shadowAgent.id,
            occurredAt: now,
          });
          break;
        }

        case StatisticsEntityType.CLIENT_USER: {
          const statisticsClient = await this.statisticsRepository.findStatisticsClientByOriginalId(
            metadata.clientId as string,
          );
          const statisticsUser = await this.statisticsRepository.findStatisticsUserByOriginalId(
            metadata.userId as string,
          );

          if (!statisticsClient || !statisticsUser) {
            this.logger.warn(
              `Cannot record client-user created: shadow client or user not found (clientId=${metadata.clientId}, userId=${metadata.userId})`,
            );

            return;
          }

          const shadowClientUser = await this.statisticsRepository.createStatisticsClientUser({
            originalClientUserId: originalEntityId,
            statisticsClientId: statisticsClient.id,
            statisticsUserId: statisticsUser.id,
            role: (metadata.role as string) ?? ClientUserRole.USER,
          });

          await this.statisticsRepository.createStatisticsEntityEvent({
            eventType: StatisticsEntityEventType.CREATED,
            entityType: StatisticsEntityType.CLIENT_USER,
            originalEntityId,
            statisticsUserId,
            statisticsClientUsersId: shadowClientUser.id,
            occurredAt: now,
          });
          break;
        }

        case StatisticsEntityType.PROVISIONING_REFERENCE: {
          const statisticsClient = await this.statisticsRepository.findStatisticsClientByOriginalId(
            metadata.clientId as string,
          );

          if (!statisticsClient) {
            this.logger.warn(
              `Cannot record provisioning reference created: statistics client for ${metadata.clientId} not found`,
            );

            return;
          }

          const sanitizedMetadata = sanitizeProviderMetadata(metadata.providerMetadata as string);
          const shadowProv = await this.statisticsRepository.createStatisticsProvisioningReference({
            originalProvisioningReferenceId: originalEntityId,
            statisticsClientId: statisticsClient.id,
            providerType: metadata.providerType as string,
            serverId: metadata.serverId as string,
            serverName: metadata.serverName as string,
            publicIp: metadata.publicIp as string,
            privateIp: metadata.privateIp as string,
            providerMetadata: sanitizedMetadata !== '{}' ? sanitizedMetadata : undefined,
          });

          await this.statisticsRepository.createStatisticsEntityEvent({
            eventType: StatisticsEntityEventType.CREATED,
            entityType: StatisticsEntityType.PROVISIONING_REFERENCE,
            originalEntityId,
            statisticsUserId,
            statisticsProvisioningReferencesId: shadowProv.id,
            occurredAt: now,
          });
          break;
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to record entity created: ${(error as Error).message}`);
    }
  }

  /**
   * Record entity updated. Upserts shadow entry to reflect new state, then creates event.
   */
  async recordEntityUpdated(
    entityType: StatisticsEntityType,
    originalEntityId: string,
    metadata: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    try {
      const now = new Date();
      let statisticsUserId: string | undefined;

      if (userId) {
        const shadowUser = await this.statisticsRepository.findStatisticsUserByOriginalId(userId);

        if (shadowUser) statisticsUserId = shadowUser.id;
      }

      switch (entityType) {
        case StatisticsEntityType.USER: {
          const shadowUser = await this.statisticsRepository.upsertStatisticsUser(
            originalEntityId,
            (metadata.role as string) ?? UserRole.USER,
          );

          await this.statisticsRepository.createStatisticsEntityEvent({
            eventType: StatisticsEntityEventType.UPDATED,
            entityType: StatisticsEntityType.USER,
            originalEntityId,
            statisticsUserId,
            statisticsUsersId: shadowUser.id,
            occurredAt: now,
          });
          break;
        }

        case StatisticsEntityType.CLIENT: {
          const client = await this.clientsRepository.findById(originalEntityId);

          if (!client) {
            this.logger.warn(`Cannot record client updated: client ${originalEntityId} not found`);

            return;
          }

          const shadowClient = await this.statisticsRepository.upsertStatisticsClient(originalEntityId, {
            name: client.name,
            endpoint: client.endpoint,
            authenticationType: client.authenticationType,
          });

          await this.statisticsRepository.createStatisticsEntityEvent({
            eventType: StatisticsEntityEventType.UPDATED,
            entityType: StatisticsEntityType.CLIENT,
            originalEntityId,
            statisticsUserId,
            statisticsClientsId: shadowClient.id,
            occurredAt: now,
          });
          break;
        }

        case StatisticsEntityType.AGENT: {
          const statisticsClient = await this.statisticsRepository.findStatisticsClientByOriginalId(
            metadata.clientId as string,
          );

          if (!statisticsClient) {
            this.logger.warn(`Cannot record agent updated: statistics client for ${metadata.clientId} not found`);

            return;
          }

          const shadowAgent = await this.statisticsRepository.upsertStatisticsAgent(
            originalEntityId,
            statisticsClient.id,
            {
              agentType: metadata.agentType as string,
              containerType: metadata.containerType as string,
              name: metadata.name as string,
              description: metadata.description as string,
            },
          );

          await this.statisticsRepository.createStatisticsEntityEvent({
            eventType: StatisticsEntityEventType.UPDATED,
            entityType: StatisticsEntityType.AGENT,
            originalEntityId,
            statisticsUserId,
            statisticsAgentsId: shadowAgent.id,
            occurredAt: now,
          });
          break;
        }

        case StatisticsEntityType.CLIENT_USER:
        case StatisticsEntityType.PROVISIONING_REFERENCE:
          this.logger.debug(`Entity update events not implemented for ${entityType}`);
          break;
      }
    } catch (error) {
      this.logger.warn(`Failed to record entity updated: ${(error as Error).message}`);
    }
  }

  /**
   * Record entity deleted. Shadow entries are retained for historical reference.
   */
  async recordEntityDeleted(
    entityType: StatisticsEntityType,
    originalEntityId: string,
    userId?: string,
  ): Promise<void> {
    try {
      const now = new Date();
      let statisticsUserId: string | undefined;

      if (userId) {
        const shadowUser = await this.statisticsRepository.findStatisticsUserByOriginalId(userId);

        if (shadowUser) statisticsUserId = shadowUser.id;
      }

      let statisticsUsersId: string | undefined;
      let statisticsClientsId: string | undefined;
      let statisticsAgentsId: string | undefined;
      let statisticsClientUsersId: string | undefined;
      let statisticsProvisioningReferencesId: string | undefined;

      if (entityType === StatisticsEntityType.USER) {
        const shadow = await this.statisticsRepository.findStatisticsUserByOriginalId(originalEntityId);

        if (shadow) statisticsUsersId = shadow.id;
      } else if (entityType === StatisticsEntityType.CLIENT) {
        const shadow = await this.statisticsRepository.findStatisticsClientByOriginalId(originalEntityId);

        if (shadow) statisticsClientsId = shadow.id;
      }
      // For agent, client_user, provisioning_reference - we don't resolve shadow by originalEntityId
      // since the original may already be deleted. The event stores originalEntityId for correlation.

      await this.statisticsRepository.createStatisticsEntityEvent({
        eventType: StatisticsEntityEventType.DELETED,
        entityType,
        originalEntityId,
        statisticsUserId,
        statisticsUsersId,
        statisticsClientsId,
        statisticsAgentsId,
        statisticsClientUsersId,
        statisticsProvisioningReferencesId,
        occurredAt: now,
      });
    } catch (error) {
      this.logger.warn(`Failed to record entity deleted: ${(error as Error).message}`);
    }
  }

  /**
   * Ensure shadow entries exist for client, agent, and optionally user.
   * Returns shadow IDs for recording chat events.
   */
  private async ensureShadowEntries(
    clientId: string,
    agentId: string,
    userId?: string,
  ): Promise<{
    statisticsClientId: string;
    statisticsAgentId: string;
    statisticsUserId?: string;
  }> {
    const client = await this.clientsRepository.findById(clientId);

    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }

    const statisticsClient = await this.statisticsRepository.upsertStatisticsClient(clientId, {
      name: client.name,
      endpoint: client.endpoint,
      authenticationType: client.authenticationType,
    });
    const statisticsAgent = await this.statisticsRepository.upsertStatisticsAgent(agentId, statisticsClient.id, {});
    let statisticsUserId: string | undefined;

    if (userId) {
      const shadowUser = await this.statisticsRepository.findStatisticsUserByOriginalId(userId);

      if (shadowUser) statisticsUserId = shadowUser.id;
    }

    return {
      statisticsClientId: statisticsClient.id,
      statisticsAgentId: statisticsAgent.id,
      statisticsUserId,
    };
  }
}
