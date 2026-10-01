import { Injectable } from '@nestjs/common';

import {
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderModels,
  AgentProviderOptions,
  AgentResponseObject,
} from '../agent-provider.interface';
import { OpenCodeRuntimeService } from '../opencode/opencode-runtime.service';

/**
 * OpenCode agent provider implementation.
 * Handles communication with `opencode serve` in Docker containers via HTTP SDK.
 */
@Injectable()
export class OpenCodeAgentProvider implements AgentProvider {
  private static readonly TYPE = 'opencode';
  private static readonly LIST_MODELS_COMMAND = 'opencode models';

  constructor(private readonly runtime: OpenCodeRuntimeService) {}

  /**
   * Get the unique type identifier for this provider.
   * @returns 'opencode'
   */
  getType(): string {
    return OpenCodeAgentProvider.TYPE;
  }

  /**
   * Get the human-readable display name for this provider.
   * @returns 'OpenCode'
   */
  getDisplayName(): string {
    return 'OpenCode';
  }

  getCapabilities(): AgentProviderCapabilities {
    return {
      transport: 'opencode-http',
      supportsChat: true,
      supportsStreaming: true,
      supportsToolEvents: true,
      supportsQuestions: true,
    };
  }

  async *streamChatEvents(
    agentId: string,
    containerId: string,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<AgentResponseObject> {
    yield* this.runtime.streamChatEvents(
      { agentId, containerId, resumeSessionSuffix: options?.resumeSessionSuffix },
      message,
      options,
    );
  }

  /**
   * Get the base path for the provider.
   * This is used to construct the API base URL.
   * @returns The base path string (e.g., '/app')
   */
  getBasePath(): string {
    return '/app';
  }

  /**
   * Get the base path for the provider's configuration.
   * This is used to construct the API base URL for the provider's configuration.
   * @returns The base path string (e.g., '~/.config/opencode')
   */
  getConfigBasePath(): string {
    return '~/.config/opencode';
  }

  /**
   * Get the Docker image (including tag) to use for opencode agent containers.
   * @returns The Docker image string
   */
  getDockerImage(): string {
    return process.env.OPENCODE_AGENT_DOCKER_IMAGE || 'ghcr.io/forepath/agenstra-manager-worker:latest';
  }

  /**
   * Get the command to list models.
   * @returns The command to list models
   */
  getModelsListCommand(): string {
    return OpenCodeAgentProvider.LIST_MODELS_COMMAND;
  }

  /**
   * Parse the result of the models list command.
   * Each non-empty line is a model id; id and display name are the same string.
   * @param result - The result of the models list command
   * @returns The list of models
   */
  toModelsList(result: string): AgentProviderModels {
    const models: AgentProviderModels = {};

    if (!result?.trim()) {
      return models;
    }

    // ESC via fromCharCode — eslint no-control-regex rejects \u001b / \x1b in literals.
    const ansiCsi = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

    for (const line of result.split(/\r?\n/)) {
      // Strip ANSI + non-printable leftovers from docker exec demux / TTY noise.
      const trimmed = line
        .replace(ansiCsi, '')
        .replace(/[^\x20-\x7E._/+:-]+/g, '')
        .trim();

      if (trimmed) {
        models[trimmed] = trimmed;
      }
    }

    return models;
  }

  async sendMessage(
    agentId: string,
    containerId: string,
    message: string,
    options?: AgentProviderOptions,
  ): Promise<string> {
    return this.runtime.sendMessage(
      { agentId, containerId, resumeSessionSuffix: options?.resumeSessionSuffix },
      message,
      options,
    );
  }

  async *sendMessageStream(
    agentId: string,
    containerId: string,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<string> {
    yield* this.runtime.sendMessageStream(
      { agentId, containerId, resumeSessionSuffix: options?.resumeSessionSuffix },
      message,
      options,
    );
  }

  /**
   * Send an initialization message to the opencode server.
   * This establishes system context for the agent.
   */
  async sendInitialization(agentId: string, containerId: string, options?: AgentProviderOptions): Promise<void> {
    await this.runtime.sendInitialization(
      { agentId, containerId, resumeSessionSuffix: options?.resumeSessionSuffix },
      options,
    );
  }

  /**
   * Convert the response from the agent to parseable strings.
   * Removes all characters that are not UTF-8 supported.
   * @param response - The response from the agent
   * @returns Array of parseable strings with only valid UTF-8 characters
   */
  toParseableStrings(response: string): string[] {
    return response
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Convert the response from the agent to a unified response object.
   * @param response - The response from the agent
   * @returns The unified response object
   */
  toUnifiedResponse(response: string): AgentResponseObject | undefined {
    return JSON.parse(response) as AgentResponseObject;
  }

  buildModelsCommand(): string {
    return `opencode models`;
  }
}
