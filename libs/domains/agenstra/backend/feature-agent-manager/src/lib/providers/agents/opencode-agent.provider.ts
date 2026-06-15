import { Injectable } from '@nestjs/common';

import { DockerService } from '../../services/docker.service';
import {
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderModels,
  AgentProviderOptions,
  AgentResponseObject,
} from '../agent-provider.interface';

/**
 * OpenCode agent provider implementation.
 * Handles communication with the opencode agent binary running in Docker containers.
 */
@Injectable()
export class OpenCodeAgentProvider implements AgentProvider {
  private static readonly TYPE = 'opencode';
  private static readonly LIST_MODELS_COMMAND = 'opencode models';

  constructor(private readonly dockerService: DockerService) {}

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
      supportsChat: true,
      supportsStreaming: true,
      supportsToolEvents: true,
      supportsQuestions: true,
    };
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

    for (const line of result.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (trimmed) {
        models[trimmed] = trimmed;
      }
    }

    return models;
  }

  /**
   * Send a message to the opencode-agent and get a response.
   * @param agentId - The UUID of the agent
   * @param containerId - The Docker container ID where the agent is running
   * @param message - The message to send to the agent
   * @param options - Optional configuration (e.g., model name)
   * @returns The agent's response as a string
   */
  private buildRunCommand(options?: AgentProviderOptions): string {
    let command = `opencode run --format json`;

    if (options?.continue === undefined || options?.continue === true) {
      command += ` --continue`;
    }

    if (options?.model && options.model !== 'auto') {
      command += ` --model ${options.model}`;
    }

    return command;
  }

  private wantsSessionContinue(options?: AgentProviderOptions): boolean {
    return options?.continue === undefined || options?.continue === true;
  }

  async sendMessage(
    agentId: string,
    containerId: string,
    message: string,
    options?: AgentProviderOptions,
  ): Promise<string> {
    const command = this.buildRunCommand(options);
    const response = await this.dockerService.sendCommandToContainer(containerId, command, message);

    if (response.includes('Session not found') && this.wantsSessionContinue(options)) {
      return this.sendMessage(agentId, containerId, message, {
        ...options,
        continue: false,
      });
    }

    return response;
  }

  async *sendMessageStream(
    _agentId: string,
    containerId: string,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<string> {
    const streamOnce = (opts?: AgentProviderOptions): AsyncIterable<{ stream: 'stdout' | 'stderr'; chunk: string }> =>
      this.dockerService.execCommandStream(containerId, this.buildRunCommand(opts), message);
    const chunks: string[] = [];

    for await (const { stream, chunk } of streamOnce(options)) {
      if (stream === 'stdout') {
        chunks.push(chunk);
        yield chunk;
      }
    }

    const combined = chunks.join('');

    if (combined.includes('Session not found') && this.wantsSessionContinue(options)) {
      for await (const { stream, chunk } of streamOnce({ ...options, continue: false })) {
        if (stream === 'stdout') {
          yield chunk;
        }
      }
    }
  }

  /**
   * Send an initialization message to the opencode-agent.
   * This establishes system context for the agent.
   * @param _agentId - The UUID of the agent (unused for opencode)
   * @param _containerId - The Docker container ID where the agent is running (unused for opencode)
   * @param _options - Optional configuration (e.g., model name) (unused for opencode)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async sendInitialization(_agentId: string, _containerId: string, _options?: AgentProviderOptions): Promise<void> {
    return;
  }

  /**
   * Convert the response from the agent to parseable strings.
   * Removes all characters that are not UTF-8 supported.
   * @param response - The response from the agent
   * @returns Array of parseable strings with only valid UTF-8 characters
   */
  toParseableStrings(response: string): string[] {
    const lines = response.split('\n');

    if (lines.length === 0) {
      return [];
    }

    const result: string[] = [];

    for (const line of lines) {
      let toParse = line.trim();
      const firstBrace = toParse.indexOf('{');

      if (firstBrace !== -1) {
        toParse = toParse.slice(firstBrace);
      }

      const lastBrace = toParse.lastIndexOf('}');

      if (lastBrace !== -1) {
        toParse = toParse.slice(0, lastBrace + 1);
      }

      if (!toParse.includes('{')) {
        continue;
      }

      try {
        const parsed = JSON.parse(toParse) as {
          type?: string;
          part?: {
            type?: string;
            text?: string;
            callID?: string;
            tool?: string;
            state?: { status?: string; input?: unknown };
          };
        };

        if (!parsed.type) {
          continue;
        }

        if (parsed.type === 'text') {
          if (parsed.part?.type === 'text' && typeof parsed.part.text === 'string' && parsed.part.text !== '') {
            result.push(toParse);
          }
        } else if (parsed.type === 'tool_use') {
          const part = parsed.part;

          if (
            part?.type === 'tool' &&
            typeof part.callID === 'string' &&
            typeof part.tool === 'string' &&
            part.callID.length > 0 &&
            part.tool.length > 0
          ) {
            const toolCallFrame = {
              type: 'tool_call',
              toolCallId: part.callID,
              name: part.tool,
              args: part.state?.input,
              status: OpenCodeAgentProvider.mapOpenCodeToolLifecycleStatus(part.state?.status),
            };

            result.push(JSON.stringify(toolCallFrame));
          }

          result.push(toParse);
        } else if (parsed.type === 'error') {
          result.push(toParse);
        }
      } catch {
        continue;
      }
    }

    return result;
  }

  private static mapOpenCodeToolLifecycleStatus(status: unknown): 'started' | 'inProgress' | 'succeeded' | 'failed' {
    const s = typeof status === 'string' ? status.toLowerCase() : '';

    if (s === 'completed' || s === 'success' || s === 'succeeded') {
      return 'succeeded';
    }

    if (s === 'failed' || s === 'error') {
      return 'failed';
    }

    if (s === 'started' || s === 'running' || s === 'pending') {
      return 'inProgress';
    }

    return 'inProgress';
  }

  /**
   * Convert the response from the agent to a unified response object.
   * @param response - The response from the agent
   * @returns The unified response object
   */
  toUnifiedResponse(response: string): AgentResponseObject | undefined {
    const responseObject = JSON.parse(response) as {
      type: string;
      timestamp?: number;
      sessionID?: string;
      part?: {
        id?: string;
        sessionID?: string;
        messageID?: string;
        type?: string;
        text?: string;
        callID?: string;
        tool?: string;
        state?: {
          status?: string;
          input?: unknown;
          output?: unknown;
          title?: string;
          metadata?: Record<string, unknown>;
        };
        time?: {
          start: number;
          end: number;
        };
      };
      error?: {
        name?: string;
        data?: { message?: string };
      };
    };

    if (responseObject.type === 'text' && responseObject.part?.type === 'text') {
      return {
        type: 'result',
        subtype: 'success',
        result: responseObject.part.text ?? '',
      };
    }

    if (responseObject.type === 'tool_call') {
      const o = responseObject as unknown as {
        toolCallId?: unknown;
        name?: unknown;
        args?: unknown;
        status?: unknown;
      };

      if (typeof o.toolCallId !== 'string' || typeof o.name !== 'string') {
        return undefined;
      }

      const st = o.status;
      const status =
        st === 'started' || st === 'inProgress' || st === 'succeeded' || st === 'failed' ? st : 'inProgress';

      return {
        type: 'tool_call',
        toolCallId: o.toolCallId,
        name: o.name,
        ...(o.args !== undefined ? { args: o.args } : {}),
        status,
      };
    }

    if (responseObject.type === 'tool_use' && responseObject.part?.type === 'tool') {
      const part = responseObject.part;

      if (typeof part.callID !== 'string' || typeof part.tool !== 'string') {
        return undefined;
      }

      const exit = part.state?.metadata?.exit;
      const isError = typeof exit === 'number' && exit !== 0;

      return {
        type: 'tool_result',
        toolCallId: part.callID,
        name: part.tool,
        result: {
          output: part.state?.output,
          input: part.state?.input,
          title: part.state?.title,
          metadata: part.state?.metadata,
        },
        isError,
      };
    }

    if (responseObject.type === 'error') {
      const message =
        typeof responseObject.error?.data?.message === 'string'
          ? responseObject.error.data.message
          : typeof responseObject.error?.name === 'string'
            ? responseObject.error.name
            : 'OpenCode error';

      return {
        type: 'error',
        is_error: true,
        result: message,
      };
    }

    return undefined;
  }

  buildModelsCommand(): string {
    return `opencode models`;
  }
}
