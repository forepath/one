// Types based on OpenAPI spec
export interface EnvironmentVariableResponseDto {
  id: string;
  agentId: string;
  variable: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnvironmentVariableDto {
  variable: string;
  content: string;
}

export interface UpdateEnvironmentVariableDto {
  variable: string;
  content: string;
}

export interface ListEnvironmentVariablesParams {
  limit?: number;
  offset?: number;
}
