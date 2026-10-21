/**
 * Lightweight reachability check of a workspace's agent-manager (`GET /clients/:id/ping`).
 */
export class ClientPingResponseDto {
  /** True when the agent-manager answered its health endpoint. */
  reachable!: boolean;
  /** Why the workspace cannot be reached (only when `reachable` is false). */
  error?: string;
  checkedAt!: string;
}
