import {
  DockerService,
  EGRESS_GUARD_CLI,
  EGRESS_GUARD_STAGED_DIR_NAME,
  EGRESS_GUARD_STATE_DIR,
  type EgressPlatformAllow,
  renderEgressGuardArtifacts,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { normalizeEffectiveEgressPolicy } from '@forepath/agenstra/shared/util-opencode-config';
import Docker = require('dockerode');

import { ISOLATION_LAB_LABEL } from '../../lib/isolation-lab.config';

import { sleep } from './process';
import type { LabVm } from './vm';

/** Small worker stand-in with the tools the specs use (python3, wget, nslookup) and a long-running command. */
export const LAB_WORKER_IMAGE = 'agenstra-isolation-lab-worker:local';
/** Egress guard image built from the repository's Dockerfile.egress-guard (loaded into the lab VM). */
export const LAB_EGRESS_GUARD_IMAGE = 'agenstra-isolation-lab-egress-guard:local';

/**
 * The agent manager's real DockerService, talking to the lab VM's Docker through a tunnelled socket.
 * Everything the manager does on a host (runtime mapping, probes, guard creation) runs unchanged.
 */
export function createLabDockerService(socketPath: string): DockerService {
  const service = new DockerService();

  (service as unknown as { docker: Docker }).docker = new Docker({ socketPath });

  return service;
}

/** Build the lab worker image inside the VM (pulled base image, no registry access needed afterwards). */
export async function buildLabWorkerImage(vm: LabVm): Promise<void> {
  await vm.execOrThrow(
    `docker build -q -t ${LAB_WORKER_IMAGE} --label ${ISOLATION_LAB_LABEL}=image - <<'EOF'
FROM python:3.12-alpine
RUN adduser -D -u 10001 agent
CMD ["sleep", "infinity"]
EOF`,
    { timeoutMs: 10 * 60_000 },
  );
}

export interface LabGuardPolicy {
  mode: 'off' | 'monitor' | 'enforce' | 'offline';
  allowHosts?: string[];
  blockPrivateNetworks?: boolean;
}

/** Render, upload and activate a guard policy exactly like AgentEgressService.applyPolicyToGuard. */
export async function applyLabGuardPolicy(
  docker: DockerService,
  guardId: string,
  policy: LabGuardPolicy,
  platformAllows: EgressPlatformAllow[] = [],
): Promise<void> {
  const effective = normalizeEffectiveEgressPolicy({
    mode: policy.mode,
    allowHosts: (policy.allowHosts ?? []).map((value) => ({ value, source: 'platform' })),
    denyHosts: [],
    denyUrlPatterns: [],
    networkAllow: [],
    blockPrivateNetworks: policy.blockPrivateNetworks ?? true,
    blockIpLiterals: true,
    logAllowed: true,
  });
  const artifacts = renderEgressGuardArtifacts(effective, null, [], platformAllows);

  await docker.sendCommandToContainer(guardId, [EGRESS_GUARD_CLI, 'prepare'], undefined, true, { user: '0' });
  await docker.putFilesIntoContainer(
    guardId,
    `${EGRESS_GUARD_STATE_DIR}/${EGRESS_GUARD_STAGED_DIR_NAME}`,
    Object.entries(artifacts.files).map(([name, content]) => ({ name, content, mode: 0o640 })),
  );
  await docker.sendCommandToContainer(guardId, [EGRESS_GUARD_CLI, 'apply'], undefined, true, { user: '0' });
}

/** Wait until Squid and dnsmasq of a guard run (like AgentEgressService.waitForGuardReady). */
export async function waitForLabGuard(docker: DockerService, guardId: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';

  while (Date.now() < deadline) {
    last = await docker
      .sendCommandToContainer(guardId, [EGRESS_GUARD_CLI, 'status'], undefined, true, { user: '0' })
      .catch((error: unknown) => String((error as Error).message));

    const line = last
      .split('\n')
      .reverse()
      .find((entry) => entry.trim().startsWith('{'));
    let status: { squid?: boolean; dnsmasq?: boolean } | null = null;

    try {
      status = line ? (JSON.parse(line) as { squid?: boolean; dnsmasq?: boolean }) : null;
    } catch {
      status = null;
    }

    if (status?.squid && status.dnsmasq) {
      return;
    }

    await sleep(500);
  }

  throw new Error(`Egress guard ${guardId.slice(0, 12)} did not become ready: ${last.slice(-500)}`);
}

/** Exit code and output of a command run in a container as the (unprivileged) agent user. */
export async function execInLabContainer(
  docker: DockerService,
  containerId: string,
  script: string,
  user = '10001',
): Promise<{ ok: boolean; output: string }> {
  try {
    const output = await docker.sendCommandToContainer(containerId, ['sh', '-c', script], undefined, true, { user });

    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: String((error as Error).message) };
  }
}
