import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type ObjectLiteral, type SelectQueryBuilder } from 'typeorm';

import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgeNodeType } from '../entities/knowledge-node.enums';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationRunStatus } from '../entities/ticket-automation.enums';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket.enums';

/** Operational figures of one workspace: current state plus runs started in the requested period. */
export interface AdminOverviewWorkspaceCounts {
  openTicketCount: number;
  inProgressTicketCount: number;
  knowledgePageCount: number;
  deploymentRunCount: number;
  failedDeploymentRunCount: number;
  automationRunCount: number;
  failedAutomationRunCount: number;
  activeAutomationRunCount: number;
  taskRunCount: number;
  failedTaskRunCount: number;
}

export const EMPTY_WORKSPACE_COUNTS: AdminOverviewWorkspaceCounts = {
  openTicketCount: 0,
  inProgressTicketCount: 0,
  knowledgePageCount: 0,
  deploymentRunCount: 0,
  failedDeploymentRunCount: 0,
  automationRunCount: 0,
  failedAutomationRunCount: 0,
  activeAutomationRunCount: 0,
  taskRunCount: 0,
  failedTaskRunCount: 0,
};

/** Tickets that still need work (not draft, done or closed). */
const OPEN_TICKET_STATUSES = [TicketStatus.TODO, TicketStatus.IN_PROGRESS, TicketStatus.PROTOTYPE];
const FAILED_DEPLOYMENT_CONCLUSIONS = ['failure', 'timed_out'];
const FAILED_AUTOMATION_STATUSES = [
  TicketAutomationRunStatus.FAILED,
  TicketAutomationRunStatus.TIMED_OUT,
  TicketAutomationRunStatus.ESCALATED,
];
const ACTIVE_AUTOMATION_STATUSES = [TicketAutomationRunStatus.PENDING, TicketAutomationRunStatus.RUNNING];

export interface AdminOverviewPeriod {
  from: string;
  to: string;
}

/**
 * Grouped counts for the admin overview: one query per source, grouped by workspace (`client_id`) and limited to the
 * workspaces in scope. All values are bound parameters.
 */
@Injectable()
export class AdminOverviewRepository {
  constructor(
    @InjectRepository(TicketEntity) private readonly tickets: Repository<TicketEntity>,
    @InjectRepository(KnowledgeNodeEntity) private readonly knowledgeNodes: Repository<KnowledgeNodeEntity>,
    @InjectRepository(DeploymentRunEntity) private readonly deploymentRuns: Repository<DeploymentRunEntity>,
    @InjectRepository(TicketAutomationRunEntity)
    private readonly automationRuns: Repository<TicketAutomationRunEntity>,
    @InjectRepository(AgentTaskRunEntity) private readonly taskRuns: Repository<AgentTaskRunEntity>,
  ) {}

  async countByWorkspace(
    clientIds: string[],
    period: AdminOverviewPeriod,
  ): Promise<Map<string, AdminOverviewWorkspaceCounts>> {
    const result = new Map<string, AdminOverviewWorkspaceCounts>();

    if (clientIds.length === 0) return result;

    const entry = (clientId: string): AdminOverviewWorkspaceCounts => {
      let counts = result.get(clientId);

      if (!counts) {
        counts = { ...EMPTY_WORKSPACE_COUNTS };
        result.set(clientId, counts);
      }

      return counts;
    };
    const [tickets, pages, deployments, automations, tasks] = await Promise.all([
      this.grouped(this.tickets, 't', clientIds, [
        ['open', 't.status IN (:...openStatuses)', { openStatuses: OPEN_TICKET_STATUSES }],
        ['in_progress', 't.status = :inProgress', { inProgress: TicketStatus.IN_PROGRESS }],
      ]),
      this.grouped(this.knowledgeNodes, 'k', clientIds, [
        ['total', 'k.node_type = :page', { page: KnowledgeNodeType.PAGE }],
      ]),
      this.grouped(
        this.deploymentRuns,
        'd',
        clientIds,
        [
          ['total', 'TRUE', {}],
          ['failed', 'd.conclusion IN (:...failedConclusions)', { failedConclusions: FAILED_DEPLOYMENT_CONCLUSIONS }],
        ],
        (qb) => qb.andWhere('d.created_at >= :from AND d.created_at <= :to', period),
      ),
      this.grouped(this.automationRuns, 'a', clientIds, [
        ['total', 'a.started_at >= :from AND a.started_at <= :to', { ...period }],
        [
          'failed',
          'a.started_at >= :from AND a.started_at <= :to AND a.status IN (:...failedStatuses)',
          { ...period, failedStatuses: FAILED_AUTOMATION_STATUSES },
        ],
        ['active', 'a.status IN (:...activeStatuses)', { activeStatuses: ACTIVE_AUTOMATION_STATUSES }],
      ]),
      this.grouped(
        this.taskRuns,
        'r',
        clientIds,
        [
          ['total', 'TRUE', {}],
          ['failed', "r.status = 'failed'", {}],
        ],
        (qb) => qb.andWhere('r.started_at >= :from AND r.started_at <= :to', period),
      ),
    ]);

    for (const [clientId, row] of tickets) {
      entry(clientId).openTicketCount = row['open'] ?? 0;
      entry(clientId).inProgressTicketCount = row['in_progress'] ?? 0;
    }

    for (const [clientId, row] of pages) entry(clientId).knowledgePageCount = row['total'] ?? 0;

    for (const [clientId, row] of deployments) {
      entry(clientId).deploymentRunCount = row['total'] ?? 0;
      entry(clientId).failedDeploymentRunCount = row['failed'] ?? 0;
    }

    for (const [clientId, row] of automations) {
      entry(clientId).automationRunCount = row['total'] ?? 0;
      entry(clientId).failedAutomationRunCount = row['failed'] ?? 0;
      entry(clientId).activeAutomationRunCount = row['active'] ?? 0;
    }

    for (const [clientId, row] of tasks) {
      entry(clientId).taskRunCount = row['total'] ?? 0;
      entry(clientId).failedTaskRunCount = row['failed'] ?? 0;
    }

    return result;
  }

  /**
   * `COUNT(*) FILTER (WHERE …)` per named condition, grouped by `client_id`. Conditions are fixed SQL fragments of this
   * class; every value goes through bound parameters.
   */
  private async grouped<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: string,
    clientIds: string[],
    conditions: [name: string, sql: string, parameters: Record<string, unknown>][],
    scope?: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>,
  ): Promise<Map<string, Record<string, number>>> {
    let qb = repository
      .createQueryBuilder(alias)
      .select(`${alias}.client_id`, 'client_id')
      .where(`${alias}.client_id IN (:...clientIds)`, { clientIds });

    for (const [name, sql, parameters] of conditions) {
      qb = qb.addSelect(`COUNT(*) FILTER (WHERE ${sql})`, name).setParameters(parameters);
    }

    if (scope) qb = scope(qb);

    const rows = await qb.groupBy(`${alias}.client_id`).getRawMany<Record<string, string>>();
    const result = new Map<string, Record<string, number>>();

    for (const row of rows) {
      const counts: Record<string, number> = {};

      for (const [name] of conditions) counts[name] = parseInt(row[name] ?? '0', 10);

      result.set(row['client_id'] as string, counts);
    }

    return result;
  }
}
