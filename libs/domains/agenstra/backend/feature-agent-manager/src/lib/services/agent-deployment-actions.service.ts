import {
  parseAgentTaskIdFromResumeSessionSuffix,
  type AgentDeploymentActionResponse,
  type AgentDeploymentActionSource,
  type AgentDeploymentControllerRequest,
  type AgentDeploymentOperation,
  type DeploymentRunSummary,
  type DeploymentTriggerInput,
  type DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import {
  AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS,
  AGENT_CONTEXT_ACCESS_WAIT_MS,
  AGENT_CONTEXT_DEPLOYMENT_REQUEST_ID_PREFIX,
  AGENT_CONTEXT_MAX_DEPLOYMENT_ACTIONS_PER_TICKET,
} from '../constants/agent-context.constants';
import { isTicketAutomationResumeSessionSuffix } from '../constants/chat-session.constants';
import type { AgentContextTicketRecord } from '../types/agent-context.types';

import type { AgentContextAccessReply } from './agent-context-access.service';
import { AgentContextApiService } from './agent-context-api.service';
import { AgentContextTicketsService } from './agent-context-tickets.service';
import { AgentDeploymentsApiService } from './agent-deployments-api.service';

/** Session key of tickets minted for hidden sessions (see the agents gateway). */
const AUTO_SESSION_KEY_PREFIX = 'suffix:';

/** Characters of one input value shown in an approval prompt. */
const INPUT_PREVIEW_LENGTH = 200;

/** A run action of the agent (validated by the deployments controller DTOs). */
export type AgentDeploymentAction =
  | { operation: 'deployment.trigger'; workflowId: string; input: DeploymentTriggerInput }
  | { operation: 'deployment.cancel'; runId: string };

/** An action waiting for the user (interactive chats). */
interface PendingAction {
  id: string;
  agentId: string;
  ticket: string;
  action: AgentDeploymentAction;
  grantKey: string;
  result?: AgentDeploymentActionResponse;
  createdAt: number;
}

function quote(value: string, maxLength = 120): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();

  return JSON.stringify(collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}…`);
}

/**
 * Deployment run actions (`deployments_trigger` / `deployments_cancel_run`) requested by the worker `agenstra` MCP
 * server, decided per session like content changes:
 * - `ask` (visible chats): the user approves each action (permission-style prompt; "allow for this chat" covers the
 *   same operation on the same workflow for the rest of the chat);
 * - `auto` (scheduled task runs / ticket automation, only while that session is all the agent runs): forwarded with
 *   the task / automation as source; the controller only allows the operations a workspace user allowed for it;
 * - `deny` and every other hidden session (plans, helpers): never.
 * The controller stays authoritative: workflow rules (enabled, approved, available to the environment,
 * `agentTriggerEnabled`, default ref, defined inputs) and the source opt-ins are checked there again.
 */
@Injectable()
export class AgentDeploymentActionsService {
  private readonly logger = new Logger(AgentDeploymentActionsService.name);
  private readonly pending = new Map<string, PendingAction>();
  private readonly waiters = new Map<string, Array<(action: PendingAction) => void>>();

  constructor(
    private readonly tickets: AgentContextTicketsService,
    private readonly contextApi: AgentContextApiService,
    private readonly deployments: AgentDeploymentsApiService,
  ) {}

  static isDeploymentRequestId(id: string): boolean {
    return id.startsWith(AGENT_CONTEXT_DEPLOYMENT_REQUEST_ID_PREFIX);
  }

  async requestAction(
    record: AgentContextTicketRecord,
    action: AgentDeploymentAction,
  ): Promise<AgentDeploymentActionResponse> {
    const { operation } = action;
    const denied = (message: string): AgentDeploymentActionResponse => ({
      requestId: '',
      decision: 'denied',
      operation,
      message,
    });

    if (record.accessMode === 'deny') {
      return denied('Deployments cannot be started or cancelled in this session.');
    }

    const source = this.resolveSource(record);

    if (!source) {
      return denied(
        'Plans and background sessions cannot start or cancel deployments: describe the deployment instead.',
      );
    }

    if (record.accessMode === 'auto' && !this.contextApi.isExclusiveAutoSession(record)) {
      return denied(
        'Deployments cannot be started or cancelled automatically while other sessions of this agent are working. ' +
          'Try again later.',
      );
    }

    if ((record.deploymentActionCount ?? 0) >= AGENT_CONTEXT_MAX_DEPLOYMENT_ACTIONS_PER_TICKET) {
      return denied(`At most ${AGENT_CONTEXT_MAX_DEPLOYMENT_ACTIONS_PER_TICKET} deployment actions per turn.`);
    }

    // Unattended runs: the controller decides on the task / automation opt-ins (nobody to ask).
    if (record.accessMode === 'auto') {
      record.deploymentActionCount = (record.deploymentActionCount ?? 0) + 1;

      return this.apply(record, '', action, source);
    }

    // Visible chats: describe what the user is asked about (and refuse early what the controller would refuse).
    const described = await this.describe(record.agentId, action);

    if ('response' in described) {
      return described.response;
    }

    record.deploymentActionCount = (record.deploymentActionCount ?? 0) + 1;

    const grantKey = this.grantKey(operation, described.workflow.id);

    if (this.tickets.hasWriteGrant(record, grantKey)) {
      return this.apply(record, '', action, { kind: 'chat' });
    }

    const pending: PendingAction = {
      id: `${AGENT_CONTEXT_DEPLOYMENT_REQUEST_ID_PREFIX}${randomBytes(12).toString('hex')}`,
      agentId: record.agentId,
      ticket: record.ticket,
      action,
      grantKey,
      createdAt: Date.now(),
    };

    this.purgeExpired();
    this.pending.set(pending.id, pending);
    this.contextApi.publishDeploymentQuestion(record, pending.id, this.buildPrompt(action, described));

    return this.awaitDecision(pending);
  }

  /** Re-wait on a pending action (agent polls after a `pending` response). */
  async actionStatus(record: AgentContextTicketRecord, requestId: string): Promise<AgentDeploymentActionResponse> {
    const pending = this.get(record.agentId, requestId);

    if (pending.ticket !== record.ticket) {
      throw new NotFoundException('Unknown or expired deployment action request');
    }

    return this.awaitDecision(pending);
  }

  /**
   * Apply a user's decision (permission reply endpoint). The action is carried out here, so a decision made after the
   * MCP call stopped waiting still takes effect; later replies (e.g. a second console tab) are ignored.
   */
  async decide(agentId: string, requestId: string, reply: AgentContextAccessReply): Promise<string[]> {
    const pending = this.get(agentId, requestId);
    const operation = pending.action.operation;

    if (pending.result) {
      return [requestId];
    }

    if (reply === 'reject') {
      this.settle(pending, { requestId, decision: 'denied', operation, message: 'The user rejected the action.' });

      return [requestId];
    }

    // Claimed before the (asynchronous) apply: concurrent replies must not start / cancel the run twice.
    pending.result = { requestId, decision: 'pending', operation };

    let record: AgentContextTicketRecord;

    try {
      record = this.tickets.resolve(agentId, pending.ticket);
    } catch {
      this.settle(pending, {
        requestId,
        decision: 'failed',
        operation,
        message: 'The turn that requested this action has ended.',
      });

      return [requestId];
    }

    if (reply === 'always') {
      this.tickets.grantWrite(record, pending.grantKey, 'session');
    }

    this.settle(pending, await this.apply(record, requestId, pending.action, { kind: 'chat' }));

    return [requestId];
  }

  /**
   * Visible chats ask; unattended runs name their task (the controller checks its approved deployment operations) or
   * the ticket automation; plans and every other hidden session cannot start or cancel anything.
   */
  private resolveSource(record: AgentContextTicketRecord): AgentDeploymentActionSource | undefined {
    if (record.accessMode === 'ask') {
      return { kind: 'chat' };
    }

    const suffix = record.sessionKey.startsWith(AUTO_SESSION_KEY_PREFIX)
      ? record.sessionKey.slice(AUTO_SESSION_KEY_PREFIX.length)
      : undefined;
    const taskId = parseAgentTaskIdFromResumeSessionSuffix(suffix);

    if (taskId) {
      return { kind: 'task', taskId };
    }

    if (isTicketAutomationResumeSessionSuffix(suffix)) {
      return { kind: 'automation' };
    }

    return undefined;
  }

  /**
   * Workflow (and run, for cancel) the user is asked about, read through the controller as the agent sees it. Actions
   * the controller would refuse anyway are answered right away instead of bothering the user.
   */
  private async describe(
    agentId: string,
    action: AgentDeploymentAction,
  ): Promise<
    { workflow: DeploymentWorkflowSummary; run?: DeploymentRunSummary } | { response: AgentDeploymentActionResponse }
  > {
    const { operation } = action;
    const refuse = (decision: 'denied' | 'failed', message: string) => ({
      response: { requestId: '', decision, operation, message } satisfies AgentDeploymentActionResponse,
    });
    let run: DeploymentRunSummary | undefined;
    let workflowId: string;

    if (action.operation === 'deployment.cancel') {
      const response = await this.deployments.requestController({ op: 'getRun', agentId, runId: action.runId });

      if (response.ok === false || !response.run) {
        return refuse('failed', (response.ok === false && response.error) || 'Deployment run not found');
      }

      run = response.run;

      if (run.status === 'completed') {
        return refuse('failed', 'The run has already completed and cannot be cancelled.');
      }

      workflowId = run.workflowId;
    } else {
      workflowId = action.workflowId;
    }

    const response = await this.deployments.requestController({ op: 'describeWorkflow', agentId, workflowId });

    if (response.ok === false || !response.workflow) {
      return refuse('failed', (response.ok === false && response.error) || 'Deployment workflow not found');
    }

    const workflow = response.workflow;

    if (workflow.approvalStatus === 'pending') {
      return refuse('failed', 'The workflow waits for approval by a workspace admin; no runs can be started yet.');
    }

    if (!workflow.enabled) {
      return refuse('failed', 'The workflow is disabled.');
    }

    if (!workflow.agentTriggerEnabled) {
      return refuse(
        'denied',
        'This workflow does not allow environments to trigger or cancel runs (agentTriggerEnabled is off).',
      );
    }

    if (action.operation === 'deployment.trigger') {
      const ref = action.input.ref?.trim();

      if (ref && ref !== (workflow.defaultRef ?? '').trim()) {
        return refuse('denied', 'Environments can only deploy the default ref of the workflow: omit "ref".');
      }

      const allowed = new Set(Object.keys(workflow.defaultInputs ?? {}));
      const unknown = Object.keys(action.input.inputs ?? {}).filter((key) => !allowed.has(key));

      if (unknown.length) {
        return refuse(
          'denied',
          `Environments can only set the inputs the workflow defines (not allowed: ${unknown.slice(0, 5).join(', ')}).`,
        );
      }
    }

    return { workflow, ...(run ? { run } : {}) };
  }

  /** "Allow for this chat" covers the same operation on the same workflow (distinct from content change keys). */
  private grantKey(operation: AgentDeploymentOperation, workflowId: string): string {
    return `${operation}:${workflowId}`;
  }

  private async apply(
    record: AgentContextTicketRecord,
    requestId: string,
    action: AgentDeploymentAction,
    source: AgentDeploymentActionSource,
  ): Promise<AgentDeploymentActionResponse> {
    const { operation } = action;
    const request: AgentDeploymentControllerRequest =
      action.operation === 'deployment.trigger'
        ? { op: 'trigger', agentId: record.agentId, workflowId: action.workflowId, input: action.input, source }
        : { op: 'cancelRun', agentId: record.agentId, runId: action.runId, source };
    const response = await this.deployments.requestController(request);

    if (response.ok === false || !response.run) {
      const status = response.ok === false ? response.status : undefined;
      const message = (response.ok === false && response.error) || 'The deployment action could not be carried out.';

      if (status === undefined || status >= 500) {
        this.logger.warn(`Deployment action ${operation} for agent ${record.agentId} failed: ${message}`);
      }

      return {
        requestId,
        decision: status === 403 ? 'denied' : 'failed',
        operation,
        message: status !== undefined && status >= 500 ? 'Deployments are unavailable right now.' : message,
      };
    }

    return {
      requestId,
      decision: 'applied',
      operation,
      run: response.run,
      ...(operation === 'deployment.cancel' && response.cancelled === false
        ? { message: 'The provider did not confirm the cancellation; check the run status.' }
        : {}),
    };
  }

  private buildPrompt(
    action: AgentDeploymentAction,
    described: { workflow: DeploymentWorkflowSummary; run?: DeploymentRunSummary },
  ): string {
    const { workflow, run } = described;
    const lines: string[] = [];
    const ref = workflow.defaultRef?.trim() || 'default branch of the repository';

    if (action.operation === 'deployment.cancel' && run) {
      lines.push(
        `The agent wants to cancel the deployment run ${run.name ? `${quote(run.name)} ` : ''}` +
          `(${run.id.slice(0, 8)}) of the workflow ${quote(workflow.name)}.`,
        `Status: ${run.status}`,
        `Ref: ${run.ref ?? ref}`,
      );
    } else {
      lines.push(`The agent wants to start the deployment workflow ${quote(workflow.name)}.`, `Ref: ${ref}`);
    }

    lines.push(
      `Repository: ${workflow.repository}${workflow.workflow ? ` (${workflow.workflow})` : ''}`,
      `Connection: ${workflow.connectionLabel} (${workflow.provider})`,
    );

    if (action.operation === 'deployment.trigger') {
      const overrides = Object.entries(action.input.inputs ?? {});

      if (overrides.length) {
        lines.push(
          'Inputs (overriding the workflow defaults):',
          ...overrides.map(([key, value]) => `- ${key} = ${quote(value, INPUT_PREVIEW_LENGTH)}`),
        );
      } else {
        lines.push('Inputs: workflow defaults');
      }
    }

    return lines.join('\n');
  }

  private async awaitDecision(pending: PendingAction): Promise<AgentDeploymentActionResponse> {
    const decided = await this.waitForDecision(pending, AGENT_CONTEXT_ACCESS_WAIT_MS);

    if (decided.result && decided.result.decision !== 'pending') {
      return decided.result;
    }

    return {
      requestId: pending.id,
      decision: 'pending',
      operation: pending.action.operation,
      message: 'Waiting for the user. Call deployments_action_status with this requestId to keep waiting.',
    };
  }

  private waitForDecision(pending: PendingAction, timeoutMs: number): Promise<PendingAction> {
    if (pending.result && pending.result.decision !== 'pending') {
      return Promise.resolve(pending);
    }

    return new Promise((resolve) => {
      const waiter = (decided: PendingAction) => {
        clearTimeout(timer);
        resolve(decided);
      };
      const timer = setTimeout(() => {
        this.waiters.set(
          pending.id,
          (this.waiters.get(pending.id) ?? []).filter((entry) => entry !== waiter),
        );
        resolve(pending);
      }, timeoutMs);

      timer.unref?.();
      this.waiters.set(pending.id, [...(this.waiters.get(pending.id) ?? []), waiter]);
    });
  }

  private settle(pending: PendingAction, result: AgentDeploymentActionResponse): void {
    pending.result = result;

    const waiters = this.waiters.get(pending.id) ?? [];

    this.waiters.delete(pending.id);

    for (const waiter of waiters) {
      waiter(pending);
    }

    if (result.decision !== 'pending') {
      this.contextApi.publishInteractionAnswered(
        pending.agentId,
        [pending.id],
        `Deployment action ${pending.id}: ${result.decision}`,
      );
    }
  }

  private get(agentId: string, id: string): PendingAction {
    this.purgeExpired();

    const pending = this.pending.get(id);

    if (!pending || pending.agentId !== agentId) {
      throw new NotFoundException('Unknown or expired deployment action request');
    }

    return pending;
  }

  private purgeExpired(): void {
    const cutoff = Date.now() - AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS;

    for (const [id, pending] of this.pending.entries()) {
      if (pending.createdAt >= cutoff) {
        continue;
      }

      this.pending.delete(id);

      if (!pending.result || pending.result.decision === 'pending') {
        this.settle(pending, {
          requestId: id,
          decision: 'denied',
          operation: pending.action.operation,
          message: 'Nobody decided on the action in time.',
        });
      }
    }
  }
}
