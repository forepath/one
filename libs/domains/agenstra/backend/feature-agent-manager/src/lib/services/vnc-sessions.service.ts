import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { CreateVncSessionResponseDto } from '../dto/create-vnc-session-response.dto';
import { AgentsRepository } from '../repositories/agents.repository';

import { DockerService } from './docker.service';
import { VncTicketService } from './vnc-ticket.service';

@Injectable()
export class VncSessionsService {
  private readonly logger = new Logger(VncSessionsService.name);

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly vncTicketService: VncTicketService,
  ) {}

  async createSession(agentId: string): Promise<CreateVncSessionResponseDto> {
    const agent = await this.agentsRepository.findByIdOrThrow(agentId);
    const containerId = agent.containerId?.trim();

    if (!containerId) {
      throw new NotFoundException('Agent container not found');
    }

    const status = await this.dockerService.getContainerStatus(containerId);

    if (!status.running) {
      throw new ServiceUnavailableException('Agent container is not running');
    }

    const minted = this.vncTicketService.mint(agentId, containerId);

    this.logger.log(`Minted VNC ticket for agent ${agentId}`);

    return {
      ticket: minted.ticket,
      expiresIn: minted.expiresIn,
    };
  }
}
