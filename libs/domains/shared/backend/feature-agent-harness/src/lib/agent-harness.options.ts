import type { AgentHarnessConnectionConfig, AgentHarnessOptions } from '@forepath/shared/shared/util-agent-harness';
import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency } from '@nestjs/common';

export const AGENT_HARNESS_MODULE_OPTIONS = Symbol('AGENT_HARNESS_MODULE_OPTIONS');

export interface AgentHarnessModuleOptions
  extends Omit<
    AgentHarnessOptions<any>,
    'client' | 'connection' | 'tools' | 'contextProviders' | 'onToolError' | 'onContextError'
  > {
  connection: AgentHarnessConnectionConfig;
  /**
   * Register `@AgentTool()` / `@AgentContext()` methods of all providers of the application (default true). Disable to
   * register tools manually through {@link AgentHarnessService}.
   */
  discover?: boolean;
}

export interface AgentHarnessModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: any[]) => AgentHarnessModuleOptions | Promise<AgentHarnessModuleOptions>;
  /** Register the module globally (default true). */
  global?: boolean;
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Module options from environment variables (`<prefix>_API_URL`, `_CLIENT_ID`, `_AGENT_ID`, `_API_KEY`, `_MODEL`,
 * `_INSTRUCTIONS`, `_TOOL_ACTIVITY`, `_MAX_TOOL_ROUNDS`, `_ALLOW_INSECURE_HTTP`). Returns undefined when the harness
 * is not configured (no API URL), so applications can make the integration optional.
 */
export function agentHarnessOptionsFromEnv(
  prefix = 'AGENT_HARNESS',
  env: NodeJS.ProcessEnv = process.env,
): AgentHarnessModuleOptions | undefined {
  const apiUrl = env[`${prefix}_API_URL`]?.trim();

  if (!apiUrl) {
    return undefined;
  }

  const maxToolRounds = Number.parseInt(env[`${prefix}_MAX_TOOL_ROUNDS`] ?? '', 10);
  const apiKey = env[`${prefix}_API_KEY`]?.trim();

  return {
    connection: {
      apiUrl,
      clientId: env[`${prefix}_CLIENT_ID`]?.trim() ?? '',
      agentId: env[`${prefix}_AGENT_ID`]?.trim() ?? '',
      ...(apiKey ? { credential: apiKey } : {}),
      ...(readBoolean(env[`${prefix}_ALLOW_INSECURE_HTTP`]) ? { allowInsecureHttp: true } : {}),
    },
    ...(env[`${prefix}_MODEL`]?.trim() ? { model: env[`${prefix}_MODEL`]?.trim() } : {}),
    ...(env[`${prefix}_INSTRUCTIONS`]?.trim() ? { instructions: env[`${prefix}_INSTRUCTIONS`]?.trim() } : {}),
    ...(readBoolean(env[`${prefix}_TOOL_ACTIVITY`]) !== undefined
      ? { toolActivity: readBoolean(env[`${prefix}_TOOL_ACTIVITY`]) }
      : {}),
    ...(Number.isFinite(maxToolRounds) && maxToolRounds > 0 ? { maxToolRounds } : {}),
  };
}
