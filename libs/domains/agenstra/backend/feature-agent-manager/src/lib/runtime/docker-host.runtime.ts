/**
 * The Docker host runtime (`AGENT_RUNTIME=docker`, the default): agent environments as containers on the Docker
 * host the manager runs on, egress filtered by the per-agent guard sidecar. It is today's {@link DockerService},
 * unchanged; this alias gives it its runtime-neutral name next to the other {@link AgentRuntime} implementations.
 */
export { DockerService as DockerHostRuntime } from '../services/docker.service';
