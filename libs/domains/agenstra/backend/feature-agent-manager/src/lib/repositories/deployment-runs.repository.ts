import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DeploymentRunEntity } from '../entities/deployment-run.entity';

/**
 * Repository for deployment run database operations.
 * Abstracts TypeORM-specific details and provides intention-revealing methods.
 */
@Injectable()
export class DeploymentRunsRepository {
  constructor(
    @InjectRepository(DeploymentRunEntity)
    private readonly repository: Repository<DeploymentRunEntity>,
  ) {}

  /**
   * Find all deployment runs for a configuration with pagination.
   * @param configurationId - The UUID of the deployment configuration
   * @param limit - Maximum number of runs to return
   * @param offset - Number of runs to skip
   * @returns Array of deployment run entities
   */
  async findByConfigurationId(configurationId: string, limit = 50, offset = 0): Promise<DeploymentRunEntity[]> {
    return await this.repository.find({
      where: { configurationId },
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find a deployment run by its database ID.
   * @param id - The UUID of the deployment run
   * @returns The deployment run entity if found, null otherwise
   */
  async findById(id: string): Promise<DeploymentRunEntity | null> {
    return await this.repository.findOne({
      where: { id },
    });
  }

  /**
   * Find a deployment run by provider run ID.
   * @param configurationId - The UUID of the deployment configuration
   * @param providerRunId - The provider-specific run ID
   * @returns The deployment run entity if found, null otherwise
   */
  async findByProviderRunId(configurationId: string, providerRunId: string): Promise<DeploymentRunEntity | null> {
    return await this.repository.findOne({
      where: { configurationId, providerRunId },
    });
  }

  /**
   * Create a new deployment run.
   * @param dto - Data transfer object for creating a run
   * @returns The created deployment run entity
   */
  async create(dto: Partial<DeploymentRunEntity>): Promise<DeploymentRunEntity> {
    const run = this.repository.create(dto);

    return await this.repository.save(run);
  }

  /**
   * Update an existing deployment run.
   * @param id - The UUID of the run to update
   * @param dto - Data transfer object for updating a run
   * @returns The updated deployment run entity
   */
  async update(id: string, dto: Partial<DeploymentRunEntity>): Promise<DeploymentRunEntity> {
    const run = await this.repository.findOne({ where: { id } });

    if (!run) {
      throw new Error(`Deployment run with ID ${id} not found`);
    }

    Object.assign(run, dto);

    return await this.repository.save(run);
  }

  /**
   * Update or create a deployment run.
   * @param configurationId - The UUID of the deployment configuration
   * @param providerRunId - The provider-specific run ID
   * @param dto - Data transfer object for the run
   * @returns The updated or created deployment run entity
   */
  async upsertByProviderRunId(
    configurationId: string,
    providerRunId: string,
    dto: Partial<DeploymentRunEntity>,
  ): Promise<DeploymentRunEntity> {
    const existing = await this.findByProviderRunId(configurationId, providerRunId);

    if (existing) {
      Object.assign(existing, dto);

      return await this.repository.save(existing);
    } else {
      const run = this.repository.create({ ...dto, configurationId, providerRunId });

      return await this.repository.save(run);
    }
  }
}
