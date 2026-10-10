import { Injectable, Logger, Optional } from '@nestjs/common';

import { OpenCodeClientFactory } from '../providers/opencode/opencode-client.factory';
import { OpenCodeEventBridge } from '../providers/opencode/opencode-event-bridge';

import { AgentGitCredentialsService } from './agent-git-credentials.service';
import { WorkspaceInotifySupervisor } from './workspace-inotify-supervisor.service';

/**
 * Resets manager-side runtime state bound to an agent container after the container was restarted
 * or recreated (e.g. to apply environment changes): cached OpenCode clients, the shared OpenCode
 * event stream and the workspace inotify exec do not survive the container's processes, and the Git
 * credential files (`~/.ssh`, `~/.netrc`) must reflect the current environment.
 */
@Injectable()
export class AgentRuntimeRefreshService {
  private readonly logger = new Logger(AgentRuntimeRefreshService.name);

  constructor(
    @Optional() private readonly openCodeClientFactory?: OpenCodeClientFactory,
    @Optional() private readonly openCodeEventBridge?: OpenCodeEventBridge,
    @Optional() private readonly workspaceInotifySupervisor?: WorkspaceInotifySupervisor,
    @Optional() private readonly gitCredentials?: AgentGitCredentialsService,
  ) {}

  /** Drop cached connections so the next request targets the restarted processes. */
  invalidateConnections(agentId: string): void {
    this.openCodeClientFactory?.invalidate(agentId);
    this.openCodeEventBridge?.closeForAgent(agentId);
  }

  /**
   * Wait until OpenCode in the restarted container is healthy.
   * @returns `true` when healthy; `false` when the check failed (logged as warning)
   */
  async waitForHealthy(agentId: string, containerId: string): Promise<boolean> {
    if (!this.openCodeClientFactory) {
      return true;
    }

    try {
      await this.openCodeClientFactory.waitForHealthy(agentId, containerId);

      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `OpenCode health check failed after environment update for agent ${agentId}: ${(error as Error).message}`,
      );

      return false;
    }
  }

  /** Re-attach long-lived execs (workspace watcher) after the container came back. */
  async reattachWatchers(agentId: string): Promise<void> {
    try {
      await this.workspaceInotifySupervisor?.restartWatcherIfActive(agentId);
    } catch (error: unknown) {
      this.logger.warn(`Failed to re-attach workspace watcher for agent ${agentId}: ${(error as Error).message}`);
    }
  }

  /**
   * Re-provision the Git credential files from the container environment (rotated SSH key / token,
   * or files dropped by a container recreate).
   * @returns `true` when restored or nothing to restore; `false` when it failed (logged as warning)
   */
  async restoreGitCredentials(agentId: string, containerId: string): Promise<boolean> {
    if (!this.gitCredentials) {
      return true;
    }

    try {
      const result = await this.gitCredentials.restoreFromContainerEnvironment(containerId);

      if (result !== 'skipped') {
        this.logger.log(`Restored Git ${result} credentials for agent ${agentId}`);
      }

      return true;
    } catch (error: unknown) {
      this.logger.warn(`Failed to restore Git credentials for agent ${agentId}: ${(error as Error).message}`);

      return false;
    }
  }
}
