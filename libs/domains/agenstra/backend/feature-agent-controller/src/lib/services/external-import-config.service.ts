import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateExternalImportConfigDto } from '../dto/context-import/create-external-import-config.dto';
import { ExternalImportConfigResponseDto } from '../dto/context-import/external-import-config-response.dto';
import { UpdateExternalImportConfigDto } from '../dto/context-import/update-external-import-config.dto';
import { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import { ExternalImportKind, ExternalImportProviderId } from '../entities/external-import.enums';
import { TicketStatus } from '../entities/ticket.enums';

@Injectable()
export class ExternalImportConfigService {
  constructor(
    @InjectRepository(ExternalImportConfigEntity)
    private readonly repo: Repository<ExternalImportConfigEntity>,
  ) {}

  private map(row: ExternalImportConfigEntity): ExternalImportConfigResponseDto {
    return {
      id: row.id,
      provider: row.provider,
      importKind: row.importKind,
      atlassianConnectionId: row.atlassianConnectionId,
      clientId: row.clientId,
      enabled: row.enabled,
      jiraBoardId: row.jiraBoardId ?? null,
      jql: row.jql ?? null,
      importTargetTicketStatus: row.importTargetTicketStatus ?? TicketStatus.DRAFT,
      confluenceSpaceKey: row.confluenceSpaceKey ?? null,
      confluenceRootPageId: row.confluenceRootPageId ?? null,
      cql: row.cql ?? null,
      agenstraParentTicketId: row.agenstraParentTicketId ?? null,
      agenstraParentFolderId: row.agenstraParentFolderId ?? null,
      lastRunAt: row.lastRunAt ?? null,
      lastError: row.lastError ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private assertAnchors(dto: {
    importKind: ExternalImportKind;
    agenstraParentTicketId?: string | null;
    agenstraParentFolderId?: string | null;
  }): void {
    if (dto.importKind === ExternalImportKind.JIRA && dto.agenstraParentFolderId) {
      throw new BadRequestException('Jira import cannot set agenstraParentFolderId');
    }

    if (dto.importKind === ExternalImportKind.CONFLUENCE && dto.agenstraParentTicketId) {
      throw new BadRequestException('Confluence import cannot set agenstraParentTicketId');
    }
  }

  private assertJqlForJira(jql: string | null | undefined): void {
    if (!jql?.trim()) {
      throw new BadRequestException('JQL is required for Jira import configs');
    }
  }

  private assertCqlForConfluence(cql: string | null | undefined): void {
    if (!cql?.trim()) {
      throw new BadRequestException('CQL is required for Confluence import configs');
    }
  }

  async findAll(limit = 10, offset = 0): Promise<ExternalImportConfigResponseDto[]> {
    const rows = await this.repo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return rows.map((r) => this.map(r));
  }

  async findOne(id: string): Promise<ExternalImportConfigResponseDto> {
    const row = await this.repo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Import config not found');
    }

    return this.map(row);
  }

  async findEntityWithConnection(id: string): Promise<ExternalImportConfigEntity | null> {
    return await this.repo.findOne({
      where: { id },
      relations: ['atlassianConnection'],
    });
  }

  async findEnabledForSchedulerBatch(limit: number): Promise<ExternalImportConfigEntity[]> {
    return await this.repo.find({
      where: { enabled: true, provider: ExternalImportProviderId.ATLASSIAN },
      order: { lastRunAt: 'ASC', id: 'ASC' },
      take: limit,
      relations: ['atlassianConnection'],
    });
  }

  async create(dto: CreateExternalImportConfigDto): Promise<ExternalImportConfigResponseDto> {
    if (dto.provider !== ExternalImportProviderId.ATLASSIAN) {
      throw new BadRequestException('Only atlassian provider is supported');
    }

    this.assertAnchors(dto);

    if (dto.importKind === ExternalImportKind.JIRA) {
      this.assertJqlForJira(dto.jql);
    }

    if (dto.importKind === ExternalImportKind.CONFLUENCE) {
      this.assertCqlForConfluence(dto.cql);
    }

    const importTargetTicketStatus =
      dto.importKind === ExternalImportKind.JIRA
        ? (dto.importTargetTicketStatus ?? TicketStatus.DRAFT)
        : TicketStatus.DRAFT;
    const saved = await this.repo.save(
      this.repo.create({
        provider: dto.provider,
        importKind: dto.importKind,
        atlassianConnectionId: dto.atlassianConnectionId,
        clientId: dto.clientId,
        enabled: dto.enabled ?? true,
        jiraBoardId: dto.jiraBoardId ?? null,
        jql: dto.jql ?? null,
        importTargetTicketStatus,
        confluenceSpaceKey: dto.confluenceSpaceKey ?? null,
        confluenceRootPageId: dto.confluenceRootPageId ?? null,
        cql: dto.cql ?? null,
        agenstraParentTicketId: dto.agenstraParentTicketId ?? null,
        agenstraParentFolderId: dto.agenstraParentFolderId ?? null,
      }),
    );

    return this.map(saved);
  }

  async update(id: string, dto: UpdateExternalImportConfigDto): Promise<ExternalImportConfigResponseDto> {
    const row = await this.repo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Import config not found');
    }

    const nextTicket =
      dto.agenstraParentTicketId !== undefined ? dto.agenstraParentTicketId : row.agenstraParentTicketId;
    const nextFolder =
      dto.agenstraParentFolderId !== undefined ? dto.agenstraParentFolderId : row.agenstraParentFolderId;

    this.assertAnchors({
      importKind: row.importKind,
      agenstraParentTicketId: nextTicket,
      agenstraParentFolderId: nextFolder,
    });

    if (dto.atlassianConnectionId !== undefined) {
      row.atlassianConnectionId = dto.atlassianConnectionId;
    }

    if (dto.clientId !== undefined) {
      row.clientId = dto.clientId;
    }

    if (dto.enabled !== undefined) {
      row.enabled = dto.enabled;
    }

    if (dto.jiraBoardId !== undefined) {
      row.jiraBoardId = dto.jiraBoardId;
    }

    if (dto.jql !== undefined) {
      row.jql = dto.jql;
    }

    if (dto.confluenceSpaceKey !== undefined) {
      row.confluenceSpaceKey = dto.confluenceSpaceKey;
    }

    if (dto.confluenceRootPageId !== undefined) {
      row.confluenceRootPageId = dto.confluenceRootPageId;
    }

    if (dto.cql !== undefined) {
      row.cql = dto.cql;
    }

    if (dto.agenstraParentTicketId !== undefined) {
      row.agenstraParentTicketId = dto.agenstraParentTicketId;
    }

    if (dto.agenstraParentFolderId !== undefined) {
      row.agenstraParentFolderId = dto.agenstraParentFolderId;
    }

    if (dto.importTargetTicketStatus !== undefined && row.importKind === ExternalImportKind.JIRA) {
      row.importTargetTicketStatus = dto.importTargetTicketStatus ?? TicketStatus.DRAFT;
    }

    if (row.importKind === ExternalImportKind.JIRA) {
      this.assertJqlForJira(row.jql);
    }

    if (row.importKind === ExternalImportKind.CONFLUENCE) {
      this.assertCqlForConfluence(row.cql);
    }

    const saved = await this.repo.save(row);

    return this.map(saved);
  }

  async recordRunOutcome(id: string, errorMessage: string | null | undefined): Promise<void> {
    const normalized = errorMessage == null || String(errorMessage).trim() === '' ? null : String(errorMessage).trim();
    const row = await this.repo.findOne({ where: { id } });

    if (!row) {
      return;
    }

    row.lastRunAt = new Date();
    row.lastError = normalized;
    await this.repo.save(row);
  }

  async delete(id: string): Promise<void> {
    const res = await this.repo.delete(id);

    if (!res.affected) {
      throw new NotFoundException('Import config not found');
    }
  }
}
