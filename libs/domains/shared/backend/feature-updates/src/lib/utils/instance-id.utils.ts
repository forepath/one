import { hostname } from 'os';

export interface ResolveInstanceIdOptions {
  instanceIdEnv?: string;
  serviceName: string;
  role: string;
  hostname?: string;
  env?: NodeJS.ProcessEnv;
}

export function resolveInstanceId(options: ResolveInstanceIdOptions): string {
  const env = options.env ?? process.env;
  const configuredInstanceId = (options.instanceIdEnv ?? env.INSTANCE_ID)?.trim();

  if (configuredInstanceId) {
    return configuredInstanceId;
  }

  const resolvedHostname = options.hostname ?? env.HOSTNAME?.trim() ?? hostname();

  return `${options.serviceName}:${options.role}:${resolvedHostname}`;
}

export function resolveServiceRole(
  env: NodeJS.ProcessEnv = process.env,
  resolveServiceRoleOverride?: () => string,
): string {
  if (resolveServiceRoleOverride) {
    return resolveServiceRoleOverride();
  }

  const queueRole = env.QUEUE_ROLE?.trim();

  if (queueRole) {
    return queueRole;
  }

  const agentManagerRole = env.AGENT_MANAGER_ROLE?.trim();

  if (agentManagerRole) {
    return agentManagerRole;
  }

  return 'api';
}
