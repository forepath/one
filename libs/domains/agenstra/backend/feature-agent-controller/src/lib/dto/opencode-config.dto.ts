import type { AgentEgressStatusDto } from '@forepath/agenstra/backend/feature-agent-manager';
import type { EffectivePlatformSecurityPolicy } from '@forepath/agenstra/shared/util-opencode-config';
import { IsArray, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PUT body for OpenCode config overlays (global / workspace / agent).
 */
export class UpsertOpencodeConfigDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;

  /**
   * Raw JSON patch merged over `config` for this layer (same heredity rules).
   * Empty object clears overrides when provided.
   */
  @IsOptional()
  @IsObject()
  overrides?: Record<string, unknown> | null;

  /**
   * Explicit JSON Pointer locks for lower layers (global / workspace only).
   * Empty array clears locks when provided. Ignored on agent PUT.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locks?: string[] | null;

  /** Secret string map (e.g. provider API keys). Stored GCM-encrypted. */
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string> | null;
}

export class InheritedAdditiveDto {
  @IsString()
  path!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keys?: string[];

  @IsOptional()
  @IsArray()
  items?: unknown[];
}

/** Durable sync target status for an agent's effective OpenCode config. */
export class OpencodeConfigSyncSummaryDto {
  syncStatus!: 'pending' | 'synced' | 'failed';
  desiredRevision?: string;
  appliedRevision?: string | null;
  lastError?: string | null;
  lastSyncedAt?: Date | null;
}

export class OpencodeConfigResponseDto {
  config!: Record<string, unknown>;
  /** Raw JSON overrides for this layer (merged over `config`). */
  overrides!: Record<string, unknown>;
  /**
   * Explicit locks authored on this layer (global / workspace). Empty on agent responses.
   * Lower layers receive these via expanded `lockedPaths`.
   */
  locks!: string[];
  /** Secret keys present (values redacted). */
  secretKeys!: string[];
  /**
   * Full merged config for this scope (lower layers first): agent → workspace → global.
   * Each layer is `compose(config, overrides)` before cross-layer merge.
   * Retains platform keys (`model_allow` / `model_deny`) for editor display; worker sync materializes them.
   * `config` / `overrides` remain the editable fields for the current layer only.
   */
  effective?: Record<string, unknown>;
  /** JSON Pointer paths locked by a higher layer (replace semantics + explicit locks). */
  lockedPaths?: string[];
  /** Additive inherited map keys / array items from parents (read-only in UI). */
  inheritedAdditive?: InheritedAdditiveDto[];
  /** Per-agent effective-config sync target (agent GET/PUT only). */
  sync?: OpencodeConfigSyncSummaryDto | null;
  /**
   * Effective platform security policy for this scope (Security → Web traffic / Message filters),
   * resolved global → workspace → environment with per-entry provenance.
   */
  platformPolicy?: EffectivePlatformSecurityPolicy;
  /** Egress guard status of the environment (agent GET/PUT only). */
  egress?: AgentEgressStatusDto;
  updatedAt?: Date;
}

/** Body for evaluating a destination against an environment's effective egress policy. */
export class EvaluateEgressDestinationDto {
  /** Hostname, IP address or URL (scheme / path optional). */
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  destination!: string;
}

/** Result of {@link EvaluateEgressDestinationDto}. */
export class EgressEvaluationResponseDto {
  host!: string;
  decision!: 'allowed' | 'blocked' | 'observed';
  rule!: string | null;
  matchedEntry?: string | null;
  source?: string | null;
  mode!: string;
  /** Plain-HTTP URL rules only apply to `http://` URLs (HTTPS paths are not visible without TLS interception). */
  scheme?: 'http' | 'https' | null;
}

export class OpencodeAgentInfoDto {
  name!: string;
  description?: string;
  mode!: 'subagent' | 'primary' | 'all';
  builtIn!: boolean;
  prompt?: string;
  model?: {
    modelID: string;
    providerID: string;
  };
  temperature?: number;
  color?: string;
}

export class OpencodeAgentsListResponseDto {
  agents!: OpencodeAgentInfoDto[];
}

/** Slash-invokable OpenCode entry (config command, skill, MCP prompt, or builtin). */
export class OpencodeCommandInfoDto {
  name!: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  /** OpenCode registry source: config/builtin (`command`), MCP prompt, or skill. */
  source?: 'command' | 'mcp' | 'skill';
}

export class OpencodeCommandsListResponseDto {
  commands!: OpencodeCommandInfoDto[];
}

/** OpenCode `MCPStatus` for one configured MCP server on a running Environment. */
export type OpencodeMcpRuntimeStatus = 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration';

export class OpencodeMcpServerStatusDto {
  name!: string;
  status!: OpencodeMcpRuntimeStatus;
  error?: string;
}

export class OpencodeMcpStatusListResponseDto {
  servers!: OpencodeMcpServerStatusDto[];
}

export class OpencodeMcpAuthStartResponseDto {
  authorizationUrl!: string;
  oauthState?: string;
}

export class OpencodeMcpAuthCallbackDto {
  @IsString()
  @MinLength(1)
  code!: string;
}
