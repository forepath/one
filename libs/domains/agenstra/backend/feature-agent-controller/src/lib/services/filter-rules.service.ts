import {
  assertReplaceContentForFilterType,
  compileRegexOrThrow,
  normalizeRegexFlags,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateFilterRuleDto } from '../dto/filter-rules/create-filter-rule.dto';
import {
  FilterRuleResponseDto,
  FilterRuleSyncSummaryDto,
  FilterRuleWorkspaceSyncDto,
} from '../dto/filter-rules/filter-rule-response.dto';
import { UpdateFilterRuleDto } from '../dto/filter-rules/update-filter-rule.dto';
import { AgentConsoleRegexFilterRuleClientEntity } from '../entities/agent-console-regex-filter-rule-client.entity';
import { AgentConsoleRegexFilterRuleSyncTargetEntity } from '../entities/agent-console-regex-filter-rule-sync-target.entity';
import { AgentConsoleRegexFilterRuleEntity } from '../entities/agent-console-regex-filter-rule.entity';
import { ClientsRepository } from '../repositories/clients.repository';

import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { AgentManagerFilterRulesClientService } from './agent-manager-filter-rules-client.service';

@Injectable()
export class FilterRulesService {
  private readonly logger = new Logger(FilterRulesService.name);

  constructor(
    @InjectRepository(AgentConsoleRegexFilterRuleEntity)
    private readonly rulesRepo: Repository<AgentConsoleRegexFilterRuleEntity>,
    @InjectRepository(AgentConsoleRegexFilterRuleClientEntity)
    private readonly linksRepo: Repository<AgentConsoleRegexFilterRuleClientEntity>,
    @InjectRepository(AgentConsoleRegexFilterRuleSyncTargetEntity)
    private readonly targetsRepo: Repository<AgentConsoleRegexFilterRuleSyncTargetEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly agentManagerFilterRulesClient: AgentManagerFilterRulesClientService,
    private readonly notificationPublisher: AgenstraNotificationPublisher,
  ) {}

  async findAll(limit = 10, offset = 0): Promise<FilterRuleResponseDto[]> {
    const rules = await this.rulesRepo.find({
      order: { priority: 'ASC', createdAt: 'ASC' },
      relations: { clientLinks: true },
      take: limit,
      skip: offset,
    });
    const out: FilterRuleResponseDto[] = [];

    for (const r of rules) {
      out.push(await this.toResponse(r));
    }

    return out;
  }

  async findOne(id: string): Promise<FilterRuleResponseDto> {
    const rule = await this.rulesRepo.findOne({ where: { id }, relations: { clientLinks: true } });

    if (!rule) {
      throw new NotFoundException(`Filter rule ${id} not found`);
    }

    return await this.toResponse(rule);
  }

  async create(dto: CreateFilterRuleDto): Promise<FilterRuleResponseDto> {
    this.validateWorkspaceIds(dto);
    const flags = normalizeRegexFlags(dto.regexFlags);

    compileRegexOrThrow(dto.pattern, flags);
    assertReplaceContentForFilterType(dto.filterType, dto.replaceContent);

    const rule = this.rulesRepo.create({
      pattern: dto.pattern,
      regexFlags: flags,
      direction: dto.direction,
      filterType: dto.filterType,
      replaceContent: dto.filterType === 'filter' ? dto.replaceContent : null,
      priority: dto.priority ?? 0,
      enabled: dto.enabled ?? true,
      isGlobal: dto.isGlobal,
    });
    const saved = await this.rulesRepo.save(rule);

    if (!dto.isGlobal) {
      for (const clientId of dto.workspaceIds!) {
        await this.clientsRepository.findByIdOrThrow(clientId);
        await this.linksRepo.save(this.linksRepo.create({ ruleId: saved.id, clientId }));
      }
    }

    await this.reconcileSyncTargets(saved.id, true);

    const response = await this.findOne(saved.id);

    this.notificationPublisher.publishFilterRule('filter_rule.created', response);

    return response;
  }

  async update(id: string, dto: UpdateFilterRuleDto): Promise<FilterRuleResponseDto> {
    const rule = await this.rulesRepo.findOne({ where: { id }, relations: { clientLinks: true } });

    if (!rule) {
      throw new NotFoundException(`Filter rule ${id} not found`);
    }

    if (dto.pattern !== undefined) {
      rule.pattern = dto.pattern;
    }

    if (dto.regexFlags !== undefined) {
      rule.regexFlags = normalizeRegexFlags(dto.regexFlags);
    }

    if (dto.direction !== undefined) {
      rule.direction = dto.direction;
    }

    if (dto.filterType !== undefined) {
      rule.filterType = dto.filterType;
    }

    if (dto.replaceContent !== undefined) {
      rule.replaceContent = dto.replaceContent;
    }

    if (dto.priority !== undefined) {
      rule.priority = dto.priority;
    }

    if (dto.enabled !== undefined) {
      rule.enabled = dto.enabled;
    }

    if (dto.isGlobal !== undefined) {
      rule.isGlobal = dto.isGlobal;
    }

    if (rule.filterType !== 'filter') {
      rule.replaceContent = null;
    }

    assertReplaceContentForFilterType(rule.filterType, rule.replaceContent);
    compileRegexOrThrow(rule.pattern, rule.regexFlags);

    await this.rulesRepo.save(rule);

    if (dto.isGlobal === true) {
      await this.linksRepo.delete({ ruleId: id });
    } else if (dto.isGlobal === false) {
      if (!dto.workspaceIds?.length) {
        throw new BadRequestException('workspaceIds required when isGlobal is false');
      }

      await this.linksRepo.delete({ ruleId: id });

      for (const clientId of dto.workspaceIds) {
        await this.clientsRepository.findByIdOrThrow(clientId);
        await this.linksRepo.save(this.linksRepo.create({ ruleId: id, clientId }));
      }
    } else if (dto.workspaceIds !== undefined && rule.isGlobal) {
      throw new BadRequestException('Set isGlobal to false before assigning workspaceIds');
    } else if (dto.workspaceIds !== undefined && !rule.isGlobal) {
      await this.linksRepo.delete({ ruleId: id });

      for (const clientId of dto.workspaceIds) {
        await this.clientsRepository.findByIdOrThrow(clientId);
        await this.linksRepo.save(this.linksRepo.create({ ruleId: id, clientId }));
      }
    }

    await this.reconcileSyncTargets(id, true);

    const response = await this.findOne(id);

    this.notificationPublisher.publishFilterRule('filter_rule.updated', response);

    return response;
  }

  async delete(id: string): Promise<void> {
    const rule = await this.rulesRepo.findOne({ where: { id } });

    if (!rule) {
      throw new NotFoundException(`Filter rule ${id} not found`);
    }

    const response = await this.findOne(id);

    const targets = await this.targetsRepo.find({ where: { ruleId: id } });

    for (const t of targets) {
      if (t.managerRuleId) {
        try {
          await this.agentManagerFilterRulesClient.deleteRule(t.clientId, t.managerRuleId);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);

          this.logger.warn(`Could not delete remote filter ${t.managerRuleId} for client ${t.clientId}: ${msg}`);
        }
      }
    }

    await this.rulesRepo.remove(rule);
    this.notificationPublisher.publishFilterRule('filter_rule.deleted', response);
  }

  private validateWorkspaceIds(dto: CreateFilterRuleDto): void {
    if (!dto.isGlobal && (!dto.workspaceIds || dto.workspaceIds.length === 0)) {
      throw new BadRequestException('workspaceIds required when isGlobal is false');
    }
  }

  async reconcileSyncTargets(ruleId: string, bump: boolean): Promise<void> {
    const rule = await this.rulesRepo.findOne({
      where: { id: ruleId },
      relations: { clientLinks: true },
    });

    if (!rule) {
      return;
    }

    const scopeIds = new Set(
      rule.isGlobal ? await this.clientsRepository.findAllIds() : (rule.clientLinks ?? []).map((l) => l.clientId),
    );
    const existing = await this.targetsRepo.find({ where: { ruleId } });
    const byClient = new Map(existing.map((t) => [t.clientId, t]));

    for (const cid of scopeIds) {
      const want = rule.enabled;
      const row = byClient.get(cid);

      if (row) {
        const desiredChanged = row.desiredOnManager !== want;

        row.desiredOnManager = want;

        if (bump || desiredChanged) {
          row.syncStatus = 'pending';
        }

        await this.targetsRepo.save(row);
        byClient.delete(cid);
      } else {
        await this.targetsRepo.save(
          this.targetsRepo.create({
            ruleId,
            clientId: cid,
            desiredOnManager: want,
            syncStatus: want ? 'pending' : 'synced',
          }),
        );
      }
    }

    for (const row of byClient.values()) {
      if (!row.desiredOnManager && !row.managerRuleId) {
        row.syncStatus = 'synced';
        await this.targetsRepo.save(row);
      } else {
        row.desiredOnManager = false;
        row.syncStatus = 'pending';
        await this.targetsRepo.save(row);
      }
    }
  }

  private async loadSyncState(ruleId: string): Promise<{
    sync: FilterRuleSyncSummaryDto;
    workspaceSync: FilterRuleWorkspaceSyncDto[];
  }> {
    const targets = await this.targetsRepo.find({
      where: { ruleId },
      order: { clientId: 'ASC' },
    });
    const sync: FilterRuleSyncSummaryDto = { pending: 0, synced: 0, failed: 0 };
    const workspaceSync: FilterRuleWorkspaceSyncDto[] = [];

    for (const t of targets) {
      if (t.syncStatus === 'pending') {
        sync.pending += 1;
      } else if (t.syncStatus === 'synced') {
        sync.synced += 1;
      } else if (t.syncStatus === 'failed') {
        sync.failed += 1;
      }

      workspaceSync.push({
        clientId: t.clientId,
        syncStatus: t.syncStatus,
        lastError: t.lastError ?? undefined,
      });
    }

    return { sync, workspaceSync };
  }

  /** Ensures new clients get sync rows for global rules (no bump). */
  async reconcileAllGlobalRules(): Promise<void> {
    const globals = await this.rulesRepo.find({ where: { isGlobal: true }, select: ['id'] });

    for (const g of globals) {
      await this.reconcileSyncTargets(g.id, false);
    }
  }

  private async toResponse(rule: AgentConsoleRegexFilterRuleEntity): Promise<FilterRuleResponseDto> {
    const workspaceIds = rule.isGlobal ? [] : (rule.clientLinks ?? []).map((l) => l.clientId);
    const { sync, workspaceSync } = await this.loadSyncState(rule.id);

    return {
      id: rule.id,
      pattern: rule.pattern,
      regexFlags: rule.regexFlags,
      direction: rule.direction,
      filterType: rule.filterType,
      replaceContent: rule.replaceContent,
      priority: rule.priority,
      enabled: rule.enabled,
      isGlobal: rule.isGlobal,
      workspaceIds,
      sync,
      workspaceSync,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}
