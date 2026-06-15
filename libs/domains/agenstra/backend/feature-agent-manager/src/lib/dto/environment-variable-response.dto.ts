/**
 * DTO for environment variable API responses.
 */
export class EnvironmentVariableResponseDto {
  id!: string;
  agentId!: string;
  variable!: string;
  content!: string;
  createdAt!: Date;
  updatedAt!: Date;
}
