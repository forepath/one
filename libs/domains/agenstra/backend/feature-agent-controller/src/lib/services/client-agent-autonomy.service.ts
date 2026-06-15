import {
  ClientUsersRepository,
  ensureClientAccess,
  ensureWorkspaceManagementAccess,
  getUserFromRequest,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  ClientAgentAutonomyResponseDto,
  EnabledAutonomyAgentIdsResponseDto,
  UpsertClientAgentAutonomyDto,
} from '../dto/ticket-automation';
import { ClientAgentAutonomyEntity } from '../entities/client-agent-autonomy.entity';
import { ClientsRepository } from '../repositories/clients.repository';

@Injectable()
export class ClientAgentAutonomyService {
  constructor(
    @InjectRepository(ClientAgentAutonomyEntity)
    private readonly repo: Repository<ClientAgentAutonomyEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  private async assertAccess(clientId: string, req?: RequestWithUser): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  private async assertWorkspaceManagement(clientId: string, req?: RequestWithUser): Promise<void> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  private map(row: ClientAgentAutonomyEntity): ClientAgentAutonomyResponseDto {
    return {
      clientId: row.clientId,
      agentId: row.agentId,
      enabled: row.enabled,
      preImproveTicket: row.preImproveTicket,
      maxRuntimeMs: row.maxRuntimeMs,
      maxIterations: row.maxIterations,
      tokenBudgetLimit: row.tokenBudgetLimit ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async get(clientId: string, agentId: string, req?: RequestWithUser): Promise<ClientAgentAutonomyResponseDto> {
    await this.assertAccess(clientId, req);
    const row = await this.repo.findOne({ where: { clientId, agentId } });

    if (!row) {
      throw new NotFoundException('Autonomy settings not found for this client and agent');
    }

    return this.map(row);
  }

  /**
   * Agent IDs with `enabled` autonomy for this client. The autonomous run scheduler only considers
   * tickets whose allowed-agent list intersects this set (see `AutonomousRunOrchestratorService`).
   */
  async listEnabledAgentIds(clientId: string, req?: RequestWithUser): Promise<EnabledAutonomyAgentIdsResponseDto> {
    await this.assertAccess(clientId, req);
    const rows = await this.repo.find({
      where: { clientId, enabled: true },
      select: ['agentId'],
      order: { agentId: 'ASC' },
    });

    return { agentIds: rows.map((r) => r.agentId) };
  }

  async upsert(
    clientId: string,
    agentId: string,
    dto: UpsertClientAgentAutonomyDto,
    req?: RequestWithUser,
  ): Promise<ClientAgentAutonomyResponseDto> {
    await this.assertWorkspaceManagement(clientId, req);
    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (!info.userId) {
      throw new BadRequestException('Interactive user required to edit autonomy settings');
    }

    const row = await this.repo.save(
      this.repo.create({
        clientId,
        agentId,
        enabled: dto.enabled,
        preImproveTicket: dto.preImproveTicket,
        maxRuntimeMs: dto.maxRuntimeMs,
        maxIterations: dto.maxIterations,
        tokenBudgetLimit: dto.tokenBudgetLimit ?? null,
      }),
    );

    return this.map(row);
  }
}
