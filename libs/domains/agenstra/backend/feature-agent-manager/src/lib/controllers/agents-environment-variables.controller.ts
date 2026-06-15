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
  Put,
  Query,
} from '@nestjs/common';

import { CreateEnvironmentVariableDto } from '../dto/create-environment-variable.dto';
import { EnvironmentVariableResponseDto } from '../dto/environment-variable-response.dto';
import { UpdateEnvironmentVariableDto } from '../dto/update-environment-variable.dto';
import { AgentEnvironmentVariablesService } from '../services/agent-environment-variables.service';

/**
 * Controller for agent environment variables management endpoints.
 * Provides CRUD operations for agent environment variables.
 */
@Controller('agents/:agentId/environment')
export class AgentsEnvironmentVariablesController {
  constructor(private readonly agentEnvironmentVariablesService: AgentEnvironmentVariablesService) {}

  /**
   * Get all environment variables for an agent with pagination.
   * @param agentId - The UUID of the agent
   * @param limit - Maximum number of environment variables to return (default: 50)
   * @param offset - Number of environment variables to skip (default: 0)
   * @returns Array of environment variable response DTOs
   */
  @Get()
  async getEnvironmentVariables(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<EnvironmentVariableResponseDto[]> {
    const variables = await this.agentEnvironmentVariablesService.getEnvironmentVariables(
      agentId,
      limit ?? 50,
      offset ?? 0,
    );

    return variables.map(this.mapToResponseDto);
  }

  /**
   * Get count of environment variables for an agent.
   * @param agentId - The UUID of the agent
   * @returns Count of environment variables
   */
  @Get('count')
  async countEnvironmentVariables(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<{ count: number }> {
    const count = await this.agentEnvironmentVariablesService.countEnvironmentVariables(agentId);

    return { count };
  }

  /**
   * Create a new environment variable for an agent.
   * @param agentId - The UUID of the agent
   * @param createDto - Data transfer object for creating an environment variable
   * @returns The created environment variable response DTO
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createEnvironmentVariable(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() createDto: CreateEnvironmentVariableDto,
  ): Promise<EnvironmentVariableResponseDto> {
    const variable = await this.agentEnvironmentVariablesService.createEnvironmentVariable(
      agentId,
      createDto.variable,
      createDto.content,
    );

    return this.mapToResponseDto(variable);
  }

  /**
   * Update an existing environment variable.
   * @param agentId - The UUID of the agent
   * @param id - The UUID of the environment variable to update
   * @param updateDto - Data transfer object for updating an environment variable
   * @returns The updated environment variable response DTO
   */
  @Put(':id')
  async updateEnvironmentVariable(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() updateDto: UpdateEnvironmentVariableDto,
  ): Promise<EnvironmentVariableResponseDto> {
    const variable = await this.agentEnvironmentVariablesService.updateEnvironmentVariable(
      id,
      updateDto.variable,
      updateDto.content,
    );

    return this.mapToResponseDto(variable);
  }

  /**
   * Delete an environment variable by ID.
   * @param agentId - The UUID of the agent
   * @param id - The UUID of the environment variable to delete
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEnvironmentVariable(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    await this.agentEnvironmentVariablesService.deleteEnvironmentVariable(id);
  }

  /**
   * Delete all environment variables for an agent.
   * @param agentId - The UUID of the agent
   * @returns Number of environment variables deleted
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  async deleteAllEnvironmentVariables(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<{ deletedCount: number }> {
    const deletedCount = await this.agentEnvironmentVariablesService.deleteAllEnvironmentVariables(agentId);

    return { deletedCount };
  }

  /**
   * Map entity to response DTO.
   * @param entity - The environment variable entity
   * @returns The environment variable response DTO
   */
  private mapToResponseDto(entity: {
    id: string;
    agentId: string;
    variable: string;
    content?: string;
    createdAt: Date;
    updatedAt: Date;
  }): EnvironmentVariableResponseDto {
    return {
      id: entity.id,
      agentId: entity.agentId,
      variable: entity.variable,
      content: entity.content ?? '',
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
