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
   * Find all agents that have a worker container ID.
   * Used for restarting containers on service startup.
   * @returns Array of agent entities with containerId
   */
  async findAllWithContainers(): Promise<AgentEntity[]> {
    return await this.repository.find({
      where: [{ containerId: Not(IsNull()) }],
    });
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

  private acpSessionMapKey(resumeSessionSuffix?: string): string {
    return resumeSessionSuffix ?? '';
  }

  /**
   * Return a persisted ACP session id for the given suffix when the container still matches.
   * Empty / omitted suffix is the primary chat session.
   */
  async findPersistedAcpSessionId(
    agentId: string,
    containerId: string,
    resumeSessionSuffix?: string,
  ): Promise<string | null> {
    const agent = await this.findById(agentId);

    if (!agent?.acpSessionContainerId || agent.acpSessionContainerId !== containerId) {
      return null;
    }

    const sessionId = agent.acpSessions?.[this.acpSessionMapKey(resumeSessionSuffix)];

    return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
  }

  /**
   * Persist an ACP session id for a suffix (overwrites that key only).
   * When the container id changes, previous suffix entries are discarded.
   */
  async saveAcpSession(
    agentId: string,
    containerId: string,
    acpSessionId: string,
    resumeSessionSuffix?: string,
  ): Promise<void> {
    const agent = await this.findById(agentId);
    const mapKey = this.acpSessionMapKey(resumeSessionSuffix);
    const sessions = agent?.acpSessionContainerId === containerId && agent.acpSessions ? { ...agent.acpSessions } : {};

    sessions[mapKey] = acpSessionId;

    await this.repository.update(agentId, {
      acpSessions: sessions,
      acpSessionContainerId: containerId,
    });
  }

  /**
   * Clear a persisted ACP session for one suffix (e.g. after prompt/transport failure).
   * When the map becomes empty, also clear the container binding.
   */
  async clearAcpSession(agentId: string, resumeSessionSuffix?: string): Promise<void> {
    const agent = await this.findById(agentId);

    if (!agent) {
      return;
    }

    const mapKey = this.acpSessionMapKey(resumeSessionSuffix);
    const sessions = { ...(agent.acpSessions ?? {}) };

    delete sessions[mapKey];

    const remainingKeys = Object.keys(sessions);

    await this.repository.update(agentId, {
      acpSessions: remainingKeys.length > 0 ? sessions : null,
      acpSessionContainerId: remainingKeys.length > 0 ? agent.acpSessionContainerId : null,
    });
  }
}
