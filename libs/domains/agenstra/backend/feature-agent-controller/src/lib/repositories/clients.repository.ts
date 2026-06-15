import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

/**
 * Repository for client database operations.
 * Abstracts TypeORM-specific details and provides intention-revealing methods.
 */
@Injectable()
export class ClientsRepository {
  constructor(
    @InjectRepository(ClientEntity)
    private readonly repository: Repository<ClientEntity>,
  ) {}

  /**
   * Find a client by ID.
   * @param id - The UUID of the client
   * @returns The client entity if found
   * @throws NotFoundException if client is not found
   */
  async findByIdOrThrow(id: string): Promise<ClientEntity> {
    const client = await this.repository.findOne({ where: { id } });

    if (!client) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    return client;
  }

  /**
   * Find a client by ID without throwing an error.
   * @param id - The UUID of the client
   * @returns The client entity if found, null otherwise
   */
  async findById(id: string): Promise<ClientEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find a client by name.
   * @param name - The name of the client
   * @returns The client entity if found, null otherwise
   */
  async findByName(name: string): Promise<ClientEntity | null> {
    return await this.repository.findOne({ where: { name } });
  }

  /**
   * Find all clients with pagination.
   * @param limit - Maximum number of clients to return
   * @param offset - Number of clients to skip
   * @returns Array of client entities
   */
  async findAll(limit = 10, offset = 0): Promise<ClientEntity[]> {
    return await this.repository.find({
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Count total number of clients.
   * @returns Total count of clients
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Find all client IDs (for statistics access filtering).
   * @returns Array of client UUIDs
   */
  async findAllIds(): Promise<string[]> {
    const rows = await this.repository.find({ select: ['id'] });

    return rows.map((r) => r.id);
  }

  /**
   * Find all clients with minimal fields for statistics mirror sync.
   * @returns Array of client sync data
   */
  async findAllForStatisticsSync(): Promise<
    { id: string; name: string; endpoint: string; authenticationType: AuthenticationType }[]
  > {
    const rows = await this.repository.find({
      select: ['id', 'name', 'endpoint', 'authenticationType'],
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      endpoint: r.endpoint,
      authenticationType: r.authenticationType,
    }));
  }

  /**
   * Find client IDs where the user is the creator.
   * @param userId - The UUID of the user (creator)
   * @returns Array of client UUIDs
   */
  async findIdsByCreatorId(userId: string): Promise<string[]> {
    const rows = await this.repository.find({
      where: { userId },
      select: ['id'],
    });

    return rows.map((r) => r.id);
  }

  /**
   * Create a new client.
   * @param dto - Data transfer object for creating a client
   * @returns The created client entity
   */
  async create(dto: Partial<ClientEntity>): Promise<ClientEntity> {
    const client = this.repository.create(dto);

    return await this.repository.save(client);
  }

  /**
   * Update an existing client.
   * @param id - The UUID of the client to update
   * @param dto - Data transfer object for updating a client
   * @returns The updated client entity
   * @throws NotFoundException if client is not found
   */
  async update(id: string, dto: Partial<ClientEntity>): Promise<ClientEntity> {
    const client = await this.findByIdOrThrow(id);

    Object.assign(client, dto);

    return await this.repository.save(client);
  }

  /**
   * Delete a client by ID.
   * @param id - The UUID of the client to delete
   * @throws NotFoundException if client is not found
   */
  async delete(id: string): Promise<void> {
    const client = await this.findByIdOrThrow(id);

    await this.repository.remove(client);
  }
}
