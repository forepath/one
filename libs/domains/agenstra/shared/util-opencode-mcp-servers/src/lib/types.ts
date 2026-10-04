/**
 * Built-in MCP server catalog metadata (from the official MCP Registry).
 *
 * @see https://registry.modelcontextprotocol.io/docs
 * @see https://raw.githubusercontent.com/modelcontextprotocol/registry/refs/heads/main/docs/reference/api/openapi.yaml
 */

/** Registry package argument (positional or named). */
export interface OpencodeBuiltinMcpArgument {
  type: 'positional' | 'named';
  name?: string;
  valueHint?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  isRepeated?: boolean;
  format?: 'string' | 'number' | 'boolean' | 'filepath';
  value?: string;
  default?: string;
  placeholder?: string;
  choices?: string[];
}

/** Environment variable or header input declared by a package / remote. */
export interface OpencodeBuiltinMcpKeyValueInput {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  format?: 'string' | 'number' | 'boolean' | 'filepath';
  value?: string;
  default?: string;
  placeholder?: string;
  choices?: string[];
}

/** Local package install recipe from the registry. */
export interface OpencodeBuiltinMcpPackage {
  registryType: string;
  identifier: string;
  version?: string;
  registryBaseUrl?: string;
  runtimeHint?: string;
  transport?: {
    type: string;
    url?: string;
    headers?: OpencodeBuiltinMcpKeyValueInput[];
  };
  runtimeArguments?: OpencodeBuiltinMcpArgument[];
  packageArguments?: OpencodeBuiltinMcpArgument[];
  environmentVariables?: OpencodeBuiltinMcpKeyValueInput[];
}

/** Remote transport entry from the registry. */
export interface OpencodeBuiltinMcpRemote {
  type: string;
  url: string;
  headers?: OpencodeBuiltinMcpKeyValueInput[];
  variables?: Record<string, OpencodeBuiltinMcpKeyValueInput>;
}

/** Cached MCP Registry server (latest version). */
export interface OpencodeBuiltinMcpServer {
  /** Reverse-DNS server name (`io.github.user/weather`). Used as catalog id. */
  name: string;
  /** Human-readable title (falls back to name). */
  title: string;
  description: string;
  version: string;
  status: 'active' | 'deprecated' | 'deleted' | string;
  websiteUrl?: string;
  packages: OpencodeBuiltinMcpPackage[];
  remotes: OpencodeBuiltinMcpRemote[];
}

/**
 * Seeded `mcp.servers.<id>` overlay entry produced from a catalog server.
 * `secretEnv` / `secretHeaders` / `registry` are UI/layer metadata stripped before OpenCode wire.
 */
export interface OpencodeMcpServerSeed {
  type: 'local' | 'remote';
  command?: string[];
  environment?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Env var names whose values live in layer secrets (not config). */
  secretEnv: string[];
  /** Header names whose values live in layer secrets (not config). */
  secretHeaders: string[];
  /** Catalog reverse-DNS name; used for allow/deny classification (stripped on wire). */
  registry?: string;
}
