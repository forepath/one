import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DeploymentConfigurationEntity } from '../entities/deployment-configuration.entity';

/**
 * Repository for deployment configuration database operations.
 * Abstracts TypeORM-specific details and provides intention-revealing methods.
 */
@Injectable()
export class DeploymentConfigurationsRepository {
  constructor(
    @InjectRepository(DeploymentConfigurationEntity)
    private readonly repository: Repository<DeploymentConfigurationEntity>,
  ) {}

  /**
   * Find a deployment configuration by agent ID.
   * @param agentId - The UUID of the agent
   * @returns The deployment configuration entity if found, null otherwise
   */
  async findByAgentId(agentId: string): Promise<DeploymentConfigurationEntity | null> {
    return await this.repository.findOne({ where: { agentId } });
  }

  /**
   * Find a deployment configuration by agent ID or throw.
   * @param agentId - The UUID of the agent
   * @returns The deployment configuration entity if found
   * @throws NotFoundException if configuration is not found
   */
  async findByAgentIdOrThrow(agentId: string): Promise<DeploymentConfigurationEntity> {
    const config = await this.findByAgentId(agentId);

    if (!config) {
      throw new NotFoundException(`Deployment configuration for agent ${agentId} not found`);
    }

    return config;
  }

  /**
   * Find a deployment configuration by ID.
   * @param id - The UUID of the configuration
   * @returns The deployment configuration entity if found
   * @throws NotFoundException if configuration is not found
   */
  async findByIdOrThrow(id: string): Promise<DeploymentConfigurationEntity> {
    const config = await this.repository.findOne({ where: { id } });

    if (!config) {
      throw new NotFoundException(`Deployment configuration with ID ${id} not found`);
    }

    return config;
  }

  /**
   * Create a new deployment configuration.
   * @param dto - Data transfer object for creating a configuration
   * @returns The created deployment configuration entity
   */
  async create(dto: Partial<DeploymentConfigurationEntity>): Promise<DeploymentConfigurationEntity> {
    const config = this.repository.create(dto);

    return await this.repository.save(config);
  }

  /**
   * Update an existing deployment configuration.
   * @param id - The UUID of the configuration to update
   * @param dto - Data transfer object for updating a configuration
   * @returns The updated deployment configuration entity
   * @throws NotFoundException if configuration is not found
   */
  async update(id: string, dto: Partial<DeploymentConfigurationEntity>): Promise<DeploymentConfigurationEntity> {
    const config = await this.findByIdOrThrow(id);

    Object.assign(config, dto);

    return await this.repository.save(config);
  }

  /**
   * Update or create a deployment configuration for an agent.
   * @param agentId - The UUID of the agent
   * @param dto - Data transfer object for the configuration
   * @returns The updated or created deployment configuration entity
   */
  async upsertByAgentId(
    agentId: string,
    dto: Partial<DeploymentConfigurationEntity>,
  ): Promise<DeploymentConfigurationEntity> {
    const existing = await this.findByAgentId(agentId);

    if (existing) {
      Object.assign(existing, dto);

      return await this.repository.save(existing);
    } else {
      const config = this.repository.create({ ...dto, agentId });

      return await this.repository.save(config);
    }
  }

  /**
   * Delete a deployment configuration by agent ID.
   * @param agentId - The UUID of the agent
   * @throws NotFoundException if configuration is not found
   */
  async deleteByAgentId(agentId: string): Promise<void> {
    const config = await this.findByAgentIdOrThrow(agentId);

    await this.repository.remove(config);
  }
}
