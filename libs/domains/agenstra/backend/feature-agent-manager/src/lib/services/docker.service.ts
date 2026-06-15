import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { promisify } from 'util';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Docker = require('dockerode');
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

interface TerminalSession {
  exec: Docker.Exec;
  stream: NodeJS.ReadWriteStream;
  containerId: string;
  sessionId: string;
}

@Injectable()
export class DockerService {
  private readonly logger = new Logger(DockerService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });
  private static readonly WORKSPACE_CONTEXT_BIND_SOURCE = '/opt/agents';
  private static readonly WORKSPACE_CONTEXT_BIND_TARGET = '/opt/workspace';
  // Store active terminal sessions: sessionId -> TerminalSession
  private readonly terminalSessions = new Map<string, TerminalSession>();

  async createContainer(options: {
    image?: string;
    env?: Record<string, string | undefined>;
    volumes?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
    ports?: Array<{ containerPort: number; hostPort?: number; protocol?: 'tcp' | 'udp' }>;
    network?: string;
  }): Promise<string> {
    const { image, env, volumes = [], ports = [], network } = options;
    // Resolve image: explicit -> env -> default placeholder
    const resolvedImage = image || process.env.AGENT_DEFAULT_IMAGE || 'ghcr.io/forepath/agenstra-manager-worker:latest';
    // Build HostConfig.Binds from volumes
    const binds = volumes.map((v) => `${v.hostPath}:${v.containerPath}${v.readOnly ? ':ro' : ''}`);
    // Build ExposedPorts and PortBindings from ports
    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, Array<{ HostPort?: string }>> = {};

    for (const p of ports) {
      const key = `${p.containerPort}/${p.protocol ?? 'tcp'}`;

      exposedPorts[key] = {};

      if (!portBindings[key]) portBindings[key] = [];

      portBindings[key].push({ HostPort: p.hostPort ? String(p.hostPort) : undefined });
    }

    // Ensure image is available (pull if necessary)
    await new Promise<void>((resolve, reject) => {
      this.docker.pull(resolvedImage, (err: unknown, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);

        // followProgress is available via modem (not typed in dockerode)
        const modem: any = (this.docker as any).modem;

        modem.followProgress(stream, (pullErr: unknown) => (pullErr ? reject(pullErr) : resolve()));
      });
    }).catch((e) => {
      // If pull fails, log and proceed - create might still work if image exists locally
      this.logger.warn(`Failed to pull image ${resolvedImage}: ${(e as Error).message}`);
    });

    // Map env object to KEY=VALUE strings as required by Docker API
    // Escape special characters in the value to preserve intent (no quoting)
    const escapeEnvValue = (val: string): string =>
      val.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    const maybeQuote = (val: string): string => {
      // Quote if contains whitespace or quotes
      if (/\s|"|'/u.test(val)) {
        const inner = val.replace(/"/g, '\\"');

        return `"${inner}"`;
      }

      return val;
    };
    const envArray = env
      ? Object.entries(env).map(([key, value]) => {
          const raw = value == null ? '' : escapeEnvValue(String(value));
          const quoted = maybeQuote(raw);

          return `${key}=${quoted}`;
        })
      : undefined;

    // Ensure the Docker image exists
    await this.ensureImageExists(resolvedImage);

    // Create container
    const container = await this.docker.createContainer({
      Image: resolvedImage,
      Env: envArray,
      ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined,
      HostConfig: {
        Binds: binds.length ? binds : undefined,
        PortBindings: Object.keys(portBindings).length ? portBindings : undefined,
        AutoRemove: false,
        RestartPolicy: {
          Name: 'unless-stopped',
        },
        NetworkMode: network ? network : undefined,
      },
    });

    // Start container
    await container.start();

    return container.id as unknown as string;
  }

  /**
   * Update a Docker container's environment variables.
   * Since Docker's update API doesn't support environment variables,
   * this method recreates the container with updated environment variables.
   * @param containerId - The ID of the container to update
   * @param options - Options for updating the container
   * @param options.env - New environment variables to set (will replace existing ones with the same keys)
   * @returns The new container ID (since the container is recreated)
   * @throws NotFoundException if container is not found
   */
  async updateContainer(
    containerId: string,
    options: {
      env?: Record<string, string | undefined>;
    },
  ): Promise<string> {
    const { env } = options;
    // Map env object to KEY=VALUE strings as required by Docker API
    // Escape special characters in the value to preserve intent (no quoting)
    const escapeEnvValue = (val: string): string =>
      val.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    const maybeQuote = (val: string): string => {
      // Quote if contains whitespace or quotes
      if (/\s|"|'/u.test(val)) {
        const inner = val.replace(/"/g, '\\"');

        return `"${inner}"`;
      }

      return val;
    };

    try {
      const container = this.docker.getContainer(containerId);
      let inspectInfo: Docker.ContainerInspectInfo;

      try {
        inspectInfo = await container.inspect();
      } catch (inspectError: unknown) {
        const err = inspectError as { statusCode?: number };

        if (err.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw inspectError;
      }

      // Get current environment variables
      const currentEnvArray = inspectInfo.Config?.Env || [];
      const currentEnvMap: Record<string, string> = {};

      for (const envVar of currentEnvArray) {
        const [key, ...valueParts] = envVar.split('=');

        if (key) {
          currentEnvMap[key] = valueParts.join('=');
        }
      }

      // Merge new environment variables (new values override existing ones).
      // Undefined values explicitly remove keys from the recreated container env.
      const mergedEnv: Record<string, string | undefined> = { ...currentEnvMap };

      if (env) {
        for (const [key, value] of Object.entries(env)) {
          if (value === undefined) {
            delete mergedEnv[key];
          } else {
            mergedEnv[key] = value;
          }
        }
      }

      // Convert merged env to array format
      const envArray = Object.entries(mergedEnv).map(([key, value]) => {
        const raw = value == null ? '' : escapeEnvValue(String(value));
        const quoted = maybeQuote(raw);

        return `${key}=${quoted}`;
      });
      // Extract container configuration
      const containerName = inspectInfo.Name.startsWith('/') ? inspectInfo.Name.slice(1) : inspectInfo.Name;
      const image = inspectInfo.Config?.Image || inspectInfo.Image;
      const hostConfig = inspectInfo.HostConfig || {};
      const exposedPorts = inspectInfo.Config?.ExposedPorts || {};
      const labels = inspectInfo.Config?.Labels || {};
      const networkSettings = inspectInfo.NetworkSettings;
      const mounts = inspectInfo.Mounts || [];

      // Stop the container before removing it
      try {
        await container.stop();
      } catch (stopError: unknown) {
        const err = stopError as { statusCode?: number; message?: string };

        // Ignore error if container is already stopped (304) or not found (404)
        if (err.statusCode === 304 || err.statusCode === 404) {
          // Container is already stopped or doesn't exist, continue with removal
        } else {
          // Propagate other errors
          throw stopError;
        }
      }

      // Remove the container
      try {
        await container.remove({ force: true });
      } catch (removeError: unknown) {
        const err = removeError as { statusCode?: number; message?: string };

        if (err.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw removeError;
      }

      // Build volume binds from mounts
      const binds = mounts
        .map((mount) => {
          if (mount.Type === 'bind' || mount.Type === 'volume') {
            const readOnly = mount.RW === false ? ':ro' : '';

            return `${mount.Source}:${mount.Destination}${readOnly}`;
          }

          return null;
        })
        .filter((bind): bind is string => bind !== null);
      const hasWorkspaceContextBind = mounts.some(
        (mount) =>
          mount.Source === DockerService.WORKSPACE_CONTEXT_BIND_SOURCE &&
          mount.Destination === DockerService.WORKSPACE_CONTEXT_BIND_TARGET,
      );

      if (!hasWorkspaceContextBind) {
        binds.push(`${DockerService.WORKSPACE_CONTEXT_BIND_SOURCE}:${DockerService.WORKSPACE_CONTEXT_BIND_TARGET}:ro`);
      }

      // Ensure the Docker image exists
      await this.ensureImageExists(image);

      // Recreate container with updated environment variables
      const newContainer = await this.docker.createContainer({
        name: containerName,
        Image: image,
        Env: envArray,
        ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined,
        HostConfig: {
          ...hostConfig,
          Binds: binds.length ? binds : undefined,
          AutoRemove: hostConfig.AutoRemove ?? false,
        },
        Labels: Object.keys(labels).length ? labels : undefined,
      });
      // Reconnect to networks if the container was connected to any
      const networks = networkSettings?.Networks;

      if (networks) {
        for (const networkName of Object.keys(networks)) {
          try {
            const network = this.docker.getNetwork(networkName);

            await network.connect({ Container: newContainer.id });
          } catch (networkError: unknown) {
            // Log but don't fail if network connection fails (network might not exist)
            this.logger.warn(
              `Failed to connect container to network ${networkName}: ${(networkError as Error).message}`,
            );
          }
        }
      }

      // Start the new container
      await newContainer.start();

      const newContainerId = newContainer.id as unknown as string;

      this.logger.log(`Successfully updated container ${containerId} (recreated as ${newContainerId})`);

      return newContainerId;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error updating container: ${err.message}`, err.stack);
      throw error;
    }
  }

  async getContainerEnvironmentMap(containerId: string): Promise<Record<string, string>> {
    const container = this.docker.getContainer(containerId);
    const inspectInfo = await container.inspect();
    const currentEnvArray = inspectInfo.Config?.Env || [];
    const currentEnvMap: Record<string, string> = {};

    for (const envVar of currentEnvArray) {
      const [key, ...valueParts] = envVar.split('=');

      if (key) {
        currentEnvMap[key] = valueParts.join('=');
      }
    }

    return currentEnvMap;
  }

  /**
   * Delete a Docker container by ID.
   * Stops the container if it's running, then removes it.
   * @param containerId - The ID of the container to delete
   * @throws NotFoundException if container is not found
   */
  async deleteContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      // Check if container exists and get its state
      let containerInfo;

      try {
        containerInfo = await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Stop the container if it's running
      if (containerInfo.State?.Running) {
        try {
          await container.stop();
        } catch (error: unknown) {
          const stopError = error as { statusCode?: number; message?: string };

          // Ignore error if container is already stopped (409 Conflict)
          if (stopError.statusCode !== 409) {
            this.logger.warn(`Failed to stop container ${containerId}: ${stopError.message}`, stopError);
            // Continue with removal attempt even if stop failed
          }
        }
      }

      // Remove the container
      try {
        await container.remove();
      } catch (error: unknown) {
        const removeError = error as { statusCode?: number; message?: string };

        // If container doesn't exist (404), consider it already deleted
        if (removeError.statusCode === 404) {
          this.logger.debug(`Container ${containerId} was already removed`);

          return;
        }

        // If container is still running (409), try force removal
        if (removeError.statusCode === 409) {
          this.logger.warn(`Container ${containerId} is still running, attempting force removal`);

          try {
            await container.remove({ force: true });
          } catch (forceError: unknown) {
            const forceErr = forceError as { message?: string; stack?: string };

            this.logger.error(`Failed to force remove container ${containerId}: ${forceErr.message}`, forceErr.stack);
            throw forceError;
          }
        } else {
          const err = removeError as { message?: string; stack?: string };

          this.logger.error(`Failed to remove container ${containerId}: ${err.message}`, err.stack);
          throw error;
        }
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error deleting container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Start a Docker container by ID.
   * @param containerId - The ID of the container to start
   * @throws NotFoundException if container is not found
   */
  async startContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      try {
        await container.start();
        this.logger.log(`Started container ${containerId}`);
      } catch (error: unknown) {
        const startError = error as { statusCode?: number; message?: string };

        if (startError.statusCode === 304) {
          this.logger.debug(`Container ${containerId} is already running`);

          return;
        }

        const err = startError as { message?: string; stack?: string };

        this.logger.error(`Failed to start container ${containerId}: ${err.message}`, err.stack);
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error starting container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Stop a Docker container by ID.
   * @param containerId - The ID of the container to stop
   * @throws NotFoundException if container is not found
   */
  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      try {
        await container.stop();
        this.logger.log(`Stopped container ${containerId}`);
      } catch (error: unknown) {
        const stopError = error as { statusCode?: number; message?: string };

        if (stopError.statusCode === 304) {
          this.logger.debug(`Container ${containerId} is already stopped`);

          return;
        }

        const err = stopError as { message?: string; stack?: string };

        this.logger.error(`Failed to stop container ${containerId}: ${err.message}`, err.stack);
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error stopping container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Restart a Docker container by ID.
   * Stops the container if it's running, then starts it again.
   * @param containerId - The ID of the container to restart
   * @throws NotFoundException if container is not found
   */
  async restartContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Restart the container
      try {
        await container.restart();
        this.logger.log(`Restarted container ${containerId}`);
      } catch (error: unknown) {
        const restartError = error as { statusCode?: number; message?: string };

        // If container is not running (409 Conflict), try to start it
        if (restartError.statusCode === 409) {
          this.logger.debug(`Container ${containerId} is not running, attempting to start it`);

          try {
            await container.start();
            this.logger.log(`Started container ${containerId}`);
          } catch (startError: unknown) {
            const startErr = startError as { message?: string; stack?: string };

            this.logger.error(`Failed to start container ${containerId}: ${startErr.message}`, startErr.stack);
            throw startError;
          }
        } else {
          const err = restartError as { message?: string; stack?: string };

          this.logger.error(`Failed to restart container ${containerId}: ${err.message}`, err.stack);
          throw error;
        }
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error restarting container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Create a Docker network and optionally attach containers to it.
   * @param options - Network creation options
   * @param options.name - The name of the network
   * @param options.driver - Network driver (default: 'bridge')
   * @param options.containerIds - Optional list of container IDs to attach to the network
   * @returns The network ID
   */
  async createNetwork(options: { name?: string; driver?: string; containerIds?: string[] }): Promise<string> {
    try {
      const { name = uuidv4(), driver = 'bridge', containerIds = [] } = options;
      // Create the network
      const network = await this.docker.createNetwork({
        Name: name,
        Driver: driver,
      });
      const networkId = network.id as unknown as string;

      // Attach containers if provided
      if (containerIds.length > 0) {
        for (const containerId of containerIds) {
          try {
            await network.connect({ Container: containerId });
            this.logger.debug(`Attached container ${containerId} to network ${name}`);
          } catch (error: unknown) {
            const connectError = error as { statusCode?: number; message?: string };

            // Log warning but continue attaching other containers
            this.logger.warn(`Failed to attach container ${containerId} to network ${name}: ${connectError.message}`);
          }
        }
      }

      this.logger.log(`Created network ${name} with ID ${networkId}`);

      return networkId;
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error creating network: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Delete a Docker network by ID.
   * Automatically disconnects all containers from the network before deletion.
   * @param networkId - The ID of the network to delete
   * @throws NotFoundException if network is not found
   */
  async deleteNetwork(networkId: string): Promise<void> {
    try {
      const network = this.docker.getNetwork(networkId);
      // Check if network exists and get its info
      let networkInfo;

      try {
        networkInfo = await network.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Network with ID '${networkId}' not found`);
        }

        throw error;
      }

      // Disconnect all containers from the network
      const containers = networkInfo.Containers || {};
      const containerIds = Object.keys(containers);

      if (containerIds.length > 0) {
        this.logger.debug(`Disconnecting ${containerIds.length} containers from network ${networkId}`);

        for (const containerId of containerIds) {
          try {
            await network.disconnect({ Container: containerId });
            this.logger.debug(`Disconnected container ${containerId} from network ${networkId}`);
          } catch (error: unknown) {
            const disconnectError = error as { statusCode?: number; message?: string };

            // Log warning but continue disconnecting other containers
            // Ignore 404 errors (container already disconnected or doesn't exist)
            if (disconnectError.statusCode !== 404) {
              this.logger.warn(
                `Failed to disconnect container ${containerId} from network ${networkId}: ${disconnectError.message}`,
              );
            }
          }
        }
      }

      // Remove the network
      try {
        await network.remove();
        this.logger.log(`Deleted network ${networkId}`);
      } catch (error: unknown) {
        const removeError = error as { statusCode?: number; message?: string };

        // If network doesn't exist (404), consider it already deleted
        if (removeError.statusCode === 404) {
          this.logger.debug(`Network ${networkId} was already removed`);

          return;
        }

        const err = removeError as { message?: string; stack?: string };

        this.logger.error(`Failed to remove network ${networkId}: ${err.message}`, err.stack);
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error deleting network: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get container logs as a stream of lines.
   * First returns historical logs, then tails live logs.
   * @param containerId - The ID of the container
   * @returns An async iterable that yields log lines
   * @throws NotFoundException if container is not found
   */
  async *getContainerLogs(containerId: string): AsyncIterable<string> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // First, get historical logs
      const historicalLogs = await container.logs({
        stdout: true,
        stderr: true,
        tail: 100, // Get last 100 lines of historical logs
        timestamps: false,
      });
      // Parse historical logs and yield each line
      const historicalBuffer = Buffer.isBuffer(historicalLogs) ? historicalLogs : Buffer.from(historicalLogs);
      const historicalLines = historicalBuffer.toString('utf-8').split('\n');

      for (const line of historicalLines) {
        if (line.trim()) {
          yield line;
        }
      }

      // Then, tail live logs
      // When follow: true, dockerode returns a stream directly (not a promise)
      const logStream = (await container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail: 0, // Start from now (no historical logs, we already got them)
        timestamps: false,
      })) as NodeJS.ReadableStream;
      // Process live log stream
      let buffer = '';

      try {
        for await (const chunk of logStream) {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');

          // Keep the last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              yield line;
            }
          }
        }

        // Yield any remaining buffer content
        if (buffer.trim()) {
          yield buffer;
        }
      } catch (streamError: unknown) {
        // Stream ended or error occurred
        const err = streamError as { code?: string; message?: string; stack?: string };

        if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
          this.logger.error(`Error reading log stream: ${err.message}`, err.stack);
          throw streamError;
        }
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error getting container logs: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Parse a shell command string into an array of arguments.
   * Handles single quotes, double quotes, escaped characters, and spaces.
   * @param command - The command string to parse
   * @returns Array of parsed arguments
   * @example
   * parseShellCommand("git clone 'https://url' /app") // ['git', 'clone', 'https://url', '/app']
   * parseShellCommand('echo "hello world"') // ['echo', 'hello world']
   * parseShellCommand('ls -la /tmp\\ with\\ spaces') // ['ls', '-la', '/tmp with spaces']
   */
  private parseShellCommand(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let i = 0;

    while (i < command.length) {
      const char = command[i];
      const nextChar = i + 1 < command.length ? command[i + 1] : null;

      if (inSingleQuote) {
        // Inside single quotes: everything is literal except the closing quote
        if (char === "'") {
          inSingleQuote = false;
        } else {
          current += char;
        }
      } else if (inDoubleQuote) {
        // Inside double quotes: backslash escapes next character
        if (char === '\\' && nextChar !== null) {
          current += nextChar;
          i++; // Skip next character as it's escaped
        } else if (char === '"') {
          inDoubleQuote = false;
        } else {
          current += char;
        }
      } else {
        // Not in quotes
        if (char === '\\' && nextChar !== null) {
          // Escaped character
          current += nextChar;
          i++; // Skip next character as it's escaped
        } else if (char === "'") {
          inSingleQuote = true;
        } else if (char === '"') {
          inDoubleQuote = true;
        } else if (/\s/.test(char)) {
          // Whitespace: end current argument
          if (current.length > 0) {
            args.push(current);
            current = '';
          }

          // Skip additional whitespace
          while (i + 1 < command.length && /\s/.test(command[i + 1])) {
            i++;
          }
        } else {
          current += char;
        }
      }

      i++;
    }

    // Add final argument if any
    if (current.length > 0) {
      args.push(current);
    }

    return args;
  }

  /**
   * Send a command or keystrokes to a container.
   * Executes a command in the container and optionally sends input/keystrokes to stdin.
   * @param containerId - The ID of the container
   * @param command - The command to execute (e.g., 'bash', 'sh', or a specific command)
   * @param input - Optional input/keystrokes to send to stdin (string or array of strings)
   * @param checkExitCode - If true, check exit code and throw error if non-zero (default: false)
   * @returns The command output (stdout and stderr combined)
   * @throws NotFoundException if container is not found
   * @throws Error if checkExitCode is true and command exits with non-zero code
   */
  async sendCommandToContainer(
    containerId: string,
    command: string,
    input?: string | string[],
    checkExitCode = false,
  ): Promise<string> {
    try {
      this.logger.debug(`Sending command to container ${containerId}: ${command}`);

      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Parse command into executable and arguments
      // Handles quoted arguments (single/double quotes) and escaped spaces
      const commandParts = this.parseShellCommand(command.trim());
      const executable = commandParts[0];
      const args = commandParts.slice(1);
      // Create exec instance with stdin enabled for keystrokes
      const execInstance = await container.exec({
        Cmd: [executable, ...args],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false, // Disable TTY to properly capture output
      });
      // Start the exec
      const stream = (await execInstance.start({
        hijack: true,
        stdin: true,
      })) as NodeJS.ReadWriteStream;
      // Collect output from stdout and stderr
      const outputChunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        outputChunks.push(chunk);
      });

      // Send input/keystrokes if provided
      if (input !== undefined) {
        // Normalize input: convert literal \n strings to actual newlines
        // This handles cases where \n is passed as literal "\\n" over websocket connections
        let inputArray: string[];

        if (Array.isArray(input)) {
          // For arrays: normalize each element, then split each element if it contains newlines
          inputArray = input.flatMap((line) => {
            const normalized = line.replace(/\\n/g, '\n');

            return normalized.split(/\r?\n/);
          });
        } else {
          // For strings: normalize, then split
          const normalized = input.replace(/\\n/g, '\n');

          inputArray = normalized.split(/\r?\n/);
        }

        // Send each line separately
        for (const inputLine of inputArray) {
          // Add newline if not present (simulates Enter key)
          const lineToSend = inputLine.endsWith('\n') ? inputLine : `${inputLine}\n`;

          stream.write(lineToSend);
        }
      }

      // Close stdin to signal end of input
      stream.end();

      // Wait for the stream to finish and collect output
      const output = await new Promise<string>((resolve, reject) => {
        let resolved = false;
        let extractedOutput = ''; // Declare outside event handlers for scope
        const resolveOnce = (result: string) => {
          if (!resolved) {
            resolved = true;
            resolve(result);
          }
        };
        const rejectOnce = (error: unknown) => {
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        };

        stream.on('end', () => {
          // Combine all output chunks and demultiplex Docker's multiplexed format
          const combinedBuffer = Buffer.concat(outputChunks);
          // Docker multiplexed format: [STREAM_TYPE(1 byte)][LENGTH(4 bytes BE)][DATA...]
          // Stream type: 1 = stdout, 2 = stderr
          let i = 0;

          while (i < combinedBuffer.length) {
            if (i + 5 <= combinedBuffer.length) {
              const streamType = combinedBuffer[i];
              const dataLength = combinedBuffer.readUInt32BE(i + 1);
              const dataStart = i + 5;
              const dataEnd = dataStart + dataLength;

              if (dataEnd <= combinedBuffer.length && (streamType === 1 || streamType === 2)) {
                // Valid frame: extract data (both stdout and stderr)
                const data = combinedBuffer.subarray(dataStart, dataEnd);

                extractedOutput += data.toString('utf-8');
                i = dataEnd;
              } else {
                // Invalid frame, try to extract remaining as plain text
                extractedOutput += combinedBuffer.subarray(i).toString('utf-8');
                break;
              }
            } else {
              // Not enough bytes for a complete frame, append as text
              extractedOutput += combinedBuffer.subarray(i).toString('utf-8');
              break;
            }
          }

          // If exit code checking is disabled, resolve immediately (backward compatible)
          // Otherwise, wait for close event to check exit code
          if (!checkExitCode) {
            resolveOnce(extractedOutput.trim());
          }
        });

        stream.on('close', () => {
          if (resolved) return;

          // Extract output if not already extracted
          let finalOutput = '';

          if (extractedOutput) {
            finalOutput = extractedOutput.trim();
          } else {
            const combinedBuffer = Buffer.concat(outputChunks);

            finalOutput = combinedBuffer.toString('utf-8').trim();
          }

          // If exit code checking is enabled, check the exit code
          if (checkExitCode) {
            execInstance
              .inspect()
              .then((execInspect) => {
                const exitCode = execInspect.ExitCode;

                if (exitCode !== 0 && exitCode !== null) {
                  // Command failed - reject with error including output
                  const errorMessage = finalOutput || `Command failed with exit code ${exitCode}`;

                  this.logger.error(`Command failed with exit code ${exitCode}: ${errorMessage}`);
                  rejectOnce(new Error(errorMessage));
                } else {
                  // Command succeeded
                  resolveOnce(finalOutput);
                }
              })
              .catch((inspectError) => {
                // If we can't inspect, log warning but resolve with output
                const err = inspectError as { message?: string };

                this.logger.warn(`Failed to inspect exec exit code: ${err.message}`);
                resolveOnce(finalOutput);
              });
          } else {
            // No exit code checking - resolve with output (backward compatible behavior)
            resolveOnce(finalOutput);
          }
        });

        stream.on('error', (error: unknown) => {
          const err = error as { code?: string; message?: string };

          // Ignore EPIPE errors (stdin closed) - this is expected when stdin ends
          if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
            rejectOnce(error);
          } else {
            // For EPIPE/ECONNRESET, resolve with collected output
            const combinedBuffer = Buffer.concat(outputChunks);

            resolveOnce(combinedBuffer.toString('utf-8').trim());
          }
        });

        // Set a timeout to prevent hanging (reject if command takes too long)
        setTimeout(() => {
          if (!resolved) {
            const combinedBuffer = Buffer.concat(outputChunks);
            const timeoutOutput = combinedBuffer.toString('utf-8').trim();

            rejectOnce(
              new Error(`Command timed out after 24 hours${timeoutOutput ? `\nOutput: ${timeoutOutput}` : ''}`),
            );
          }
        }, 86400000);
      });

      return output;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error sending command to container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Execute a command in a container and stream demuxed stdout/stderr chunks as they arrive.
   *
   * Intended for provider-level streaming (e.g. JSONL agent outputs). This uses dockerode's
   * `demuxStream` to avoid multiplexing artifacts.
   */
  async *execCommandStream(
    containerId: string,
    command: string,
    input?: string | string[],
  ): AsyncIterable<{ stream: 'stdout' | 'stderr'; chunk: string }> {
    this.logger.debug(`Streaming command from container ${containerId}: ${command}`);

    const container = this.docker.getContainer(containerId);

    // Check if container exists
    try {
      await container.inspect();
    } catch (error: unknown) {
      const dockerError = error as { statusCode?: number };

      if (dockerError.statusCode === 404) {
        throw new NotFoundException(`Container with ID '${containerId}' not found`);
      }

      throw error;
    }

    const commandParts = this.parseShellCommand(command.trim());
    const executable = commandParts[0];
    const args = commandParts.slice(1);
    const execInstance = await container.exec({
      Cmd: [executable, ...args],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = (await execInstance.start({
      hijack: true,
      stdin: true,
    })) as NodeJS.ReadWriteStream;
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    type QueueItem = { stream: 'stdout' | 'stderr'; chunk: string };
    const queue: QueueItem[] = [];
    let done = false;
    let error: unknown | null = null;
    const notify = (() => {
      let resolve: (() => void) | null = null;
      const wait = () =>
        new Promise<void>((r) => {
          resolve = r;
        });
      const signal = () => {
        resolve?.();
        resolve = null;
      };

      return { wait, signal };
    })();
    const onData = (which: 'stdout' | 'stderr') => (chunk: Buffer) => {
      queue.push({ stream: which, chunk: chunk.toString('utf-8') });
      notify.signal();
    };
    const onError = (err: unknown) => {
      error = err;
      done = true;
      notify.signal();
    };
    const tryFinish = () => {
      if (stdoutStream.readableEnded && stderrStream.readableEnded) {
        done = true;
        notify.signal();
      }
    };

    stdoutStream.on('data', onData('stdout'));
    stderrStream.on('data', onData('stderr'));
    stdoutStream.on('error', onError);
    stderrStream.on('error', onError);
    stdoutStream.on('end', tryFinish);
    stderrStream.on('end', tryFinish);
    stream.on('error', onError);

    if (input !== undefined) {
      let inputArray: string[];

      if (Array.isArray(input)) {
        inputArray = input.flatMap((line) => line.replace(/\\n/g, '\n').split(/\r?\n/));
      } else {
        inputArray = input.replace(/\\n/g, '\n').split(/\r?\n/);
      }

      for (const inputLine of inputArray) {
        const lineToSend = inputLine.endsWith('\n') ? inputLine : `${inputLine}\n`;

        stream.write(lineToSend);
      }
    }

    stream.end();

    while (!done || queue.length > 0) {
      if (error) {
        throw error;
      }

      const item = queue.shift();

      if (item) {
        yield item;
        continue;
      }

      if (done) {
        break;
      }

      await notify.wait();
    }
  }

  /**
   * Read file content from container using demuxStream for proper stream handling.
   * This method uses Docker's built-in demuxStream to properly separate stdout/stderr,
   * which eliminates null byte artifacts that can occur with manual parsing.
   * @param containerId - The container ID
   * @param filePath - The absolute path to the file in the container
   * @returns The file content as a string
   * @throws NotFoundException if container is not found
   */
  async readFileFromContainer(containerId: string, filePath: string): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Escape file path for shell usage
      const escapedPath = filePath.replace(/'/g, "'\\''");
      const safePath = `'${escapedPath}'`;
      // Create exec instance to read file
      const exec = await container.exec({
        Cmd: ['sh', '-c', `cat ${safePath}`],
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      // Start the exec
      const stream = (await exec.start({
        hijack: true,
        stdin: false,
      })) as NodeJS.ReadWriteStream;
      // Use PassThrough streams and demuxStream to properly handle Docker's multiplexed format
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      let stdoutData = '';
      let stderrData = '';

      // Collect data from stdout
      stdoutStream.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf8');
      });

      // Collect data from stderr (for error messages)
      stderrStream.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString('utf8');
      });

      // Use Docker's built-in demuxStream to properly separate stdout and stderr
      container.modem.demuxStream(stream, stdoutStream, stderrStream);

      // Wait for the stream to finish
      const output = await new Promise<string>((resolve, reject) => {
        let resolved = false;
        const resolveOnce = (result: string) => {
          if (!resolved) {
            resolved = true;
            resolve(result);
          }
        };
        const rejectOnce = (error: unknown) => {
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        };

        stream.on('end', () => {
          // End the PassThrough streams
          stdoutStream.end();
          stderrStream.end();

          // If there's stderr output, it might be an error
          if (stderrData.trim()) {
            // Check if it's a file not found error
            if (stderrData.includes('No such file') || stderrData.includes('not found')) {
              rejectOnce(new Error(`File not found: ${filePath}`));
            } else {
              // Log stderr but still return stdout (some commands write to stderr)
              this.logger.debug(`Stderr output from file read: ${stderrData}`);
              resolveOnce(stdoutData);
            }
          } else {
            resolveOnce(stdoutData);
          }
        });

        stream.on('close', () => {
          if (!resolved) {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        });

        stream.on('error', (error: unknown) => {
          const err = error as { code?: string; message?: string };

          // Ignore EPIPE errors (stdin closed) - this is expected
          if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
            rejectOnce(error);
          } else {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        });

        // Set a timeout to prevent hanging (fallback safety)
        setTimeout(() => {
          if (!resolved) {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        }, 60000);
      });

      return output.trim();
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error reading file from container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Resolve the container user's home directory (for tilde expansion in provider config paths).
   * @param containerId - Docker container ID
   * @returns Trimmed HOME path, or `/home/agenstra` when empty
   */
  async getContainerHomeDirectory(containerId: string): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);

      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      const exec = await container.exec({
        Cmd: ['sh', '-c', 'printf %s "${HOME:-/home/agenstra}"'],
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const stream = (await exec.start({
        hijack: true,
        stdin: false,
      })) as NodeJS.ReadWriteStream;
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      let stdoutData = '';

      container.modem.demuxStream(stream, stdoutStream, stderrStream);
      stdoutStream.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf8');
      });

      const output = await new Promise<string>((resolve, reject) => {
        let resolved = false;
        const resolveOnce = (v: string) => {
          if (!resolved) {
            resolved = true;
            resolve(v);
          }
        };
        const rejectOnce = (err: unknown) => {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        };

        stream.on('end', () => {
          stdoutStream.end();
          stderrStream.end();
          resolveOnce(stdoutData);
        });
        stream.on('close', () => {
          if (!resolved) {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        });
        stream.on('error', (err: unknown) => {
          stdoutStream.end();
          stderrStream.end();
          rejectOnce(err);
        });
        setTimeout(() => {
          if (!resolved) {
            stdoutStream.end();
            stderrStream.end();
            resolveOnce(stdoutData);
          }
        }, 60000);
      });
      const home = output.trim() || '/home/agenstra';

      return home;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error resolving HOME in container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Create a new terminal session (TTY) for a container.
   * Creates a persistent TTY exec instance that can be used for interactive terminal sessions.
   * @param containerId - The ID of the container
   * @param sessionId - Unique session identifier (typically socket.id + timestamp or UUID)
   * @param shell - Shell command to run (default: 'sh')
   * @returns The terminal session stream
   * @throws NotFoundException if container is not found
   */
  async createTerminalSession(containerId: string, sessionId: string, shell = 'sh'): Promise<NodeJS.ReadWriteStream> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Check if session already exists
      if (this.terminalSessions.has(sessionId)) {
        this.logger.warn(`Terminal session ${sessionId} already exists, closing existing session`);
        await this.closeTerminalSession(sessionId);
      }

      // Create exec instance with TTY enabled for proper terminal emulation
      const exec = await container.exec({
        Cmd: [shell],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true, // Enable TTY for terminal emulation
      });
      // Start the exec with TTY
      const stream = (await exec.start({
        hijack: true,
        stdin: true,
        Tty: true,
      })) as NodeJS.ReadWriteStream;

      // Store the session
      this.terminalSessions.set(sessionId, {
        exec,
        stream,
        containerId,
        sessionId,
      });

      // Handle stream end/close to clean up session
      stream.on('end', () => {
        this.logger.debug(`Terminal session ${sessionId} ended`);
        this.terminalSessions.delete(sessionId);
      });

      stream.on('close', () => {
        this.logger.debug(`Terminal session ${sessionId} closed`);
        this.terminalSessions.delete(sessionId);
      });

      stream.on('error', (error: unknown) => {
        const err = error as { code?: string; message?: string };

        this.logger.error(`Terminal session ${sessionId} error: ${err.message}`);
        this.terminalSessions.delete(sessionId);
      });

      this.logger.log(`Created terminal session ${sessionId} for container ${containerId}`);

      return stream;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error creating terminal session: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Send input to a terminal session.
   * @param sessionId - The session identifier
   * @param data - The data to send (string or Buffer)
   * @throws NotFoundException if session is not found
   */
  async sendTerminalInput(sessionId: string, data: string | Buffer): Promise<void> {
    const session = this.terminalSessions.get(sessionId);

    if (!session) {
      throw new NotFoundException(`Terminal session '${sessionId}' not found`);
    }

    try {
      const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

      session.stream.write(buffer);
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error sending input to terminal session ${sessionId}: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Close a terminal session.
   * @param sessionId - The session identifier
   * @throws NotFoundException if session is not found
   */
  async closeTerminalSession(sessionId: string): Promise<void> {
    const session = this.terminalSessions.get(sessionId);

    if (!session) {
      throw new NotFoundException(`Terminal session '${sessionId}' not found`);
    }

    try {
      // End the stream
      session.stream.end();
      // Remove from map (cleanup handlers will also remove it, but do it explicitly)
      this.terminalSessions.delete(sessionId);
      this.logger.log(`Closed terminal session ${sessionId}`);
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error closing terminal session ${sessionId}: ${err.message}`, err.stack);
      // Remove from map even if close fails
      this.terminalSessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * Get a terminal session stream.
   * @param sessionId - The session identifier
   * @returns The terminal session stream
   * @throws NotFoundException if session is not found
   */
  getTerminalSession(sessionId: string): NodeJS.ReadWriteStream {
    const session = this.terminalSessions.get(sessionId);

    if (!session) {
      throw new NotFoundException(`Terminal session '${sessionId}' not found`);
    }

    return session.stream;
  }

  /**
   * Check if a terminal session exists.
   * @param sessionId - The session identifier
   * @returns True if session exists, false otherwise
   */
  hasTerminalSession(sessionId: string): boolean {
    return this.terminalSessions.has(sessionId);
  }

  /**
   * Get all active terminal sessions for a container.
   * @param containerId - The container ID
   * @returns Array of session IDs
   */
  getTerminalSessionsForContainer(containerId: string): string[] {
    const sessionIds: string[] = [];

    for (const [sessionId, session] of this.terminalSessions.entries()) {
      if (session.containerId === containerId) {
        sessionIds.push(sessionId);
      }
    }

    return sessionIds;
  }

  /**
   * Copy a file from container to host filesystem using docker cp (via getArchive).
   * This method uses Docker's getArchive API to copy files reliably, especially for binary files.
   * @param containerId - The container ID
   * @param containerPath - The absolute path to the file in the container
   * @param hostPath - The path on the host filesystem where the file should be copied
   * @throws NotFoundException if container or file is not found
   */
  async copyFileFromContainer(containerId: string, containerPath: string, hostPath: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Get the file as a tar archive stream
      const tarStream = await container.getArchive({ path: containerPath });
      // Create directory for the host path if it doesn't exist
      const hostDir = path.dirname(hostPath);

      if (!fs.existsSync(hostDir)) {
        fs.mkdirSync(hostDir, { recursive: true });
      }

      // Write tar stream to a temporary file
      const tempTarPath = `${hostPath}.tar`;
      const writeStream = fs.createWriteStream(tempTarPath);

      tarStream.pipe(writeStream);

      // Wait for the tar file to be written
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        tarStream.on('error', reject);
      });

      // Extract the file from the tar archive
      // The tar archive from getArchive contains the file at the specified path
      // We need to extract it to the host path
      try {
        // Extract the tar file to a temporary directory first
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-cp-'));
        const extractCommand = `tar -xf ${tempTarPath} -C ${tempDir} 2>&1`;
        const { stderr: extractStderr } = await execAsync(extractCommand);

        // Check for extraction errors
        if (extractStderr && !extractStderr.includes('Removing leading')) {
          this.logger.warn(`Tar extraction warnings: ${extractStderr}`);
        }

        // Find the extracted file (it will be in the temp directory with the same structure as container)
        // The tar archive preserves the full path, so we need to find the file
        const findCommand = `find ${tempDir} -type f | head -1`;
        const { stdout: foundFile } = await execAsync(findCommand);
        const extractedFilePath = foundFile.trim();

        if (!extractedFilePath || !fs.existsSync(extractedFilePath)) {
          // Try alternative: the file might be at the root of tempDir if path was stripped
          const fileName = path.basename(containerPath);
          const alternativePath = path.join(tempDir, fileName);

          if (fs.existsSync(alternativePath)) {
            fs.copyFileSync(alternativePath, hostPath);
          } else {
            throw new NotFoundException(`File not found in container: ${containerPath}`);
          }
        } else {
          // Copy the extracted file to the final host path
          fs.copyFileSync(extractedFilePath, hostPath);
        }

        // Clean up: remove temp tar and temp directory
        fs.unlinkSync(tempTarPath);
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (extractError: unknown) {
        // Clean up temp tar file on error
        if (fs.existsSync(tempTarPath)) {
          try {
            fs.unlinkSync(tempTarPath);
          } catch {
            // Ignore cleanup errors
          }
        }

        const err = extractError as { message?: string; code?: string };

        if (err.code === 'ENOENT' || err.message?.includes('No such file') || err.message?.includes('not found')) {
          throw new NotFoundException(`File not found in container: ${containerPath}`);
        }

        throw extractError;
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error copying file from container: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get container run status (whether it is started or stopped).
   * @param containerId - The container ID
   * @returns Object with running boolean
   * @throws NotFoundException if container is not found
   */
  async getContainerStatus(containerId: string): Promise<{ running: boolean }> {
    try {
      const container = this.docker.getContainer(containerId);
      let inspectInfo: Docker.ContainerInspectInfo;

      try {
        inspectInfo = await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      const running = inspectInfo.State?.Running ?? false;

      return { running };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error getting container status: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get container statistics (CPU, memory, network, etc.).
   * Returns a single snapshot of current container stats.
   * @param containerId - The container ID
   * @returns Container stats object
   * @throws NotFoundException if container is not found
   */
  async getContainerStats(containerId: string): Promise<Docker.ContainerStats> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container exists
      try {
        await container.inspect();
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number };

        if (dockerError.statusCode === 404) {
          throw new NotFoundException(`Container with ID '${containerId}' not found`);
        }

        throw error;
      }

      // Get stats (stream: false to get a single snapshot)
      // dockerode's stats() with stream: false uses callback pattern
      const stats = await new Promise<Docker.ContainerStats>((resolve, reject) => {
        container.stats({ stream: false }, (err: unknown, statsData: Docker.ContainerStats) => {
          if (err) {
            reject(err);
          } else {
            resolve(statsData);
          }
        });
      });

      return stats;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const err = error as { message?: string; stack?: string };

      this.logger.error(`Error getting container stats: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Ensure a Docker image exists.
   * @param image - The image name (including tag)
   * @throws NotFoundException if image is not found
   */
  async ensureImageExists(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch (error: unknown) {
      const err = error as { statusCode?: number };

      if (err.statusCode === 404) {
        await this.docker.pull(image);
      }
    }
  }
}
