import { ClientUserEntity } from '@forepath/identity/backend';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

/**
 * Repository for client_users database operations.
 * Manages the many-to-many relationship between users and clients.
 */
@Injectable()
export class ClientUsersRepository {
  constructor(
    @InjectRepository(ClientUserEntity)
    private readonly repository: Repository<ClientUserEntity>,
  ) {}

  /**
   * Find a client-user relationship by ID.
   * @param id - The UUID of the relationship
   * @returns The client-user entity if found
   * @throws NotFoundException if relationship is not found
   */
  async findByIdOrThrow(id: string): Promise<ClientUserEntity> {
    const clientUser = await this.repository.findOne({ where: { id } });

    if (!clientUser) {
      throw new NotFoundException(`Client-user relationship with ID ${id} not found`);
    }

    return clientUser;
  }

  /**
   * Find a client-user relationship by ID without throwing an error.
   * @param id - The UUID of the relationship
   * @returns The client-user entity if found, null otherwise
   */
  async findById(id: string): Promise<ClientUserEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find a client-user relationship by user ID and client ID.
   * @param userId - The UUID of the user
   * @param clientId - The UUID of the client
   * @returns The client-user entity if found, null otherwise
   */
  async findByUserAndClient(userId: string, clientId: string): Promise<ClientUserEntity | null> {
    return await this.repository.findOne({ where: { userId, clientId } });
  }

  /**
   * Find all client-user relationships for a specific client.
   * @param clientId - The UUID of the client
   * @returns Array of client-user entities
   */
  async findByClientId(clientId: string): Promise<ClientUserEntity[]> {
    return await this.repository.find({
      where: { clientId },
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find all client-user relationships for a specific user.
   * @param userId - The UUID of the user
   * @returns Array of client-user entities
   */
  async findByUserId(userId: string): Promise<ClientUserEntity[]> {
    return await this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Check if a user has access to a client.
   * @param userId - The UUID of the user
   * @param clientId - The UUID of the client
   * @returns The client-user entity if found, null otherwise
   */
  async findUserClientAccess(userId: string, clientId: string): Promise<ClientUserEntity | null> {
    return await this.repository.findOne({ where: { userId, clientId } });
  }

  /**
   * Create a new client-user relationship.
   * @param dto - Data transfer object for creating a client-user relationship
   * @returns The created client-user entity
   */
  async create(dto: Partial<ClientUserEntity>): Promise<ClientUserEntity> {
    const clientUser = this.repository.create(dto);

    return await this.repository.save(clientUser);
  }

  /**
   * Update an existing client-user relationship.
   * @param id - The UUID of the relationship to update
   * @param dto - Data transfer object for updating a client-user relationship
   * @returns The updated client-user entity
   * @throws NotFoundException if relationship is not found
   */
  async update(id: string, dto: Partial<ClientUserEntity>): Promise<ClientUserEntity> {
    const clientUser = await this.findByIdOrThrow(id);

    Object.assign(clientUser, dto);

    return await this.repository.save(clientUser);
  }

  /**
   * Delete a client-user relationship by ID.
   * @param id - The UUID of the relationship to delete
   * @throws NotFoundException if relationship is not found
   */
  async delete(id: string): Promise<void> {
    const clientUser = await this.findByIdOrThrow(id);

    await this.repository.remove(clientUser);
  }

  /**
   * Delete a client-user relationship by user ID and client ID.
   * @param userId - The UUID of the user
   * @param clientId - The UUID of the client
   * @returns True if deleted, false if not found
   */
  async deleteByUserAndClient(userId: string, clientId: string): Promise<boolean> {
    const result = await this.repository.delete({ userId, clientId });

    return (result.affected ?? 0) > 0;
  }
}
