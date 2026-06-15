import { Injectable, Logger } from '@nestjs/common';

import { DockerService } from '../../services/docker.service';
import {
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderModels,
  AgentProviderOptions,
  AgentResponseObject,
} from '../agent-provider.interface';

/**
 * Cursor-agent provider implementation.
 * Handles communication with the cursor-agent binary running in Docker containers.
 */
@Injectable()
export class CursorAgentProvider implements AgentProvider {
  private readonly logger = new Logger(CursorAgentProvider.name);
  private static readonly TYPE = 'cursor';
  private static readonly LIST_MODELS_COMMAND = 'cursor-agent --list-models';

  constructor(private readonly dockerService: DockerService) {}

  /**
   * Get the unique type identifier for this provider.
   * @returns 'cursor'
   */
  getType(): string {
    return CursorAgentProvider.TYPE;
  }

  /**
   * Get the human-readable display name for this provider.
   * @returns 'Cursor'
   */
  getDisplayName(): string {
    return 'Cursor';
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
   * @returns The base path string (e.g., '~/.cursor')
   */
  getConfigBasePath(): string {
    return '~/.cursor';
  }

  /**
   * Get the Docker image (including tag) to use for cursor-agent containers.
   * @returns The Docker image string
   */
  getDockerImage(): string {
    return process.env.CURSOR_AGENT_DOCKER_IMAGE || 'ghcr.io/forepath/agenstra-manager-worker:latest';
  }

  /**
   * Get the Docker image (including tag) to use for virtual workspace containers created for this provider.
   * @returns The Docker image string
   */
  getVirtualWorkspaceDockerImage(): string {
    return process.env.CURSOR_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE || 'ghcr.io/forepath/agenstra-manager-vnc:latest';
  }

  /**
   * Get the Docker image (including tag) to use for SSH connection containers created for this provider.
   * @returns The Docker image string
   */
  getSshConnectionDockerImage(): string {
    return process.env.CURSOR_AGENT_SSH_CONNECTION_DOCKER_IMAGE || 'ghcr.io/forepath/agenstra-manager-ssh:latest';
  }

  /**
   * Get the command to list models.
   * @returns The command to list models
   */
  getModelsListCommand(): string {
    return CursorAgentProvider.LIST_MODELS_COMMAND;
  }

  private static readonly MODEL_LINE_SEPARATOR = ' - ';

  /** ANSI CSI sequences; ESC from char code to satisfy eslint no-control-regex. */
  private static readonly ANSI_CSI_ESCAPE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z]`, 'g');

  /**
   * Strip ANSI CSI escape sequences (e.g. cursor movement / clear line) from CLI output.
   */
  private static stripAnsiSequences(text: string): string {
    return text.replace(CursorAgentProvider.ANSI_CSI_ESCAPE, '');
  }

  /**
   * Parse the result of the models list command.
   * @param result - The result of the models list command
   * @returns The list of models
   */
  toModelsList(result: string): AgentProviderModels {
    const models: AgentProviderModels = {};

    if (!result?.trim()) {
      return models;
    }

    const cleaned = CursorAgentProvider.stripAnsiSequences(result);
    const sep = CursorAgentProvider.MODEL_LINE_SEPARATOR;

    for (const line of cleaned.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      const sepIndex = trimmed.indexOf(sep);

      if (sepIndex === -1) {
        continue;
      }

      const id = trimmed.slice(0, sepIndex).trim();
      const name = trimmed.slice(sepIndex + sep.length).trim();

      if (id) {
        models[id] = name;
      }
    }

    return models;
  }

  /**
   * Send a message to the cursor-agent and get a response.
   * @param agentId - The UUID of the agent
   * @param containerId - The Docker container ID where the agent is running
   * @param message - The message to send to the agent
   * @param options - Optional configuration (e.g., model name)
   * @returns The agent's response as a string
   */
  async sendMessage(
    agentId: string,
    containerId: string,
    message: string,
    options?: AgentProviderOptions,
  ): Promise<string> {
    const resumeId = `${agentId}-${containerId}${options?.resumeSessionSuffix ?? ''}`;
    // Build command: cursor-agent with prompt mode and JSON output
    let command = `cursor-agent --print --approve-mcps --force --output-format json --resume ${resumeId}`;

    if (options?.model) {
      command += ` --model ${options.model}`;
    }

    // Send the message to STDIN of the command and get the response
    const response = await this.dockerService.sendCommandToContainer(containerId, command, message);

    return response;
  }

  async *sendMessageStream(
    agentId: string,
    containerId: string,
    message: string,
    options?: AgentProviderOptions,
  ): AsyncIterable<string> {
    const resumeId = `${agentId}-${containerId}${options?.resumeSessionSuffix ?? ''}`;
    let command = `cursor-agent --print --approve-mcps --force --output-format stream-json --stream-partial-output --resume ${resumeId}`;

    if (options?.model) {
      command += ` --model ${options.model}`;
    }

    for await (const { stream, chunk } of this.dockerService.execCommandStream(containerId, command, message)) {
      if (stream === 'stdout') {
        yield chunk;
      }
    }
  }

  /**
   * Send an initialization message to the cursor-agent.
   * This establishes system context for the agent.
   * @param agentId - The UUID of the agent
   * @param containerId - The Docker container ID where the agent is running
   * @param options - Optional configuration (e.g., model name)
   */
  async sendInitialization(agentId: string, containerId: string, options?: AgentProviderOptions): Promise<void> {
    const resumeId = `${agentId}-${containerId}${options?.resumeSessionSuffix ?? ''}`;
    // Build command: cursor-agent with prompt mode and JSON output
    let command = `cursor-agent --print --approve-mcps --force --output-format json --resume ${resumeId}`;

    if (options?.model) {
      command += ` --model ${options.model}`;
    }

    // Send dummy message to container stdin (not persisted or broadcast)
    const instructions = `You are operating in a codebase with a structured command and rules system. Follow these guidelines:

COMMAND SYSTEM:
- Executable commands **CAN** be found in the project folder at .cursor/commands
- Each command **IS** a Markdown (.md) file
- The command invocation format **IS** /{filenamewithoutextension} (where filenamewithoutextension is the filename without the .md extension)
- Example: A file named "ship.md" in .cursor/commands **IS** invoked as /ship
- Commands **MUST** be at the start of a message to be recognized and executed
- When you need to execute a command, you **MUST** look for it in .cursor/commands and invoke it using the /{filenamewithoutextension} format at the beginning of your message

RULES SYSTEM:
- Basic context files **CAN** be found in .cursor/rules
- Rules files **MAY** contain an "alwaysApply" property (this is optional in the system)
- If a rules file has "alwaysApply: true", you **MUST** always read and apply that file regardless of context
- If a rules file has "alwaysApply: false", you **SHALL** only apply that file to files matching the respective "globs:" entries
- The "globs:" property **CONTAINS** comma-separated glob patterns that specify which files the rules apply to
- When processing a file, you **MUST** check all rules files with "alwaysApply: true" and all rules files with "alwaysApply: false" whose globs match the current file path

MESSAGE HANDLING:
- This is a one-time initialization message to establish system context
- All subsequent messages you receive **WILL** be from users
- You **MUST** treat all messages after this initialization as user requests, tasks, or questions
- You **SHALL** respond to user messages as you would in a normal conversation, applying the command and rules system guidelines above`;

    try {
      await this.dockerService.sendCommandToContainer(containerId, command, instructions);
      this.logger.debug(`Sent initialization message to agent ${agentId}`);
    } catch (error) {
      const err = error as { message?: string; stack?: string };

      this.logger.warn(`Failed to send initialization message to agent ${agentId}: ${err.message}`, err.stack);
      // Re-throw to allow caller to handle the error
      throw error;
    }
  }

  /**
   * Convert the response from the agent to a parseable strings.
   * Removes all characters that are not UTF-8 supported.
   * @param response - The response from the agent
   * @returns The parseable strings
   */
  toParseableStrings(response: string): string[] {
    // Extract the response object from the response
    const lines = response.split('\n');

    if (lines.length === 0) {
      return [];
    }

    return lines.map((line) => {
      // Clean the response: remove everything before first { and after last }
      let toParse = line.trim();
      // Remove everything before the first { in the string
      const firstBrace = toParse.indexOf('{');

      if (firstBrace !== -1) {
        toParse = toParse.slice(firstBrace);
      }

      // Remove everything after the last } in the string
      const lastBrace = toParse.lastIndexOf('}');

      if (lastBrace !== -1) {
        toParse = toParse.slice(0, lastBrace + 1);
      }

      return toParse;
    });
  }

  /**
   * Convert the response from the agent to a unified response object.
   * @param response - The response from the agent
   * @returns The unified response object
   */
  toUnifiedResponse(response: string): AgentResponseObject | undefined {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    const topLevelType = typeof parsed.type === 'string' ? parsed.type : undefined;
    const normalized = this.normalizeCursorCliOutput(parsed);

    if (normalized !== undefined) {
      return normalized;
    }

    if (
      topLevelType === 'user' ||
      topLevelType === 'system' ||
      topLevelType === 'assistant' ||
      topLevelType === 'tool_call'
    ) {
      return undefined;
    }

    return parsed as AgentResponseObject;
  }

  /**
   * Maps Cursor CLI stream-json (NDJSON) lines to unified agent events.
   * Legacy `--output-format json` result objects pass through unchanged.
   */
  private normalizeCursorCliOutput(parsed: Record<string, unknown>): AgentResponseObject | undefined {
    const type = parsed.type;

    if (typeof type !== 'string') {
      return undefined;
    }

    if (type === 'user' || type === 'system') {
      return undefined;
    }

    if (type === 'assistant') {
      const delta = this.extractCursorStreamAssistantDelta(parsed);

      if (!delta) {
        return undefined;
      }

      return { type: 'delta', delta };
    }

    if (type === 'tool_call') {
      return this.mapCursorStreamToolCall(parsed);
    }

    return undefined;
  }

  private extractCursorStreamAssistantDelta(parsed: Record<string, unknown>): string {
    const message = parsed.message;

    if (!message || typeof message !== 'object') {
      return '';
    }

    const content = (message as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }

        const p = part as { type?: unknown; text?: unknown };

        return p.type === 'text' && typeof p.text === 'string' ? p.text : '';
      })
      .join('');
  }

  private mapCursorStreamToolCall(parsed: Record<string, unknown>): AgentResponseObject | undefined {
    const subtype = parsed.subtype;
    const toolCallRoot = parsed.tool_call;

    if (!toolCallRoot || typeof toolCallRoot !== 'object') {
      return undefined;
    }

    const info = this.getCursorStreamToolCallIdentity(toolCallRoot as Record<string, unknown>);

    if (!info) {
      return undefined;
    }

    if (subtype === 'started') {
      return {
        type: 'tool_call',
        toolCallId: info.toolCallId,
        name: info.name,
        args: info.args,
        status: 'started',
      };
    }

    if (subtype === 'completed') {
      const { result, isError } = this.summarizeCursorStreamToolCompletion(toolCallRoot as Record<string, unknown>);

      return {
        type: 'tool_result',
        toolCallId: info.toolCallId,
        name: info.name,
        result,
        isError,
      };
    }

    return undefined;
  }

  private getCursorStreamToolCallIdentity(toolCallBlock: Record<string, unknown>): {
    toolCallId: string;
    name: string;
    args: unknown;
  } | null {
    for (const [key, value] of Object.entries(toolCallBlock)) {
      if (!key.endsWith('ToolCall') || !value || typeof value !== 'object') {
        continue;
      }

      const entry = value as Record<string, unknown>;
      const name = key.replace(/ToolCall$/, '');
      const args = entry.args;
      let fingerprint = name;

      if (args && typeof args === 'object') {
        const a = args as Record<string, unknown>;

        if (typeof a.pattern === 'string' && typeof a.path === 'string') {
          fingerprint = `${name}:${a.pattern}@${a.path}`;
        } else if (typeof a.path === 'string') {
          fingerprint = `${name}:${a.path}`;
        } else if (typeof a.command === 'string') {
          fingerprint = `${name}:${a.command}`;
        } else if (typeof a.globPattern === 'string' && typeof a.targetDirectory === 'string') {
          fingerprint = `${name}:${a.globPattern}@${a.targetDirectory}`;
        } else {
          try {
            fingerprint = `${name}:${JSON.stringify(a)}`;
          } catch {
            fingerprint = name;
          }
        }
      }

      return {
        toolCallId: `cursor-${name}-${this.fingerprintHash(fingerprint)}`,
        name,
        args,
      };
    }

    return null;
  }

  private fingerprintHash(value: string): string {
    let hash = 0;

    for (let index = 0; index < value.length; index++) {
      hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
    }

    return Math.abs(hash).toString(36);
  }

  private summarizeCursorStreamToolCompletion(toolCallBlock: Record<string, unknown>): {
    result: unknown;
    isError: boolean;
  } {
    for (const [key, value] of Object.entries(toolCallBlock)) {
      if (!key.endsWith('ToolCall') || !value || typeof value !== 'object') {
        continue;
      }

      const entry = value as Record<string, unknown>;
      const toolResult = entry.result;

      if (!toolResult || typeof toolResult !== 'object') {
        return { result: entry, isError: false };
      }

      const outcome = toolResult as Record<string, unknown>;

      if (outcome.success !== undefined) {
        return { result: outcome.success, isError: false };
      }

      if (outcome.rejected !== undefined) {
        return { result: outcome.rejected, isError: true };
      }

      const exitCode = (outcome as { exitCode?: unknown }).exitCode;

      if (typeof exitCode === 'number') {
        return { result: outcome, isError: exitCode !== 0 };
      }

      return { result: outcome, isError: false };
    }

    return { result: toolCallBlock, isError: false };
  }
}
