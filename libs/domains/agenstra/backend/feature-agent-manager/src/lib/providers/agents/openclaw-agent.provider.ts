import { Injectable } from '@nestjs/common';

import {
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderModels,
  AgentProviderOptions,
  AgentResponseObject,
} from '../agent-provider.interface';

/**
 * OpenClaw agent provider implementation.
 * Handles communication with the openclaw agent binary running in Docker containers.
 */
@Injectable()
export class OpenClawAgentProvider implements AgentProvider {
  private static readonly TYPE = 'openclaw';

  /**
   * Get the unique type identifier for this provider.
   * @returns 'openclaw'
   */
  getType(): string {
    return OpenClawAgentProvider.TYPE;
  }

  /**
   * Get the human-readable display name for this provider.
   * @returns 'OpenClaw'
   */
  getDisplayName(): string {
    return 'OpenClaw';
  }

  getCapabilities(): AgentProviderCapabilities {
    return {
      supportsChat: false,
      supportsStreaming: false,
      supportsToolEvents: false,
      supportsQuestions: false,
    };
  }

  /**
   * Get the base path for the provider.
   * This is used to construct the API base URL.
   * @returns The base path string (e.g., '/openclaw')
   */
  getBasePath(): string {
    return '/openclaw';
  }

  /**
   * Get the path to the repository relative to the base path for the provider.
   * This is used to construct the repository path within agent containers.
   * @returns The repository path string (e.g., '/workspace'). Defaults to '' if not implemented.
   */
  getRepositoryPath(): string {
    return '/workspace';
  }

  getEnvironmentVariables(): Record<string, string> {
    function randomString(length = 32): string {
      let result = '';
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const charactersLength = characters.length;

      for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
      }

      return result;
    }

    return {
      OPENCLAW_GATEWAY_TOKEN: randomString(),
    };
  }

  /**
   * Get the Docker image (including tag) to use for openclaw agent containers.
   * @returns The Docker image string
   */
  getDockerImage(): string {
    return process.env.OPENCLAW_AGENT_DOCKER_IMAGE || 'ghcr.io/forepath/agenstra-manager-agi:latest';
  }

  /**
   * Get the Docker image (including tag) to use for virtual workspace containers created for this provider.
   * @returns The Docker image string
   */
  getVirtualWorkspaceDockerImage(): string {
    return process.env.OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE || 'ghcr.io/forepath/agenstra-manager-vnc:latest';
  }

  /**
   * Get the Docker image (including tag) to use for SSH connection containers created for this provider.
   * @returns The Docker image string
   */
  getSshConnectionDockerImage(): string {
    return process.env.OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE || 'ghcr.io/forepath/agenstra-manager-ssh:latest';
  }

  /**
   * Get the command to list models.
   * @returns The command to list models
   */
  getModelsListCommand(): string {
    throw new Error('Not implemented');
  }

  /**
   * Parse the result of the models list command.
   * @param result - The result of the models list command
   * @returns The list of models
   */
  toModelsList(_result: string): AgentProviderModels {
    throw new Error('Not implemented');
  }

  /**
   * Send a message to the openclaw-agent and get a response.
   * @param agentId - The UUID of the agent
   * @param containerId - The Docker container ID where the agent is running
   * @param message - The message to send to the agent
   * @param options - Optional configuration (e.g., model name)
   * @returns The agent's response as a string
   */
  async sendMessage(
    _agentId: string,
    _containerId: string,
    _message: string,
    _options?: AgentProviderOptions,
  ): Promise<string> {
    throw new Error('Not implemented');
  }

  /**
   * Send an initialization message to the openclaw-agent.
   * This establishes system context for the agent.
   * @param _agentId - The UUID of the agent (unused for openclaw)
   * @param _containerId - The Docker container ID where the agent is running (unused for openclaw)
   * @param _options - Optional configuration (e.g., model name) (unused for openclaw)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async sendInitialization(_agentId: string, _containerId: string, _options?: AgentProviderOptions): Promise<void> {
    throw new Error('Not implemented');
  }

  /**
   * Convert the response from the agent to parseable strings.
   * Removes all characters that are not UTF-8 supported.
   * @param response - The response from the agent
   * @returns Array of parseable strings with only valid UTF-8 characters
   */
  toParseableStrings(_response: string): string[] {
    throw new Error('Not implemented');
  }

  /**
   * Convert the response from the agent to a unified response object.
   * @param response - The response from the agent
   * @returns The unified response object
   */
  toUnifiedResponse(_response: string): AgentResponseObject {
    throw new Error('Not implemented');
  }
}
