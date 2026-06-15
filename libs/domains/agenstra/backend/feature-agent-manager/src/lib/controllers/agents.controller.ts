import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import { AgentModelsResponseDto } from '../dto/agent-models-response.dto';
import { AgentResponseDto } from '../dto/agent-response.dto';
import { CreateAgentResponseDto } from '../dto/create-agent-response.dto';
import { CreateAgentDto } from '../dto/create-agent.dto';
import { UpdateAgentDto } from '../dto/update-agent.dto';
import { AgentsService } from '../services/agents.service';

/**
 * Controller for agent management endpoints.
 * Provides CRUD operations for agents.
 */
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  /**
   * Get all agents with pagination.
   * @param limit - Maximum number of agents to return (default: 10)
   * @param offset - Number of agents to skip (default: 0)
   * @returns Array of agent response DTOs
   */
  @Get()
  async getAgents(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<AgentResponseDto[]> {
    return await this.agentsService.findAll(limit ?? 10, offset ?? 0);
  }

  /**
   * List models available for an agent (provider-specific).
   * Runs inside the agent container when present; otherwise returns an empty map.
   * @param id - The UUID of the agent
   * @returns Map of model id to display name
   */
  @Get(':id/models')
  async listAgentModels(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AgentModelsResponseDto> {
    return await this.agentsService.listModels(id);
  }

  /**
   * Get a single agent by ID.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   */
  @Get(':id')
  async getAgent(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AgentResponseDto> {
    return await this.agentsService.findOne(id);
  }

  /**
   * Start all containers for an agent.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   */
  @Post(':id/start')
  async startAgent(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AgentResponseDto> {
    return await this.agentsService.start(id);
  }

  /**
   * Stop all containers for an agent.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   */
  @Post(':id/stop')
  async stopAgent(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AgentResponseDto> {
    return await this.agentsService.stop(id);
  }

  /**
   * Restart all containers for an agent.
   * @param id - The UUID of the agent
   * @returns The agent response DTO
   */
  @Post(':id/restart')
  async restartAgent(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AgentResponseDto> {
    return await this.agentsService.restart(id);
  }

  /**
   * Create a new agent.
   * A random password will be generated and returned in the response.
   * @param createAgentDto - Data transfer object for creating an agent
   * @returns The created agent response DTO with generated password
   */
  @Post()
  async createAgent(@Body() createAgentDto: CreateAgentDto): Promise<CreateAgentResponseDto> {
    return await this.agentsService.create(createAgentDto);
  }

  /**
   * Update an existing agent.
   * @param id - The UUID of the agent to update
   * @param updateAgentDto - Data transfer object for updating an agent
   * @returns The updated agent response DTO
   */
  @Post(':id')
  async updateAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() updateAgentDto: UpdateAgentDto,
  ): Promise<AgentResponseDto> {
    return await this.agentsService.update(id, updateAgentDto);
  }

  /**
   * Delete an agent by ID.
   * @param id - The UUID of the agent to delete
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAgent(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.agentsService.remove(id);
  }
}
