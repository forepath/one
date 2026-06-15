import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { RunVerifierCommandsDto, RunVerifierCommandsResponseDto } from '../dto/run-verifier-commands.dto';
import { AgentsVerificationService } from '../services/agents-verification.service';

/**
 * Bounded shell execution inside agent containers for ticket automation verification.
 */
@Controller('agents/:agentId/automation')
export class AgentsVerificationController {
  constructor(private readonly agentsVerificationService: AgentsVerificationService) {}

  @Post('verify-commands')
  async verifyCommands(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: RunVerifierCommandsDto,
  ): Promise<RunVerifierCommandsResponseDto> {
    return await this.agentsVerificationService.runVerifierCommands(agentId, body);
  }
}
