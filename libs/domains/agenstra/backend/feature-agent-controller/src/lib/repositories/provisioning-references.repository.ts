import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ProvisioningReferenceEntity } from '../entities/provisioning-reference.entity';

/**
 * Repository for provisioning reference database operations.
 * Abstracts TypeORM-specific details and provides intention-revealing methods.
 */
@Injectable()
export class ProvisioningReferencesRepository {
  constructor(
    @InjectRepository(ProvisioningReferenceEntity)
    private readonly repository: Repository<ProvisioningReferenceEntity>,
  ) {}

  /**
   * Find a provisioning reference by ID.
   * @param id - The UUID of the provisioning reference
   * @returns The provisioning reference entity if found
   * @throws NotFoundException if provisioning reference is not found
   */
  async findByIdOrThrow(id: string): Promise<ProvisioningReferenceEntity> {
    const reference = await this.repository.findOne({ where: { id } });

    if (!reference) {
      throw new NotFoundException(`Provisioning reference with id '${id}' not found`);
    }

    return reference;
  }

  /**
   * Find a provisioning reference by ID (without throwing).
   * @param id - The UUID of the provisioning reference
   * @returns The provisioning reference entity if found, null otherwise
   */
  async findById(id: string): Promise<ProvisioningReferenceEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find a provisioning reference by client ID.
   * @param clientId - The UUID of the client
   * @returns The provisioning reference entity if found, null otherwise
   */
  async findByClientId(clientId: string): Promise<ProvisioningReferenceEntity | null> {
    return await this.repository.findOne({ where: { clientId } });
  }

  /**
   * Find a provisioning reference by provider server ID.
   * @param providerType - The provider type (e.g., 'hetzner')
   * @param serverId - The provider-specific server ID
   * @returns The provisioning reference entity if found, null otherwise
   */
  async findByProviderServerId(providerType: string, serverId: string): Promise<ProvisioningReferenceEntity | null> {
    return await this.repository.findOne({ where: { providerType, serverId } });
  }

  /**
   * Find all provisioning references with pagination.
   * @param limit - Maximum number of references to return
   * @param offset - Number of references to skip
   * @returns Array of provisioning reference entities
   */
  async findAll(limit = 10, offset = 0): Promise<ProvisioningReferenceEntity[]> {
    return await this.repository.find({
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find all provisioning references for a specific provider type.
   * @param providerType - The provider type (e.g., 'hetzner')
   * @param limit - Maximum number of references to return
   * @param offset - Number of references to skip
   * @returns Array of provisioning reference entities
   */
  async findByProviderType(providerType: string, limit = 10, offset = 0): Promise<ProvisioningReferenceEntity[]> {
    return await this.repository.find({
      where: { providerType },
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Create a new provisioning reference.
   * @param data - Partial provisioning reference entity data
   * @returns The created provisioning reference entity
   */
  async create(data: Partial<ProvisioningReferenceEntity>): Promise<ProvisioningReferenceEntity> {
    const reference = this.repository.create(data);

    return await this.repository.save(reference);
  }

  /**
   * Update an existing provisioning reference.
   * @param id - The UUID of the provisioning reference to update
   * @param data - Partial provisioning reference entity data to update
   * @returns The updated provisioning reference entity
   * @throws NotFoundException if provisioning reference is not found
   */
  async update(id: string, data: Partial<ProvisioningReferenceEntity>): Promise<ProvisioningReferenceEntity> {
    await this.findByIdOrThrow(id);
    await this.repository.update(id, data);

    return await this.findByIdOrThrow(id);
  }

  /**
   * Delete a provisioning reference by ID.
   * @param id - The UUID of the provisioning reference to delete
   * @throws NotFoundException if provisioning reference is not found
   */
  async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.delete(id);
  }

  /**
   * Delete a provisioning reference by client ID.
   * @param clientId - The UUID of the client
   */
  async deleteByClientId(clientId: string): Promise<void> {
    await this.repository.delete({ clientId });
  }
}
