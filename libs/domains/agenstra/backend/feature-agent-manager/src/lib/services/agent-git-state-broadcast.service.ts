import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AgentGitStateBroadcastService {
  private readonly logger = new Logger(AgentGitStateBroadcastService.name);
  private broadcaster?: (agentId: string) => void;

  registerBroadcaster(broadcaster: (agentId: string) => void): void {
    this.broadcaster = broadcaster;
  }

  notifyGitStateMayHaveChanged(agentId: string): void {
    if (!this.broadcaster) {
      return;
    }

    try {
      this.broadcaster(agentId);
    } catch (error: unknown) {
      this.logger.warn(`Failed to broadcast git state change for agent ${agentId}: ${(error as Error).message}`);
    }
  }
}
