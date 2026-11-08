import {
  normalizeAgentDeploymentOperations,
  type AgentDeploymentActionSource,
  type AgentDeploymentOperation,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketAutomationRunStatus } from '../entities/ticket-automation.enums';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Source of a deployment run action as sent by the manager (determined from the context ticket of the prompt, never
 * agent input). Missing → 400; unknown kinds or malformed task ids → 403 (nothing is carried out).
 */
export function parseAgentDeploymentActionSource(raw: unknown): AgentDeploymentActionSource {
  if (raw === undefined || raw === null) {
    throw new BadRequestException('source is required');
  }

  const source = (typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  switch (source['kind']) {
    case 'chat':
      return { kind: 'chat' };
    case 'automation':
      return { kind: 'automation' };
    case 'task': {
      const taskId = typeof source['taskId'] === 'string' ? source['taskId'].trim().toLowerCase() : '';

      if (UUID_V4.test(taskId)) {
        return { kind: 'task', taskId };
      }

      break;
    }
  }

  throw new ForbiddenException('Unknown deployment action source');
}

/**
 * Authority for deployment run actions (`deployment.trigger`, `deployment.cancel`) of unattended runs, mirroring
 * {@link AgentContentChangesService}: chats were decided by the user in the visible chat; a task run only requests the
 * operations a user approved for that task (approved content, the run must still be working); ticket automation only
 * the operations allowed in the automation settings of the ticket its single working run belongs to. The workflow
 * rules (enabled + approved, available, `agentTriggerEnabled`, default ref, defined inputs) apply on top.
 */
@Injectable()
export class AgentDeploymentSourcesService {
  constructor(
    @InjectRepository(AgentTaskEntity)
    private readonly taskRepo: Repository<AgentTaskEntity>,
    @InjectRepository(AgentTaskRunEntity)
    private readonly taskRunRepo: Repository<AgentTaskRunEntity>,
    @InjectRepository(TicketAutomationEntity)
    private readonly automationRepo: Repository<TicketAutomationEntity>,
    @InjectRepository(TicketAutomationRunEntity)
    private readonly automationRunRepo: Repository<TicketAutomationRunEntity>,
  ) {}

  async assertSourceAllows(
    clientId: string,
    agentId: string,
    source: AgentDeploymentActionSource,
    operation: AgentDeploymentOperation,
  ): Promise<void> {
    if (source.kind === 'chat') {
      return;
    }

    if (source.kind === 'task') {
      const task = await this.taskRepo.findOne({ where: { id: source.taskId, clientId, agentId } });

      if (!task?.approvedAt) {
        throw new ForbiddenException('This task is not approved; its runs cannot start or cancel deployments.');
      }

      const allowed = normalizeAgentDeploymentOperations(task.allowedDeploymentOperations);

      if (!allowed.includes(operation)) {
        throw new ForbiddenException(
          allowed.length
            ? `A user approved this task to request only these deployment actions: ${allowed.join(', ')}.`
            : 'No deployment actions were approved for this task. Describe what should be deployed in your summary, ' +
              `or propose allowedDeploymentOperations (e.g. ["${operation}"]) with agenstra_tasks_update ` +
              '(a user has to approve the task again).',
        );
      }

      if (!(await this.taskRunRepo.findOne({ where: { taskId: task.id, status: 'running' } }))) {
        throw new ForbiddenException('This task run is not working anymore.');
      }

      return;
    }

    const runs = await this.automationRunRepo.find({
      where: { clientId, agentId, status: TicketAutomationRunStatus.RUNNING },
      take: 2,
    });

    if (runs.length !== 1) {
      throw new ForbiddenException(
        runs.length
          ? 'Several automation runs of this agent are working; no deployment action is carried out.'
          : 'No automation run is working.',
      );
    }

    const automation = await this.automationRepo.findOne({ where: { ticketId: runs[0].ticketId } });
    const allowed = normalizeAgentDeploymentOperations(automation?.allowedDeploymentOperations);

    if (!allowed.includes(operation)) {
      throw new ForbiddenException(
        allowed.length
          ? `This ticket's automation may only request these deployment actions: ${allowed.join(', ')}.`
          : "This ticket's automation may not start or cancel deployments. Describe what should be deployed in your " +
            "summary instead (a workspace user can allow deployment actions in the ticket's automation settings).",
      );
    }
  }
}
