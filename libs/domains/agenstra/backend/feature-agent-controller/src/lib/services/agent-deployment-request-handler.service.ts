import {
  AGENT_DEPLOYMENT_CONTROLLER_OPS,
  AGENT_DEPLOYMENT_REQUEST_EVENT,
  DEPLOYMENT_LIMITS,
  type AgentDeploymentControllerRequest,
  type AgentDeploymentControllerResponse,
  type AgentDeploymentWorkflowInput,
  type AgentDeploymentWorkflowUpdateInput,
  type DeploymentTriggerInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import type { Socket as ClientSocket } from 'socket.io-client';

import { deploymentInputsError } from '../utils/deployment-inputs.utils';

import { parseAgentDeploymentActionSource } from './agent-deployment-sources.service';
import { DeploymentRunsService } from './deployment-runs.service';
import { DeploymentWorkflowsService } from './deployment-workflows.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_ID_PATTERN = /^[A-Za-z0-9_.:#-]{1,255}$/;
const OPS = new Set<string>(AGENT_DEPLOYMENT_CONTROLLER_OPS);

type AgentDeploymentOp = AgentDeploymentControllerRequest['op'];

/**
 * Answers deployment requests of an environment (worker `agenstra` MCP server → manager → controller) over the
 * Socket.IO connection the controller holds to that manager. The workspace is the one bound to the connection; the
 * agent id is the one the manager authenticated with the agent's context token. Environments therefore only reach
 * enabled, approved workflows that are global or assigned to them, and only trigger / cancel when the workflow allows
 * it and the action `source` (chat approval / task / ticket automation opt-in, set by the manager) does. They manage
 * (create / update / delete) only workflows assigned exclusively to themselves; those wait for a workspace admin.
 */
@Injectable()
export class AgentDeploymentRequestHandlerService {
  private readonly logger = new Logger(AgentDeploymentRequestHandlerService.name);

  constructor(
    private readonly workflows: DeploymentWorkflowsService,
    private readonly runs: DeploymentRunsService,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
  ) {}

  /** Register the ack handler on a controller → manager socket for one workspace. */
  attach(remote: ClientSocket, clientId: string): void {
    remote.on(
      AGENT_DEPLOYMENT_REQUEST_EVENT,
      (request: unknown, ack?: (response: AgentDeploymentControllerResponse) => void) => {
        if (typeof ack !== 'function') {
          return;
        }

        void this.handle(clientId, request).then(ack);
      },
    );
  }

  async handle(clientId: string, raw: unknown): Promise<AgentDeploymentControllerResponse> {
    const request = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const op = request['op'];
    const agentId = this.id(request['agentId']);

    if (typeof op !== 'string' || !OPS.has(op)) {
      return { ok: false, error: 'Unsupported deployment request', status: 400 };
    }

    if (!UUID_V4.test(agentId)) {
      return { ok: false, error: 'Invalid agent', status: 400 };
    }

    try {
      if (!(await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, agentId))) {
        return { ok: false, error: 'Agent not found in this workspace', status: 404 };
      }

      return await this.dispatch(clientId, agentId, op as AgentDeploymentOp, request);
    } catch (error) {
      if (error instanceof HttpException) {
        return { ok: false, error: this.httpErrorMessage(error), status: error.getStatus() };
      }

      this.logger.warn(`Agent deployment request failed for client ${clientId}: ${this.errorMessage(error)}`);

      return { ok: false, error: 'Deployment request failed', status: 500 };
    }
  }

  private async dispatch(
    clientId: string,
    agentId: string,
    op: AgentDeploymentOp,
    request: Record<string, unknown>,
  ): Promise<AgentDeploymentControllerResponse> {
    switch (op) {
      case 'listWorkflows':
        return { ok: true, workflows: await this.workflows.listForAgent(clientId, agentId) };
      case 'getWorkflow':
        return {
          ok: true,
          workflow: await this.workflows.getForAgent(clientId, agentId, this.requireId(request['workflowId'])),
        };
      case 'syncWorkflow':
        return {
          ok: true,
          ...(await this.runs.syncForAgent(clientId, agentId, this.requireId(request['workflowId']))),
        };

      case 'listRuns': {
        const workflowId = request['workflowId'] === undefined ? undefined : this.requireId(request['workflowId']);

        return {
          ok: true,
          runs: await this.runs.listForAgent(clientId, agentId, {
            workflowId,
            limit: this.parseLimit(request['limit']),
          }),
        };
      }

      case 'getRun': {
        const detail = await this.runs.getForAgent(clientId, agentId, this.requireId(request['runId'], 'run'));

        return { ok: true, run: detail.run, jobs: detail.jobs };
      }

      case 'getRunLogs':
        return {
          ok: true,
          logs: await this.runs.getLogsForAgent(
            clientId,
            agentId,
            this.requireId(request['runId'], 'run'),
            this.parseJobId(request['jobId']),
          ),
        };

      case 'trigger': {
        const source = parseAgentDeploymentActionSource(request['source']);

        return {
          ok: true,
          run: await this.runs.triggerForAgent(
            clientId,
            agentId,
            this.requireId(request['workflowId']),
            this.parseTriggerInput(request['input']),
            source,
          ),
        };
      }

      case 'cancelRun': {
        const source = parseAgentDeploymentActionSource(request['source']);

        return {
          ok: true,
          run: await this.runs.cancelForAgent(clientId, agentId, this.requireId(request['runId'], 'run'), source),
          cancelled: true,
        };
      }

      case 'describeWorkflow':
        return {
          ok: true,
          workflow: await this.workflows.describeForAgent(clientId, agentId, this.requireId(request['workflowId'])),
        };
      case 'listConnections':
        return { ok: true, connections: await this.workflows.listConnectionOptions(clientId) };
      case 'createWorkflow':
        return {
          ok: true,
          workflow: await this.workflows.createForAgent(
            clientId,
            agentId,
            this.parseWorkflowInput(request['input'], true) as AgentDeploymentWorkflowInput,
          ),
        };

      case 'updateWorkflow': {
        const workflowId = this.requireId(request['workflowId']);

        return {
          ok: true,
          workflow: await this.workflows.updateForAgent(
            clientId,
            agentId,
            workflowId,
            this.parseWorkflowInput(request['input'], false),
          ),
        };
      }

      case 'deleteWorkflow':
        await this.workflows.deleteForAgent(clientId, agentId, this.requireId(request['workflowId']));

        return { ok: true, deleted: true };
    }
  }

  private id(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  /** Malformed ids are indistinguishable from missing resources. */
  private requireId(value: unknown, kind: 'workflow' | 'run' = 'workflow'): string {
    const id = this.id(value);

    if (!UUID_V4.test(id)) {
      throw new BadRequestException(kind === 'run' ? 'Invalid run id' : 'Invalid workflow id');
    }

    return id;
  }

  private parseLimit(value: unknown): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }

    return value;
  }

  private parseJobId(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (typeof value !== 'string' || !JOB_ID_PATTERN.test(value.trim())) {
      throw new BadRequestException('Invalid job id');
    }

    return value.trim();
  }

  /** Typed, bounded fields only; ref resolution and input merging happen in {@link DeploymentRunsService}. */
  private parseTriggerInput(raw: unknown): DeploymentTriggerInput {
    if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
      throw new BadRequestException('input must be an object');
    }

    const input = (raw ?? {}) as Record<string, unknown>;
    const parsed: DeploymentTriggerInput = {};

    if (input['ref'] !== undefined && input['ref'] !== null) {
      if (typeof input['ref'] !== 'string' || input['ref'].length > DEPLOYMENT_LIMITS.refMaxLength) {
        throw new BadRequestException(`ref must be a string of at most ${DEPLOYMENT_LIMITS.refMaxLength} characters`);
      }

      // Empty: the workflow default ref / repository default branch.
      if (input['ref'].trim()) {
        parsed.ref = input['ref'];
      }
    }

    if (input['inputs'] !== undefined && input['inputs'] !== null) {
      const error = deploymentInputsError(input['inputs']);

      if (error) {
        throw new BadRequestException(error);
      }

      parsed.inputs = { ...(input['inputs'] as Record<string, string>) };
    }

    return parsed;
  }

  /**
   * Typed workflow fields only (bounds, provider rules and the connection are checked by
   * {@link DeploymentWorkflowsService}). The assignment is never agent input: environments always get workflows of
   * their own, so `scope` / `agentIds` are rejected instead of silently ignored.
   */
  private parseWorkflowInput(raw: unknown, create: boolean): AgentDeploymentWorkflowUpdateInput {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('input must be an object');
    }

    const input = raw as Record<string, unknown>;
    const parsed: AgentDeploymentWorkflowUpdateInput = {};

    if (input['scope'] !== undefined || input['agentIds'] !== undefined) {
      throw new BadRequestException(
        'Environments cannot assign workflows: workflows you create are assigned to you only (scope and agentIds are not accepted).',
      );
    }

    if (input['connectionId'] !== undefined) {
      const connectionId = this.id(input['connectionId']);

      if (!UUID_V4.test(connectionId)) {
        throw new BadRequestException('Invalid connection id');
      }

      parsed.connectionId = connectionId;
    } else if (create) {
      throw new BadRequestException('connectionId is required');
    }

    for (const field of ['name', 'repository'] as const) {
      if (input[field] !== undefined) {
        if (typeof input[field] !== 'string') {
          throw new BadRequestException(`${field} must be a string`);
        }

        parsed[field] = input[field] as string;
      } else if (create) {
        throw new BadRequestException(`${field} is required`);
      }
    }

    for (const field of ['description', 'workflow', 'defaultRef'] as const) {
      if (input[field] !== undefined) {
        if (input[field] !== null && typeof input[field] !== 'string') {
          throw new BadRequestException(`${field} must be a string or null`);
        }

        parsed[field] = input[field] as string | null;
      }
    }

    if (input['defaultInputs'] !== undefined && input['defaultInputs'] !== null) {
      const error = deploymentInputsError(input['defaultInputs']);

      if (error) {
        throw new BadRequestException(error);
      }

      parsed.defaultInputs = { ...(input['defaultInputs'] as Record<string, string>) };
    }

    for (const field of ['agentTriggerEnabled', 'enabled'] as const) {
      if (input[field] !== undefined) {
        if (typeof input[field] !== 'boolean') {
          throw new BadRequestException(`${field} must be a boolean`);
        }

        parsed[field] = input[field] as boolean;
      }
    }

    return parsed;
  }

  private httpErrorMessage(error: HttpException): string {
    const response = error.getResponse();
    const message =
      response && typeof response === 'object' ? (response as { message?: unknown }).message : String(response);

    return Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : error.message;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
