import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';

/**
 * Repository for agent environment variable database operations.
 * Abstracts TypeORM-specific details and provides intention-revealing methods.
 */
@Injectable()
export class AgentEnvironmentVariablesRepository {
  constructor(
    @InjectRepository(AgentEnvironmentVariableEntity)
    private readonly repository: Repository<AgentEnvironmentVariableEntity>,
  ) {}

  /**
   * Find a environment variable by ID.
   * @param id - The UUID of the environment variable
   * @returns The environment variable entity if found
   * @throws NotFoundException if environment variable is not found
   */
  async findByIdOrThrow(id: string): Promise<AgentEnvironmentVariableEntity> {
    const variable = await this.repository.findOne({ where: { id } });

    if (!variable) {
      throw new NotFoundException(`Environment variable with ID ${id} not found`);
    }

    return variable;
  }

  /**
   * Find a environment variable by ID without throwing an error.
   * @param id - The UUID of the environment variable
   * @returns The environment variable entity if found, null otherwise
   */
  async findById(id: string): Promise<AgentEnvironmentVariableEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find all environment variables for a specific agent with pagination.
   * @param agentId - The UUID of the agent
   * @param limit - Maximum number of environment variables to return
   * @param offset - Number of environment variables to skip
   * @returns Array of environment variable entities ordered by creation date (newest first)
   */
  async findByAgentId(agentId: string, limit = 50, offset = 0): Promise<AgentEnvironmentVariableEntity[]> {
    return await this.repository.find({
      where: { agentId },
      take: limit,
      skip: offset,
      order: { createdAt: 'ASC' }, // Chronological order for environment variable history
      relations: ['agent'],
    });
  }

  /**
   * Find all environment variables for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Array of environment variable entities
   */
  async findAllByAgentId(agentId: string): Promise<AgentEnvironmentVariableEntity[]> {
    return await this.repository.find({ where: { agentId } });
  }

  /**
   * Find all environment variables with pagination.
   * @param limit - Maximum number of environment variables to return
   * @param offset - Number of environment variables to skip
   * @returns Array of environment variable entities
   */
  async findAll(limit = 50, offset = 0): Promise<AgentEnvironmentVariableEntity[]> {
    return await this.repository.find({
      take: limit,
      skip: offset,
      order: { createdAt: 'ASC' },
      relations: ['agent'],
    });
  }

  /**
   * Count total number of environment variables.
   * @returns Total count of environment variables
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Count environment variables for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Total count of environment variables for the agent
   */
  async countByAgentId(agentId: string): Promise<number> {
    return await this.repository.count({ where: { agentId } });
  }

  /**
   * Create a new environment variable.
   * @param dto - Data transfer object for creating a environment variable
   * @returns The created environment variable entity
   */
  async create(dto: Partial<AgentEnvironmentVariableEntity>): Promise<AgentEnvironmentVariableEntity> {
    const variable = this.repository.create(dto);

    return await this.repository.save(variable);
  }

  /**
   * Update an environment variable.
   * @param id - The UUID of the environment variable
   * @param dto - Data transfer object for updating a environment variable
   * @returns The updated environment variable entity
   */
  async update(id: string, dto: Partial<AgentEnvironmentVariableEntity>): Promise<AgentEnvironmentVariableEntity> {
    const environmentVariable = await this.findByIdOrThrow(id);

    Object.assign(environmentVariable, dto);

    return await this.repository.save(environmentVariable);
  }

  /**
   * Delete a environment variable by ID.
   * @param id - The UUID of the environment variable to delete
   * @throws NotFoundException if environment variable is not found
   */
  async delete(id: string): Promise<void> {
    const variable = await this.findByIdOrThrow(id);

    await this.repository.remove(variable);
  }

  /**
   * Delete all environment variables for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Number of environment variables deleted
   */
  async deleteByAgentId(agentId: string): Promise<number> {
    const result = await this.repository.delete({ agentId });

    return result.affected || 0;
  }
}
