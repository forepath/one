import {
  AGENT_CONTENT_FINDING_SEVERITIES,
  AGENT_CONTENT_LIMITS,
  AGENT_CONTENT_TICKET_PRIORITIES,
  AGENT_CONTENT_TICKET_STATUSES,
  TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS,
  isAgentContentWriteOperation,
  normalizeAgentContentWriteOperations,
  type AgentContentChangeResult,
  type AgentContentChangeSource,
  type AgentContentWriteOperation,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgeNodeType } from '../entities/knowledge-node.enums';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketAutomationRunStatus } from '../entities/ticket-automation.enums';
import { TicketEntity } from '../entities/ticket.entity';
import type { TicketPriority, TicketStatus } from '../entities/ticket.enums';
import { createAgentContentWriter, type AgentContentWriter } from '../utils/agent-content-writer.utils';
import { chatPlanContextTitle } from '../utils/chat-plan-mappers';

import { ChatPlanService } from './chat-plan.service';
import { InitiativeContextService, type InitiativeAgentChange } from './initiative-context.service';
import { KnowledgeTreeService } from './knowledge-tree.service';
import { TicketsService } from './tickets.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FULL_SHA = /^[0-9a-f]{40}$/;
/** Ticket trees are shallow; bounded walk to the root. */
const MAX_TICKET_DEPTH = 50;

export type AgentContentChangeHandlerResponse =
  | { ok: true; changed: AgentContentChangeResult }
  | { ok: false; error: string; status: number };

/** Validated change: field types and bounds checked, SHAs full and lower case. */
interface ValidatedChange {
  operation: AgentContentWriteOperation;
  sha?: string;
  parentSha?: string;
  revision?: string;
  title?: string;
  content?: string;
  body?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  nodeType?: KnowledgeNodeType;
  /** Initiative proposals / findings (structured parts are validated by the initiative services). */
  rationale?: string;
  artifacts?: unknown[];
  workItems?: unknown[];
  decisions?: unknown[];
  severity?: string;
  itemKey?: string;
  evidence?: string[];
}

function optionalObjectList(input: Record<string, unknown>, field: string): unknown[] | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    value.length > AGENT_CONTENT_LIMITS.initiativeProposalItemsMax ||
    value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))
  ) {
    throw new BadRequestException(`${field} must be a list of objects`);
  }

  return value;
}

function optionalString(input: Record<string, unknown>, field: string, maxLength: number): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.length > maxLength) {
    throw new BadRequestException(`${field} must be a string of at most ${maxLength} characters`);
  }

  return value;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly string[]): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new BadRequestException(`${field} must be one of ${allowed.join(', ')}`);
  }

  return value as T;
}

function shaField(input: Record<string, unknown>, field: 'sha' | 'parentSha'): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  const sha = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (!FULL_SHA.test(sha)) {
    throw new BadRequestException(`${field} must be a full SHA`);
  }

  return sha;
}

/**
 * Applies content changes of agents (worker `agenstra` MCP server → manager → controller) to the workspace bound to
 * the manager connection. The manager already checked that the agent may read the element and decided the change
 * (user approval in chats); this service is the authority for unattended runs: a task run only makes the operations a
 * user approved for that task, ticket automation only the operations allowed for its ticket, within its ticket tree.
 */
@Injectable()
export class AgentContentChangesService {
  private readonly logger = new Logger(AgentContentChangesService.name);

  constructor(
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeNodeRepo: Repository<KnowledgeNodeEntity>,
    @InjectRepository(AgentTaskEntity)
    private readonly taskRepo: Repository<AgentTaskEntity>,
    @InjectRepository(AgentTaskRunEntity)
    private readonly taskRunRepo: Repository<AgentTaskRunEntity>,
    @InjectRepository(TicketAutomationEntity)
    private readonly automationRepo: Repository<TicketAutomationEntity>,
    @InjectRepository(TicketAutomationRunEntity)
    private readonly automationRunRepo: Repository<TicketAutomationRunEntity>,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
    @Inject(forwardRef(() => KnowledgeTreeService))
    private readonly knowledgeTreeService: KnowledgeTreeService,
    private readonly chatPlanService: ChatPlanService,
    @Optional() private readonly initiativeContext?: InitiativeContextService,
  ) {}

  async handle(
    clientId: string,
    agentId: unknown,
    rawChange: unknown,
    rawSource: unknown,
  ): Promise<AgentContentChangeHandlerResponse> {
    try {
      const id = typeof agentId === 'string' ? agentId.trim().toLowerCase() : '';

      if (!UUID_V4.test(id) || !(await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, id))) {
        throw new NotFoundException('Agent not found in this workspace');
      }

      const change = this.validate(rawChange);
      const source = this.parseSource(rawSource);

      await this.assertSourceAllows(clientId, id, source, change);

      return { ok: true, changed: await this.apply(createAgentContentWriter(clientId, id, source.kind), change) };
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse();
        const message =
          typeof response === 'object' && response && 'message' in response
            ? (response as { message: unknown }).message
            : error.message;

        return {
          ok: false,
          error: Array.isArray(message) ? message.join('; ') : String(message),
          status: error.getStatus(),
        };
      }

      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Content change failed for client ${clientId}: ${message}`);

      return { ok: false, error: 'Content change failed', status: 500 };
    }
  }

  /** Authoritative validation (the manager validated too; nothing of the socket payload is trusted blindly). */
  private validate(raw: unknown): ValidatedChange {
    const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const operation = input['operation'];

    if (!isAgentContentWriteOperation(operation)) {
      throw new BadRequestException('Unknown content change operation');
    }

    const change: ValidatedChange = {
      operation,
      sha: shaField(input, 'sha'),
      parentSha: shaField(input, 'parentSha'),
      revision: optionalString(input, 'revision', 64),
      title: optionalString(input, 'title', AGENT_CONTENT_LIMITS.titleMaxLength)?.trim(),
      content: optionalString(input, 'content', AGENT_CONTENT_LIMITS.contentMaxLength),
      body: optionalString(input, 'body', AGENT_CONTENT_LIMITS.commentMaxLength)?.trim(),
      priority: oneOf<TicketPriority>(input['priority'], 'priority', AGENT_CONTENT_TICKET_PRIORITIES),
      status: oneOf<TicketStatus>(input['status'], 'status', AGENT_CONTENT_TICKET_STATUSES),
      nodeType: oneOf<KnowledgeNodeType>(input['nodeType'], 'nodeType', [
        KnowledgeNodeType.PAGE,
        KnowledgeNodeType.FOLDER,
      ]),
    };
    if (operation.startsWith('initiative.')) {
      const evidence = input['evidence'];

      if (
        evidence !== undefined &&
        (!Array.isArray(evidence) ||
          evidence.length > 20 ||
          evidence.some((e) => typeof e !== 'string' || e.length > 500))
      ) {
        throw new BadRequestException('evidence must be a list of at most 20 short strings');
      }

      Object.assign(change, {
        rationale: optionalString(input, 'rationale', AGENT_CONTENT_LIMITS.commentMaxLength),
        artifacts: optionalObjectList(input, 'artifacts'),
        workItems: optionalObjectList(input, 'workItems'),
        decisions: optionalObjectList(input, 'decisions'),
        severity: oneOf<string>(input['severity'], 'severity', AGENT_CONTENT_FINDING_SEVERITIES),
        itemKey: optionalString(input, 'itemKey', 16)?.trim(),
        evidence: evidence as string[] | undefined,
      });

      if (
        JSON.stringify([change.artifacts, change.workItems, change.decisions]).length >
        AGENT_CONTENT_LIMITS.initiativeProposalMaxLength
      ) {
        throw new BadRequestException('The proposal is too large');
      }

      if (operation === 'initiative.propose' && !change.title) {
        throw new BadRequestException('title is required');
      }

      if (operation === 'initiative.finding' && !change.body) {
        throw new BadRequestException('body is required');
      }
    }

    const creates = operation === 'ticket.create' || operation === 'page.create';

    if (creates ? change.sha !== undefined : change.sha === undefined) {
      throw new BadRequestException(creates ? 'Creates take a parent, not a target' : 'sha is required');
    }

    if (creates && !change.title) {
      throw new BadRequestException('title is required');
    }

    if (change.title !== undefined && !change.title) {
      throw new BadRequestException('title must not be empty');
    }

    if ((operation.endsWith('.update') || operation.endsWith('.delete')) && !change.revision) {
      throw new BadRequestException('revision is required');
    }

    if (operation === 'ticket.comment' && !change.body) {
      throw new BadRequestException('body is required');
    }

    return change;
  }

  private parseSource(raw: unknown): AgentContentChangeSource {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

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

    throw new ForbiddenException('Unknown change source');
  }

  /**
   * Chats were decided by the user. Unattended runs need the explicit opt-in of a user, checked here against the
   * current records (the run must still be working; content changed since the approval does not count).
   */
  private async assertSourceAllows(
    clientId: string,
    agentId: string,
    source: AgentContentChangeSource,
    change: ValidatedChange,
  ): Promise<void> {
    if (source.kind === 'chat') {
      return;
    }

    if (source.kind === 'task') {
      const task = await this.taskRepo.findOne({ where: { id: source.taskId, clientId, agentId } });

      if (!task?.approvedAt) {
        throw new ForbiddenException('This task is not approved; its runs cannot change tickets or knowledge pages.');
      }

      const allowed = normalizeAgentContentWriteOperations(task.allowedContentWrites);

      if (!allowed.includes(change.operation)) {
        throw new ForbiddenException(
          allowed.length
            ? `A user approved this task to make only these content changes: ${allowed.join(', ')}.`
            : 'No content changes were approved for this task. Describe the change in your summary, or propose ' +
              'allowedContentWrites with agenstra_tasks_update (a user has to approve the task again).',
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
          ? 'Several automation runs of this agent are working; no change is made.'
          : 'No automation run is working.',
      );
    }

    const automation = await this.automationRepo.findOne({ where: { ticketId: runs[0].ticketId } });
    const allowed = normalizeAgentContentWriteOperations(automation?.allowedContentWrites).filter((operation) =>
      (TICKET_AUTOMATION_CONTENT_WRITE_OPERATIONS as readonly string[]).includes(operation),
    );

    if (!allowed.includes(change.operation)) {
      throw new ForbiddenException(
        allowed.length
          ? `This ticket's automation may only make these content changes: ${allowed.join(', ')}.`
          : "This ticket's automation may not change tickets. Describe the change in your summary instead.",
      );
    }

    // Initiative findings: only on the story the automated ticket is linked to (never proposals).
    if (change.operation.startsWith('initiative.')) {
      if (!this.initiativeContext) {
        throw new ForbiddenException('Initiatives are not available');
      }

      await this.initiativeContext.assertAutomationFinding(clientId, runs[0].ticketId, change as InitiativeAgentChange);

      return;
    }

    const anchor = await this.ticketRepo.findOne({ where: { clientId, id: runs[0].ticketId } });
    const scopeSha = change.operation === 'ticket.create' ? change.parentSha : change.sha;
    const scoped = scopeSha ? await this.ticketRepo.findOne({ where: { clientId, longSha: scopeSha } }) : null;

    if (
      !anchor ||
      !scoped ||
      (await this.rootTicketId(clientId, scoped)) !== (await this.rootTicketId(clientId, anchor))
    ) {
      throw new ForbiddenException(
        change.operation === 'ticket.create'
          ? "Automation runs only create subtasks within the automated ticket's tree (pass parentRef)."
          : "Automation runs only change tickets within the automated ticket's tree.",
      );
    }

    // The automated ticket is the run's approved content (and its status is managed by the run): changing it would
    // void the approval and cancel the very run.
    if (change.operation === 'ticket.update' && scoped.id === anchor.id) {
      throw new ForbiddenException(
        'The automated ticket itself is managed by this run; update its subtasks or comment on it instead.',
      );
    }
  }

  private async apply(writer: AgentContentWriter, change: ValidatedChange): Promise<AgentContentChangeResult> {
    switch (change.operation) {
      case 'initiative.propose':
      case 'initiative.finding': {
        if (!this.initiativeContext) {
          throw new ForbiddenException('Initiatives are not available');
        }

        return await this.initiativeContext.applyAgentChange(writer, change as InitiativeAgentChange);
      }
      case 'ticket.create': {
        const parent = change.parentSha ? await this.findTicket(writer.clientId, change.parentSha) : undefined;
        const created = await this.ticketsService.create(
          {
            clientId: writer.clientId,
            parentId: parent?.id ?? null,
            title: change.title as string,
            ...(change.content !== undefined ? { content: change.content } : {}),
            ...(change.priority ? { priority: change.priority } : {}),
            ...(change.status ? { status: change.status } : {}),
          },
          writer,
        );

        return this.ticketResult(await this.findTicketById(writer.clientId, created.id));
      }
      case 'ticket.update': {
        const ticket = await this.findTicket(writer.clientId, change.sha as string, change.revision);

        await this.ticketsService.update(
          ticket.id,
          {
            ...(change.title !== undefined ? { title: change.title } : {}),
            ...(change.content !== undefined ? { content: change.content } : {}),
            ...(change.priority ? { priority: change.priority } : {}),
            ...(change.status ? { status: change.status } : {}),
          },
          writer,
        );

        return this.ticketResult(await this.findTicketById(writer.clientId, ticket.id));
      }
      case 'ticket.comment': {
        const ticket = await this.findTicket(writer.clientId, change.sha as string);

        await this.ticketsService.addComment(ticket.id, { body: change.body as string }, writer);

        return this.ticketResult(await this.findTicketById(writer.clientId, ticket.id));
      }
      case 'ticket.delete': {
        const ticket = await this.findTicket(writer.clientId, change.sha as string, change.revision);

        await this.ticketsService.remove(ticket.id, writer);

        return { kind: 'ticket', sha: ticket.longSha as string, title: ticket.title, deleted: true };
      }
      case 'page.create': {
        const parent = change.parentSha ? await this.findNode(writer.clientId, change.parentSha) : undefined;
        const nodeType = change.nodeType ?? KnowledgeNodeType.PAGE;

        if (nodeType === KnowledgeNodeType.FOLDER && change.content !== undefined) {
          throw new BadRequestException('Folders have no content');
        }

        const created = await this.knowledgeTreeService.createNode(
          {
            clientId: writer.clientId,
            ...(parent ? { parentId: parent.id } : {}),
            nodeType,
            title: change.title as string,
            ...(change.content !== undefined ? { content: change.content } : {}),
          },
          writer,
        );

        return this.nodeResult(await this.findNodeById(writer.clientId, created.id));
      }
      case 'page.update': {
        const node = await this.findNode(writer.clientId, change.sha as string, change.revision);

        await this.knowledgeTreeService.updateNode(
          node.id,
          {
            ...(change.title !== undefined ? { title: change.title } : {}),
            ...(change.content !== undefined ? { content: change.content } : {}),
          },
          writer,
        );

        return this.nodeResult(await this.findNodeById(writer.clientId, node.id));
      }
      case 'page.delete': {
        const node = await this.findNode(writer.clientId, change.sha as string, change.revision);

        await this.knowledgeTreeService.deleteNode(node.id, writer);

        return { kind: 'knowledge', sha: node.longSha as string, title: node.title, deleted: true };
      }
      case 'plan.update': {
        // Plans of the agent's own environment only; executed / drafting plans are refused by the plan service.
        const plan = await this.chatPlanService.findForAgentBySha(
          writer.clientId,
          writer.agentId,
          change.sha as string,
        );

        if (!plan?.longSha) {
          throw new NotFoundException(`plan:${change.sha} was not found in this environment`);
        }

        this.assertRevision(`plan:${plan.longSha}`, plan.updatedAt, change.revision);

        const saved = await this.chatPlanService.updateForAgent(writer, plan.longSha, {
          revision: change.revision as string,
          ...(change.title !== undefined ? { title: change.title } : {}),
          ...(change.content !== undefined ? { content: change.content } : {}),
        });

        return {
          kind: 'plan',
          sha: saved.longSha as string,
          title: chatPlanContextTitle(saved),
          revision: saved.updatedAt.toISOString(),
        };
      }
    }
  }

  /** Element by full SHA in the workspace; with `revision`, only the version the agent read. */
  private async findTicket(clientId: string, sha: string, revision?: string): Promise<TicketEntity> {
    const ticket = await this.ticketRepo.findOne({ where: { clientId, longSha: sha } });

    if (!ticket) {
      throw new NotFoundException(`ticket:${sha} was not found in this workspace`);
    }

    this.assertRevision(`ticket:${sha}`, ticket.updatedAt, revision);

    return ticket;
  }

  private async findNode(clientId: string, sha: string, revision?: string): Promise<KnowledgeNodeEntity> {
    const node = await this.knowledgeNodeRepo.findOne({ where: { clientId, longSha: sha } });

    if (!node) {
      throw new NotFoundException(`knowledge:${sha} was not found in this workspace`);
    }

    this.assertRevision(`knowledge:${sha}`, node.updatedAt, revision);

    return node;
  }

  private assertRevision(ref: string, updatedAt: Date, revision: string | undefined): void {
    if (revision !== undefined && updatedAt.toISOString() !== revision) {
      throw new ConflictException(
        `${ref} was changed since you read it (revision ${updatedAt.toISOString()}). Read it again with context_get ` +
          'and base your change on the current content.',
      );
    }
  }

  private async findTicketById(clientId: string, id: string): Promise<TicketEntity> {
    const ticket = await this.ticketRepo.findOne({ where: { clientId, id } });

    if (!ticket?.longSha) {
      throw new NotFoundException('Ticket not found after the change');
    }

    return ticket;
  }

  private async findNodeById(clientId: string, id: string): Promise<KnowledgeNodeEntity> {
    const node = await this.knowledgeNodeRepo.findOne({ where: { clientId, id } });

    if (!node?.longSha) {
      throw new NotFoundException('Knowledge node not found after the change');
    }

    return node;
  }

  private ticketResult(ticket: TicketEntity): AgentContentChangeResult {
    return {
      kind: 'ticket',
      sha: ticket.longSha as string,
      title: ticket.title,
      revision: ticket.updatedAt.toISOString(),
    };
  }

  private nodeResult(node: KnowledgeNodeEntity): AgentContentChangeResult {
    return {
      kind: 'knowledge',
      sha: node.longSha as string,
      title: node.title,
      revision: node.updatedAt.toISOString(),
    };
  }

  private async rootTicketId(clientId: string, ticket: TicketEntity): Promise<string> {
    let current = ticket;

    for (let depth = 0; current.parentId && depth < MAX_TICKET_DEPTH; depth++) {
      const parent = await this.ticketRepo.findOne({ where: { clientId, id: current.parentId } });

      if (!parent) {
        break;
      }

      current = parent;
    }

    return current.id;
  }
}
