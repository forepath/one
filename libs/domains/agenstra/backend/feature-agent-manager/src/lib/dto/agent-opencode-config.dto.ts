import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertAgentOpencodeConfigDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  overrides?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  secrets?: Record<string, string> | null;
}

export class AgentOpencodeConfigResponseDto {
  config!: Record<string, unknown>;
  overrides!: Record<string, unknown>;
  secretKeys!: string[];
  updatedAt?: Date;
}

export class SyncAgentOpencodeConfigDto {
  @IsObject()
  config!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;
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

/** Slash-invokable entry from OpenCode `GET /command` (commands, skills, MCP prompts, builtins). */
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

/** OpenCode `MCPStatus` for one configured MCP server. */
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

export class OpencodeMcpAuthStartDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  redirectUri?: string;
}
