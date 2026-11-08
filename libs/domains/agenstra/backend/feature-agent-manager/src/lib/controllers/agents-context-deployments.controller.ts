import {
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_CONTEXT_MCP_SERVER_KEY,
  AGENSTRA_DEPLOYMENTS_API_SEGMENT,
  AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES,
  type AgentDeploymentActionResponse,
  type AgentDeploymentRunListResponse,
  type AgentDeploymentSyncResponse,
  type AgentDeploymentWorkflowListResponse,
  type DeploymentRunDetail,
  type DeploymentRunLogs,
  type DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Public } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  parseAgentDeploymentBodyTicket,
  parseAgentDeploymentJobId,
  parseAgentDeploymentRequestId,
  parseAgentDeploymentRunId,
  parseAgentDeploymentRunsQuery,
  parseAgentDeploymentTicket,
  parseAgentDeploymentTrigger,
  parseAgentDeploymentWorkflowCreate,
  parseAgentDeploymentWorkflowId,
  parseAgentDeploymentWorkflowUpdate,
} from '../dto/agent-deployment.dto';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import { AgentDeploymentActionsService } from '../services/agent-deployment-actions.service';
import {
  AgentDeploymentsApiService,
  type AgentDeploymentConnectionListResponse,
} from '../services/agent-deployments-api.service';
import { AgentToolCallsService } from '../services/agent-tool-calls.service';
import type { AgentContextTicketRecord } from '../types/agent-context.types';
import { authenticateAgentContextCall } from '../utils/agent-context-auth.utils';

/** Session key of tickets minted for hidden sessions (see the agents gateway). */
const HIDDEN_SESSION_KEY_PREFIX = 'suffix:';

function sameString(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === expected.toLowerCase();
}

/**
 * Agent-facing deployments API used by the worker `agenstra` MCP server (`agenstra_deployments_*` tools).
 *
 * Same trust model as the context API: user auth guards are bypassed (`@Public`) and callers authenticate
 * with the per-agent context token. Every request is bound to the authenticated agent; the controller only exposes
 * the workflows available to it (global or assigned). Run actions (trigger / cancel) additionally need the context
 * ticket of the prompt and are decided per session ({@link AgentDeploymentActionsService}); workflows the agent
 * creates / changes are assigned to itself only and wait for approval by a workspace admin (controller).
 */
@Public()
@Controller(`${AGENSTRA_CONTEXT_API_ROUTE}/${AGENSTRA_DEPLOYMENTS_API_SEGMENT}`)
export class AgentsContextDeploymentsController {
  constructor(
    private readonly contextMcp: AgentContextMcpService,
    private readonly deployments: AgentDeploymentsApiService,
    private readonly tickets: AgentContextTicketsService,
    private readonly actions: AgentDeploymentActionsService,
    @Optional() private readonly toolCalls?: AgentToolCallsService,
  ) {}

  @Get('workflows')
  async listWorkflows(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentDeploymentWorkflowListResponse> {
    return this.deployments.listWorkflows(await this.authenticate(agentId, authorization));
  }

  @Get('workflows/:workflowId')
  async getWorkflow(
    @Param('workflowId') workflowId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DeploymentWorkflowSummary> {
    const id = await this.authenticate(agentId, authorization);

    return this.deployments.getWorkflow(id, parseAgentDeploymentWorkflowId(workflowId));
  }

  /** Import the provider's latest runs of a usable workflow into the history (throttled by the controller). */
  @Post('workflows/:workflowId/sync')
  @HttpCode(HttpStatus.OK)
  async syncWorkflow(
    @Param('workflowId') workflowId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentDeploymentSyncResponse> {
    const id = await this.authenticate(agentId, authorization);

    return this.deployments.syncWorkflow(id, parseAgentDeploymentWorkflowId(workflowId));
  }

  @Post('workflows')
  @HttpCode(HttpStatus.CREATED)
  async createWorkflow(
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DeploymentWorkflowSummary> {
    const id = await this.authenticate(agentId, authorization);

    return this.deployments.createWorkflow(id, parseAgentDeploymentWorkflowCreate(body));
  }

  @Patch('workflows/:workflowId')
  async updateWorkflow(
    @Param('workflowId') workflowId: string,
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DeploymentWorkflowSummary> {
    const id = await this.authenticate(agentId, authorization);
    const workflow = parseAgentDeploymentWorkflowId(workflowId);

    return this.deployments.updateWorkflow(id, workflow, parseAgentDeploymentWorkflowUpdate(body));
  }

  @Delete('workflows/:workflowId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkflow(
    @Param('workflowId') workflowId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const id = await this.authenticate(agentId, authorization);

    await this.deployments.deleteWorkflow(id, parseAgentDeploymentWorkflowId(workflowId));
  }

  @Get('connections')
  async listConnections(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentDeploymentConnectionListResponse> {
    return this.deployments.listConnections(await this.authenticate(agentId, authorization));
  }

  /** Start a run; decided per session (see {@link AgentDeploymentActionsService}). Long-polls while the user decides. */
  @Post('workflows/:workflowId/trigger')
  @HttpCode(HttpStatus.OK)
  async trigger(
    @Param('workflowId') workflowId: string,
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentDeploymentActionResponse> {
    const id = await this.authenticate(agentId, authorization);
    const workflow = parseAgentDeploymentWorkflowId(workflowId);
    const input = parseAgentDeploymentTrigger(body);
    const record = this.tickets.resolve(id, parseAgentDeploymentBodyTicket(body));

    await this.requireToolCall(record, AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.trigger, (args) =>
      sameString(args['workflowId'], workflow),
    );

    return this.actions.requestAction(record, { operation: 'deployment.trigger', workflowId: workflow, input });
  }

  @Get('runs')
  async listRuns(
    @Query('workflowId') workflowId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentDeploymentRunListResponse> {
    const id = await this.authenticate(agentId, authorization);

    return this.deployments.listRuns(id, parseAgentDeploymentRunsQuery(workflowId, limit));
  }

  @Get('runs/:runId')
  async getRun(
    @Param('runId') runId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DeploymentRunDetail> {
    const id = await this.authenticate(agentId, authorization);

    return this.deployments.getRun(id, parseAgentDeploymentRunId(runId));
  }

  @Get('runs/:runId/logs')
  async getRunLogs(
    @Param('runId') runId: string,
    @Query('jobId') jobId: string | undefined,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DeploymentRunLogs> {
    const id = await this.authenticate(agentId, authorization);

    return this.deployments.getRunLogs(id, parseAgentDeploymentRunId(runId), parseAgentDeploymentJobId(jobId));
  }

  /** Cancel a run; decided per session like triggers. */
  @Post('runs/:runId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelRun(
    @Param('runId') runId: string,
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentDeploymentActionResponse> {
    const id = await this.authenticate(agentId, authorization);
    const run = parseAgentDeploymentRunId(runId);
    const record = this.tickets.resolve(id, parseAgentDeploymentBodyTicket(body));

    await this.requireToolCall(record, AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.cancelRun, (args) =>
      sameString(args['runId'], run),
    );

    return this.actions.requestAction(record, { operation: 'deployment.cancel', runId: run });
  }

  /** Keep waiting for the user's decision on a pending trigger / cancel. */
  @Get('actions/:requestId')
  async actionStatus(
    @Param('requestId') requestId: string,
    @Query('ticket') ticket: string | undefined,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentDeploymentActionResponse> {
    const id = await this.authenticate(agentId, authorization);
    const record = this.tickets.resolve(id, parseAgentDeploymentTicket(ticket));
    const request = parseAgentDeploymentRequestId(requestId);

    await this.requireToolCall(record, AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.actionStatus, (args) =>
      sameString(args['requestId'], request),
    );

    return this.actions.actionStatus(record, request);
  }

  /**
   * Auto tickets (unattended task runs / ticket automation) act without asking anybody, so they only serve requests
   * issued as a tool call (matching ticket and arguments) that answers the platform's own prompt carrying the ticket
   * (same rule as content changes). A ticket copied into another process is useless.
   */
  private async requireToolCall(
    record: AgentContextTicketRecord,
    tool: string,
    matches: (input: Record<string, unknown>) => boolean,
  ): Promise<void> {
    if (record.accessMode !== 'auto' || !this.toolCalls) {
      return;
    }

    const authorized =
      record.sessionKey.startsWith(HIDDEN_SESSION_KEY_PREFIX) &&
      (await this.toolCalls.claim(
        record.agentId,
        record.ticket,
        `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_${tool}`,
        (input) => typeof input['ticket'] === 'string' && input['ticket'].trim() === record.ticket && matches(input),
      ));

    if (!authorized) {
      throw new NotFoundException('Unknown or expired context ticket');
    }
  }

  private authenticate(agentId: string | undefined, authorization: string | undefined): Promise<string> {
    return authenticateAgentContextCall(this.contextMcp, agentId, authorization);
  }
}
