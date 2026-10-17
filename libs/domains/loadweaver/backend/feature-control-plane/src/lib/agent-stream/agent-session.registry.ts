import type { Envelope } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

export interface AgentSession {
  nodeName: string;
  sessionId: string;
  connectedAt: Date;
  /** Highest desired-state revision delivered on this session. */
  sentRevision: number;
  send(envelope: Envelope): void;
  close(reason: string): void;
}

/**
 * Agent streams connected to this control-plane replica. One session per node: a newer connection
 * replaces an older one (e.g. after the make-before-break switch to the WireGuard path, 3.21).
 */
@Injectable()
export class AgentSessionRegistry {
  private readonly logger = new Logger(AgentSessionRegistry.name);
  private readonly sessions = new Map<string, AgentSession>();

  register(session: AgentSession): void {
    const previous = this.sessions.get(session.nodeName);

    this.sessions.set(session.nodeName, session);

    if (previous && previous.sessionId !== session.sessionId) {
      previous.close('replaced by a newer connection');
      this.logger.log(`Replaced agent session of ${session.nodeName}`);
    }
  }

  unregister(session: AgentSession): void {
    if (this.sessions.get(session.nodeName)?.sessionId === session.sessionId) {
      this.sessions.delete(session.nodeName);
    }
  }

  get(nodeName: string): AgentSession | undefined {
    return this.sessions.get(nodeName);
  }

  all(): AgentSession[] {
    return [...this.sessions.values()];
  }

  /** Closes the session of a node whose identity was revoked (node left, certificate rotated out). */
  disconnect(nodeName: string, reason: string): void {
    const session = this.sessions.get(nodeName);

    if (session) {
      this.sessions.delete(nodeName);
      session.close(reason);
    }
  }
}
