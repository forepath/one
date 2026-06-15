import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentEnvironmentVariablesRepository } from '../repositories/agent-environment-variables.repository';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentMessagesService } from './agent-messages.service';
import { AgentSessionHydrationService } from './agent-session-hydration.service';
import { DockerService } from './docker.service';

/**
 * Service for agent environment variables business logic operations.
 * Orchestrates repository operations for persisting and retrieving agent environment variables.
 */
@Injectable()
export class AgentEnvironmentVariablesService {
  private readonly logger = new Logger(AgentEnvironmentVariablesService.name);

  constructor(
    private readonly agentEnvironmentVariablesRepository: AgentEnvironmentVariablesRepository,
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly agentMessagesService: AgentMessagesService,
    private readonly agentProviderFactory: AgentProviderFactory,
    private readonly agentSessionHydrationService: AgentSessionHydrationService,
  ) {}

  private buildFallbackSummary(lines: Array<{ actor: string; message: string }>): string {
    if (lines.length === 0) {
      return 'No prior chat history was available before container recreation.';
    }

    return lines
      .map((line) => {
        const actorLabel = line.actor === 'agent' ? 'Agent' : 'User';

        return `- ${actorLabel}: ${line.message}`;
      })
      .join('\n');
  }

  private async buildHydrationSummary(
    agentId: string,
    containerId: string,
    agentType: string,
    model?: string,
  ): Promise<string> {
    const totalCount = await this.agentMessagesService.countMessages(agentId);
    const limit = 20;
    const offset = Math.max(0, totalCount - limit);
    const chatHistory = await this.agentMessagesService.getChatHistory(agentId, limit, offset);
    const lines = chatHistory
      .map((entry) => ({ actor: entry.actor, message: entry.message.trim() }))
      .filter((entry) => entry.message.length > 0);
    const fallbackSummary = this.buildFallbackSummary(lines);

    if (lines.length === 0) {
      return fallbackSummary;
    }

    const transcript = lines.map((line) => `${line.actor === 'agent' ? 'Agent' : 'User'}: ${line.message}`).join('\n');
    const summarizePrompt = [
      'Summarize this conversation for session rehydration after container recreation.',
      'Return concise bullet points with goals, decisions, constraints, and pending tasks.',
      'Do not invent details.',
      '',
      transcript,
    ].join('\n');

    try {
      const provider = this.agentProviderFactory.getProvider(agentType || 'cursor');
      const raw = await provider.sendMessage(agentId, containerId, summarizePrompt, model ? { model } : {});
      const parseable = provider.toParseableStrings(raw);

      for (const line of parseable) {
        const unified = provider.toUnifiedResponse(line);
        const result = typeof unified?.result === 'string' ? unified.result.trim() : '';

        if (result.length > 0) {
          return result;
        }
      }

      const firstNonEmpty = parseable.map((line) => line.trim()).find((line) => line.length > 0);

      return firstNonEmpty ?? fallbackSummary;
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };

      this.logger.warn(
        `Failed to summarize chat context for agent ${agentId}, using fallback: ${err.message}`,
        err.stack,
      );

      return fallbackSummary;
    }
  }

  /**
   * Persist an environment variable.
   * @param agentId - The UUID of the agent
   * @param variable - The variable name
   * @param content - The variable content
   * @returns The created environment variable entity
   */
  async createEnvironmentVariable(
    agentId: string,
    variable: string,
    content: string,
  ): Promise<AgentEnvironmentVariableEntity> {
    const environmentVariableEntity = await this.agentEnvironmentVariablesRepository.create({
      agentId,
      variable,
      content,
    });

    this.logger.debug(`Persisted environment variable for agent ${agentId}`);
    await this.reconcileEnvironmentVariables(agentId);

    return environmentVariableEntity;
  }

  /**
   * Update an environment variable.
   * @param id - The UUID of the environment variable
   * @param variable - The variable name
   * @param content - The variable content
   * @returns The updated environment variable entity
   */
  async updateEnvironmentVariable(
    id: string,
    variable: string,
    content: string,
  ): Promise<AgentEnvironmentVariableEntity> {
    const updatedVariable = await this.agentEnvironmentVariablesRepository.update(id, { variable, content });

    await this.reconcileEnvironmentVariables(updatedVariable.agentId);

    return updatedVariable;
  }

  /**
   * Delete an environment variable by ID.
   * @param id - The UUID of the environment variable to delete
   * @throws NotFoundException if environment variable is not found
   */
  async deleteEnvironmentVariable(id: string): Promise<void> {
    // Get the variable first to know which agent it belongs to
    const variable = await this.agentEnvironmentVariablesRepository.findByIdOrThrow(id);
    const agentId = variable.agentId;

    this.logger.log(`Deleting environment variable ${id}`);
    await this.agentEnvironmentVariablesRepository.delete(id);
    await this.reconcileEnvironmentVariables(agentId);
  }

  /**
   * Get environment variables for a specific agent.
   * @param agentId - The UUID of the agent
   * @param limit - Maximum number of environment variables to return
   * @param offset - Number of environment variables to skip
   * @returns Array of environment variable entities ordered chronologically
   */
  async getEnvironmentVariables(agentId: string, limit = 50, offset = 0): Promise<AgentEnvironmentVariableEntity[]> {
    return await this.agentEnvironmentVariablesRepository.findByAgentId(agentId, limit, offset);
  }

  /**
   * Count environment variables for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Total count of environment variables for the agent
   */
  async countEnvironmentVariables(agentId: string): Promise<number> {
    return await this.agentEnvironmentVariablesRepository.countByAgentId(agentId);
  }

  /**
   * Delete all environment variables for a specific agent.
   * @param agentId - The UUID of the agent
   * @returns Number of environment variables deleted
   */
  async deleteAllEnvironmentVariables(agentId: string): Promise<number> {
    const deletedCount = await this.agentEnvironmentVariablesRepository.deleteByAgentId(agentId);

    this.logger.log(`Deleted ${deletedCount} environment variables for agent ${agentId}`);
    await this.reconcileEnvironmentVariables(agentId);

    return deletedCount;
  }

  /**
   * Reconcile environment variables with the Docker container.
   * Fetches all environment variables for an agent and updates the container's environment.
   * @param agentId - The UUID of the agent
   * @throws NotFoundException if agent is not found or has no container
   */
  async reconcileEnvironmentVariables(agentId: string): Promise<void> {
    try {
      // Get the agent to find its container ID
      const agent = await this.agentsRepository.findByIdOrThrow(agentId);

      if (!agent.containerId) {
        this.logger.warn(`Agent ${agentId} has no container ID, skipping environment variable reconciliation`);

        return;
      }

      // Get all environment variables for the agent
      const environmentVariables = await this.agentEnvironmentVariablesRepository.findAllByAgentId(agentId);
      // Build the environment object from the variables
      const env: Record<string, string> = {};

      for (const variable of environmentVariables) {
        env[variable.variable] = variable.content ?? '';
      }

      const summary = await this.buildHydrationSummary(agent.id, agent.containerId, agent.agentType);

      this.agentSessionHydrationService.storePendingSummary(agentId, summary);

      // Update the container's environment (this recreates the container)
      const newContainerId = await this.dockerService.updateContainer(agent.containerId, { env });

      // Update the agent's container ID in the database since the container was recreated
      await this.agentsRepository.update(agentId, { containerId: newContainerId });

      this.logger.log(
        `Reconciled ${environmentVariables.length} environment variables for agent ${agentId} (container ${agent.containerId} -> ${newContainerId})`,
      );
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error reconciling environment variables for agent ${agentId}: ${err.message}`, err.stack);
      throw error;
    }
  }

  async reconcileWorkspaceConfigurationOverrides(changedEnv: Record<string, string | undefined>): Promise<void> {
    const changedKeys = Object.keys(changedEnv);

    if (changedKeys.length === 0) {
      return;
    }

    const agents = await this.agentsRepository.findAllWithContainers();

    for (const agent of agents) {
      if (!agent.containerId) {
        continue;
      }

      const currentContainerEnv = await this.dockerService.getContainerEnvironmentMap(agent.containerId);
      const relevantOverrides: Record<string, string | undefined> = {};

      for (const key of changedKeys) {
        if (key in currentContainerEnv) {
          relevantOverrides[key] = changedEnv[key];
        }
      }

      if (Object.keys(relevantOverrides).length === 0) {
        continue;
      }

      const summary = await this.buildHydrationSummary(agent.id, agent.containerId, agent.agentType);

      this.agentSessionHydrationService.storePendingSummary(agent.id, summary);

      const newContainerId = await this.dockerService.updateContainer(agent.containerId, { env: relevantOverrides });

      await this.agentsRepository.update(agent.id, { containerId: newContainerId });
      this.logger.log(
        `Reconciled workspace configuration overrides for agent ${agent.id} (container ${agent.containerId} -> ${newContainerId})`,
      );
    }
  }
}
