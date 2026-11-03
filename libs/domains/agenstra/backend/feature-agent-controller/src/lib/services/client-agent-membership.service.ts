import { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import { Injectable } from '@nestjs/common';

/** Confirmed memberships are re-read after this long (credentials are removed with the agent, see `forget`). */
const MEMBER_TTL_MS = 60_000;
/** Non-members are re-read quickly: an agent just created in the workspace becomes reachable at once. */
const NON_MEMBER_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 10_000;

/**
 * Which agents belong to a workspace. Several workspaces can point at the same agent-manager (same endpoint and API
 * key); the manager knows all its agents, the controller only the ones a workspace created (their stored credentials,
 * also required to log into an agent). Everything the controller proxies for a workspace — agent routes, agent lists,
 * manager-wide feeds and socket events — is limited to these agents.
 */
@Injectable()
export class ClientAgentMembershipService {
  private readonly cache = new Map<string, { member: boolean; checkedAt: number }>();
  /** Agent names being created per workspace (progress of a create has no agent id / credentials yet). */
  private readonly pendingCreates = new Map<string, Map<string, number>>();

  constructor(private readonly credentials: ClientAgentCredentialsRepository) {}

  async isMember(clientId: string, agentId: string): Promise<boolean> {
    const key = `${clientId}|${agentId.toLowerCase()}`;
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.checkedAt < (cached.member ? MEMBER_TTL_MS : NON_MEMBER_TTL_MS)) {
      return cached.member;
    }

    const member = !!(await this.credentials.findByClientAndAgent(clientId, agentId.toLowerCase()));

    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }

    this.cache.set(key, { member, checkedAt: Date.now() });

    return member;
  }

  /** The agents of `agents` that belong to the workspace (order kept). */
  async filterMembers<T extends { id: string }>(clientId: string, agents: T[]): Promise<T[]> {
    const members = await Promise.all(agents.map((agent) => this.isMember(clientId, agent.id)));

    return agents.filter((_agent, index) => members[index]);
  }

  /** Credentials of the pair were created or removed: the next check reads them again. */
  forget(clientId: string, agentId: string): void {
    this.cache.delete(`${clientId}|${agentId.toLowerCase()}`);
  }

  /** Mark an agent name as being created by the workspace until the returned release is called. */
  trackCreate(clientId: string, agentName: string): () => void {
    const names = this.pendingCreates.get(clientId) ?? new Map<string, number>();
    const name = agentName.trim();

    names.set(name, (names.get(name) ?? 0) + 1);
    this.pendingCreates.set(clientId, names);

    return () => {
      const count = (names.get(name) ?? 1) - 1;

      if (count > 0) {
        names.set(name, count);
      } else {
        names.delete(name);
      }

      if (names.size === 0) {
        this.pendingCreates.delete(clientId);
      }
    };
  }

  isPendingCreate(clientId: string, agentName: string | null | undefined): boolean {
    return !!agentName && !!this.pendingCreates.get(clientId)?.has(agentName.trim());
  }

  /**
   * A progress / event entry of the manager concerns this workspace: its agent belongs to it, or the workspace is
   * creating an agent of that name right now (creates have no agent id or credentials until they finish).
   */
  async concernsWorkspace(
    clientId: string,
    entry: { agentId?: string | null; agentName?: string | null },
  ): Promise<boolean> {
    if (entry.agentId && (await this.isMember(clientId, entry.agentId))) {
      return true;
    }

    return this.isPendingCreate(clientId, entry.agentName);
  }
}
