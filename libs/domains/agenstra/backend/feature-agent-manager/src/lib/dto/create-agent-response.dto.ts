import { AgentResponseDto } from './agent-response.dto';

/**
 * DTO for agent creation response.
 * Includes the generated password that should be securely communicated to the user.
 */
export class CreateAgentResponseDto extends AgentResponseDto {
  /**
   * The randomly generated password for the agent.
   * This is only returned once during creation and should be securely stored by the caller.
   */
  password!: string;
}
