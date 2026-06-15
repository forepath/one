import { Injectable } from '@nestjs/common';

interface PendingHydrationSummary {
  summary: string;
  expiresAt: number;
}

@Injectable()
export class AgentSessionHydrationService {
  private readonly pendingByAgentId = new Map<string, PendingHydrationSummary>();
  private readonly ttlMs = 15 * 60 * 1000;

  storePendingSummary(agentId: string, summary: string): void {
    const trimmed = summary.trim();

    if (!trimmed) {
      return;
    }

    this.pendingByAgentId.set(agentId, {
      summary: trimmed,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  consumePendingSummary(agentId: string): string | undefined {
    const pending = this.pendingByAgentId.get(agentId);

    if (!pending) {
      return undefined;
    }

    this.pendingByAgentId.delete(agentId);

    if (pending.expiresAt <= Date.now()) {
      return undefined;
    }

    return pending.summary;
  }
}
