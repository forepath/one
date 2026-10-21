import {
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_TASKS_API_SEGMENT,
  type AgentTaskDetailResponse,
  type AgentTaskListResponse,
  type AgentTaskRunNowResponse,
  type AgentTaskSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Public } from '@forepath/identity/backend';
import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { Public as KeycloakPublic } from 'nest-keycloak-connect';

import { parseAgentTaskCreate, parseAgentTaskId, parseAgentTaskUpdate } from '../dto/agent-task.dto';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentTasksApiService } from '../services/agent-tasks-api.service';
import { authenticateAgentContextCall } from '../utils/agent-context-auth.utils';

/**
 * Agent-facing task API used by the worker `agenstra` MCP server (`agenstra_tasks_*` tools).
 *
 * Same trust model as the context API: user auth guards are bypassed (`@Public`) and callers authenticate
 * with the per-agent context token. Every request is bound to the authenticated agent, so an agent can
 * only manage its own tasks.
 */
@Public()
@KeycloakPublic()
@Controller(`${AGENSTRA_CONTEXT_API_ROUTE}/${AGENSTRA_TASKS_API_SEGMENT}`)
export class AgentsTasksController {
  constructor(
    private readonly contextMcp: AgentContextMcpService,
    private readonly tasks: AgentTasksApiService,
  ) {}

  @Get()
  async list(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentTaskListResponse> {
    return this.tasks.list(await this.authenticate(agentId, authorization));
  }

  @Get(':taskId')
  async get(
    @Param('taskId') taskId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentTaskDetailResponse> {
    const id = await this.authenticate(agentId, authorization);

    return this.tasks.get(id, parseAgentTaskId(taskId));
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentTaskSummary> {
    const id = await this.authenticate(agentId, authorization);

    return this.tasks.create(id, parseAgentTaskCreate(body));
  }

  @Patch(':taskId')
  async update(
    @Param('taskId') taskId: string,
    @Body() body: unknown,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentTaskSummary> {
    const id = await this.authenticate(agentId, authorization);

    return this.tasks.update(id, parseAgentTaskId(taskId), parseAgentTaskUpdate(body));
  }

  @Delete(':taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('taskId') taskId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const id = await this.authenticate(agentId, authorization);

    await this.tasks.delete(id, parseAgentTaskId(taskId));
  }

  @Post(':taskId/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  async run(
    @Param('taskId') taskId: string,
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentTaskRunNowResponse> {
    const id = await this.authenticate(agentId, authorization);

    return this.tasks.run(id, parseAgentTaskId(taskId));
  }

  private authenticate(agentId: string | undefined, authorization: string | undefined): Promise<string> {
    return authenticateAgentContextCall(this.contextMcp, agentId, authorization);
  }
}
