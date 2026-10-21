import { Injectable } from '@nestjs/common';

import type { AgentResponseObject } from './agent-provider.interface';

/**
 * Seam for publishing mapped agent events to future external bus consumers.
 * OpenCode HTTP runtime publishes through this; default implementation is a no-op sink.
 */
export abstract class OutboundAgentEventPublisher {
  abstract publish(agentId: string, event: AgentResponseObject): void | Promise<void>;
}

@Injectable()
export class NoopOutboundAgentEventPublisher extends OutboundAgentEventPublisher {
  publish(_agentId: string, _event: AgentResponseObject): void {
    // Intentionally empty — external bus not wired yet.
  }
}
