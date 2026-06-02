/**
 * How to spawn an ACP-speaking agent process inside a worker container.
 */
export interface AcpLaunchSpec {
  /** argv[0] executable name or path (must be on worker PATH). */
  executable: string;
  /** Additional argv entries after executable (e.g. `acp`). */
  args: string[];
  /** Working directory inside the container for session/new cwd. */
  cwd: string;
  /** When true, prefer session/load with a stable resume id over session/new. */
  supportsLoadSession: boolean;
}

export interface AcpSessionKey {
  agentId: string;
  containerId: string;
  resumeSessionSuffix?: string;
}
