import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';

import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentEnvironmentVariablesRepository } from '../repositories/agent-environment-variables.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import {
  type AgentEnvironmentVariableChangeHints,
  parseAgentEnvironmentBaseline,
  planAgentEnvironmentVariables,
  serializeAgentEnvironmentBaseline,
  shieldAgentEnvironmentVariables,
  withAgentEnvironmentLock,
} from '../utils/agent-environment-baseline.utils';

import { touchesGitCredentialEnvironment } from './agent-git-credentials.service';
import { AgentMessagesService } from './agent-messages.service';
import { AgentRuntimeRefreshService } from './agent-runtime-refresh.service';
import { AgentSessionHydrationService } from './agent-session-hydration.service';
import { DockerService, type EnvironmentApplyStrategy } from './docker.service';
import {
  EnvironmentProgressService,
  EnvironmentProgressTracker,
  RECONCILE_ENVIRONMENT_PROGRESS_STEPS,
  RESTART_ENVIRONMENT_PROGRESS_STEPS,
} from './environment-progress.service';

interface ApplyEnvironmentTarget {
  id: string;
  name: string;
  agentType: string;
}

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
    @Optional()
    private readonly environmentProgress?: EnvironmentProgressService,
    @Optional()
    private readonly agentRuntimeRefresh?: AgentRuntimeRefreshService,
  ) {}

  private startUpdateProgress(
    agentId: string,
    agentName: string,
    strategy: EnvironmentApplyStrategy,
  ): EnvironmentProgressTracker | undefined {
    return this.environmentProgress?.start({
      agentId,
      agentName,
      operation: 'update',
      steps: strategy === 'restart' ? RESTART_ENVIRONMENT_PROGRESS_STEPS : RECONCILE_ENVIRONMENT_PROGRESS_STEPS,
    });
  }

  /**
   * Apply env changes to an agent container and track progress.
   * - `restart`: the env file is rewritten and the container restarted in place (writable layer and
   *   OpenCode sessions survive, so no conversation summary is needed).
   * - `recreate`: legacy container; summarize the conversation for rehydration, then recreate it
   *   once (migrating it to the mounted environment when the image supports it).
   * Git credential files are re-provisioned when Git credentials changed, and always after a recreate
   * (the new container's writable layer no longer has them).
   * @returns The (possibly new) container ID
   */
  private async applyEnvironmentToContainer(
    agent: ApplyEnvironmentTarget,
    containerId: string,
    env: Record<string, string | undefined>,
    strategy: EnvironmentApplyStrategy,
    progress: EnvironmentProgressTracker | undefined,
  ): Promise<string> {
    if (strategy === 'recreate') {
      progress?.advance('summarizingContext');
      const summary = await this.buildHydrationSummary(agent.id, containerId, agent.agentType);

      this.agentSessionHydrationService.storePendingSummary(agent.id, summary);
      progress?.advance('recreatingContainer');
    } else {
      progress?.advance('restartingContainer');
    }

    const newContainerId = await this.dockerService.updateContainer(containerId, { env });

    this.agentRuntimeRefresh?.invalidateConnections(agent.id);

    if (strategy === 'restart') {
      progress?.advance('waitingForHealthy');
      await this.agentRuntimeRefresh?.waitForHealthy(agent.id, newContainerId);
    }

    if (strategy === 'recreate' || touchesGitCredentialEnvironment(env)) {
      progress?.advance('restoringGitCredentials');
      await this.agentRuntimeRefresh?.restoreGitCredentials(agent.id, newContainerId);
    }

    progress?.advance('finalizing');

    if (newContainerId !== containerId) {
      await this.agentsRepository.update(agent.id, { containerId: newContainerId });
    }

    await this.agentRuntimeRefresh?.reattachWatchers(agent.id);

    return newContainerId;
  }

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
      const provider = this.agentProviderFactory.getProvider(agentType || 'opencode');
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
    await this.reconcileEnvironmentVariables(agentId, { addedKeys: [variable] });

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
    const previousVariable = await this.agentEnvironmentVariablesRepository.findByIdOrThrow(id);
    const updatedVariable = await this.agentEnvironmentVariablesRepository.update(id, { variable, content });
    const renamed = previousVariable.variable !== variable;

    await this.reconcileEnvironmentVariables(
      updatedVariable.agentId,
      renamed ? { addedKeys: [variable], removedKeys: [previousVariable.variable] } : undefined,
    );

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
    await this.reconcileEnvironmentVariables(agentId, { removedKeys: [variable.variable] });
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
    const removedKeys = (await this.agentEnvironmentVariablesRepository.findAllByAgentId(agentId)).map(
      (variable) => variable.variable,
    );
    const deletedCount = await this.agentEnvironmentVariablesRepository.deleteByAgentId(agentId);

    this.logger.log(`Deleted ${deletedCount} environment variables for agent ${agentId}`);
    await this.reconcileEnvironmentVariables(agentId, { removedKeys });

    return deletedCount;
  }

  /**
   * Reconcile environment variables with the Docker container.
   * Applies all agent-level variables; variables that were removed (or renamed away) fall back to the value
   * they replaced, or are removed when the key did not exist before (see `agent-environment-baseline.utils`).
   * @param agentId - The UUID of the agent
   * @param hints - Keys added/removed by the triggering mutation (only needed for untracked legacy agents)
   * @throws NotFoundException if agent is not found or has no container
   */
  async reconcileEnvironmentVariables(agentId: string, hints?: AgentEnvironmentVariableChangeHints): Promise<void> {
    await withAgentEnvironmentLock(agentId, () => this.reconcileEnvironmentVariablesLocked(agentId, hints));
  }

  private async reconcileEnvironmentVariablesLocked(
    agentId: string,
    hints?: AgentEnvironmentVariableChangeHints,
  ): Promise<void> {
    let progress: EnvironmentProgressTracker | undefined;

    try {
      // Get the agent to find its container ID
      const agent = await this.agentsRepository.findByIdOrThrow(agentId);

      if (!agent.containerId) {
        this.logger.warn(`Agent ${agentId} has no container ID, skipping environment variable reconciliation`);

        return;
      }

      const strategy = await this.dockerService.getEnvironmentApplyStrategy(agent.containerId);

      progress = this.startUpdateProgress(agent.id, agent.name, strategy);

      // Get all environment variables for the agent
      const environmentVariables = await this.agentEnvironmentVariablesRepository.findAllByAgentId(agentId);
      // Build the environment object from the variables
      const desired: Record<string, string> = {};

      for (const variable of environmentVariables) {
        desired[variable.variable] = variable.content ?? '';
      }

      const plan = planAgentEnvironmentVariables({
        desired,
        baseline: parseAgentEnvironmentBaseline(agent.environmentVariableBaseline),
        currentEnv: await this.dockerService.getContainerEnvironmentMap(agent.containerId),
        hints,
      });
      const newContainerId = await this.applyEnvironmentToContainer(
        agent,
        agent.containerId,
        plan.env,
        strategy,
        progress,
      );

      await this.agentsRepository.update(agentId, {
        environmentVariableBaseline: serializeAgentEnvironmentBaseline(plan.baseline),
      });
      progress?.complete();

      this.logger.log(
        `Reconciled ${environmentVariables.length} environment variables for agent ${agentId} (container ${agent.containerId} -> ${newContainerId})`,
      );
    } catch (error: unknown) {
      progress?.fail(error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error reconciling environment variables for agent ${agentId}: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Apply changed override keys to every agent container whose environment contains one of them
   * (restart in place, or a one-time recreate for legacy containers).
   * All affected environments are announced as queued update operations up front so clients can
   * render progress for the whole mass update; they are then processed sequentially.
   * @param changedEnv - Changed override keys (undefined value removes the key)
   */
  async reconcileWorkspaceConfigurationOverrides(changedEnv: Record<string, string | undefined>): Promise<void> {
    const changedKeys = Object.keys(changedEnv);

    if (changedKeys.length === 0) {
      return;
    }

    const agents = await this.agentsRepository.findAllWithContainers();
    const pending: Array<{
      agent: (typeof agents)[number];
      containerId: string;
      relevantOverrides: Record<string, string | undefined>;
      strategy: EnvironmentApplyStrategy;
      progress?: EnvironmentProgressTracker;
    }> = [];

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

      const shielded = shieldAgentEnvironmentVariables(
        relevantOverrides,
        parseAgentEnvironmentBaseline(agent.environmentVariableBaseline),
        { onlyExistingKeys: true },
      );

      if (Object.keys(shielded.env).length === 0) {
        // Only keys controlled by agent-level variables changed: record the new fallback values, no restart.
        await this.applyWorkspaceOverridesToBaseline(agent.id, relevantOverrides);
        continue;
      }

      const strategy = await this.dockerService.getEnvironmentApplyStrategy(agent.containerId);

      pending.push({ agent, containerId: agent.containerId, relevantOverrides, strategy });
    }

    for (const item of pending) {
      item.progress = this.startUpdateProgress(item.agent.id, item.agent.name, item.strategy);
    }

    let index = 0;

    try {
      for (; index < pending.length; index++) {
        const { agent, containerId, relevantOverrides, strategy, progress } = pending[index];

        try {
          const newContainerId = await withAgentEnvironmentLock(agent.id, async () => {
            const current = await this.agentsRepository.findByIdOrThrow(agent.id);
            const shielded = shieldAgentEnvironmentVariables(
              relevantOverrides,
              parseAgentEnvironmentBaseline(current.environmentVariableBaseline),
              { onlyExistingKeys: true },
            );
            const appliedContainerId =
              Object.keys(shielded.env).length > 0
                ? await this.applyEnvironmentToContainer(agent, containerId, shielded.env, strategy, progress)
                : containerId;

            if (shielded.baselineChanged && shielded.baseline) {
              await this.agentsRepository.update(agent.id, {
                environmentVariableBaseline: serializeAgentEnvironmentBaseline(shielded.baseline),
              });
            }

            return appliedContainerId;
          });

          progress?.complete();
          this.logger.log(
            `Reconciled workspace configuration overrides for agent ${agent.id} (container ${containerId} -> ${newContainerId})`,
          );
        } catch (error: unknown) {
          progress?.fail(error);

          throw error;
        }
      }
    } finally {
      // An earlier failure aborts the mass update; release the remaining queued operations.
      for (let rest = index + 1; rest < pending.length; rest++) {
        pending[rest].progress?.fail('Aborted after a previous environment failed to update');
      }
    }
  }

  /** Record changed workspace overrides as fallback values of keys controlled by agent-level variables. */
  private async applyWorkspaceOverridesToBaseline(
    agentId: string,
    overrides: Record<string, string | undefined>,
  ): Promise<void> {
    await withAgentEnvironmentLock(agentId, async () => {
      const agent = await this.agentsRepository.findByIdOrThrow(agentId);
      const shielded = shieldAgentEnvironmentVariables(
        overrides,
        parseAgentEnvironmentBaseline(agent.environmentVariableBaseline),
        { onlyExistingKeys: true },
      );

      if (shielded.baselineChanged && shielded.baseline) {
        await this.agentsRepository.update(agentId, {
          environmentVariableBaseline: serializeAgentEnvironmentBaseline(shielded.baseline),
        });
      }
    });
  }
}
