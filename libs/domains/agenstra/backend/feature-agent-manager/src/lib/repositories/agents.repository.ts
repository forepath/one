import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import { AgentEntity } from '../entities/agent.entity';

/**
 * Repository for agent database operations.
 * Abstracts TypeORM-specific details and provides intention-revealing methods.
 */
@Injectable()
export class AgentsRepository {
  constructor(
    @InjectRepository(AgentEntity)
    private readonly repository: Repository<AgentEntity>,
  ) {}

  /**
   * Find an agent by ID.
   * @param id - The UUID of the agent
   * @returns The agent entity if found
   * @throws NotFoundException if agent is not found
   */
  async findByIdOrThrow(id: string): Promise<AgentEntity> {
    const agent = await this.repository.findOne({ where: { id } });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    return agent;
  }

  /**
   * Find an agent by ID without throwing an error.
   * @param id - The UUID of the agent
   * @returns The agent entity if found, null otherwise
   */
  async findById(id: string): Promise<AgentEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find an agent by name.
   * @param name - The name of the agent
   * @returns The agent entity if found, null otherwise
   */
  async findByName(name: string): Promise<AgentEntity | null> {
    return await this.repository.findOne({ where: { name } });
  }

  /**
   * Find all agents with pagination.
   * @param limit - Maximum number of agents to return
   * @param offset - Number of agents to skip
   * @returns Array of agent entities
   */
  async findAll(limit = 10, offset = 0): Promise<AgentEntity[]> {
    return await this.repository.find({
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find all agents that have container IDs (agent containers and VNC containers).
   * Used for restarting containers on service startup.
   * @returns Array of agent entities with containerId or vncContainerId
   */
  async findAllWithContainers(): Promise<AgentEntity[]> {
    return await this.repository.find({
      where: [{ containerId: Not(IsNull()) }, { vncContainerId: Not(IsNull()) }, { sshContainerId: Not(IsNull()) }],
    });
  }

  /**
   * Check if a port is in use by an agent.
   * @param port - The port to check
   * @returns True if the port is in use, false otherwise
   */
  async findPortInUse(port: number): Promise<boolean> {
    const agent = await this.repository.findOne({ where: [{ vncHostPort: port }, { sshHostPort: port }] });

    return agent !== null;
  }

  /**
   * Count total number of agents.
   * @returns Total count of agents
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Create a new agent.
   * @param dto - Data transfer object for creating an agent
   * @returns The created agent entity
   */
  async create(dto: Partial<AgentEntity>): Promise<AgentEntity> {
    const agent = this.repository.create(dto);

    return await this.repository.save(agent);
  }

  /**
   * Update an existing agent.
   * @param id - The UUID of the agent to update
   * @param dto - Data transfer object for updating an agent
   * @returns The updated agent entity
   * @throws NotFoundException if agent is not found
   */
  async update(id: string, dto: Partial<AgentEntity>): Promise<AgentEntity> {
    const agent = await this.findByIdOrThrow(id);

    Object.assign(agent, dto);

    return await this.repository.save(agent);
  }

  /**
   * Delete an agent by ID.
   * @param id - The UUID of the agent to delete
   * @throws NotFoundException if agent is not found
   */
  async delete(id: string): Promise<void> {
    const agent = await this.findByIdOrThrow(id);

    await this.repository.remove(agent);
  }
}
