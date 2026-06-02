import type { AcpLaunchSpec } from './acp-launch-spec.types';

export const CURSOR_ACP_LAUNCH_SPEC: AcpLaunchSpec = {
  executable: 'cursor-agent',
  args: ['acp'],
  cwd: '/app',
  supportsLoadSession: true,
};

export const OPENCODE_ACP_LAUNCH_SPEC: AcpLaunchSpec = {
  executable: 'opencode',
  args: ['acp'],
  cwd: '/app',
  supportsLoadSession: true,
};

export function buildResumeSessionId(agentId: string, containerId: string, resumeSessionSuffix?: string): string {
  return `${agentId}-${containerId}${resumeSessionSuffix ?? ''}`;
}
